import assert from 'node:assert/strict';
import test from 'node:test';

import { protocolVersion } from '@/lib/ble/model';
import { BleSessionStore } from '@/lib/ble/session/store';

const device = {
  id: 'drunksafe-test',
  name: 'Drunksafe Test',
  rssi: -40,
  serviceUUIDs: [],
};

test('connection stays pending until status notify and blocks scans once ready', async () => {
  const harness = createHarness();

  await connect(harness);
  assert.equal(harness.store.getSnapshot().connectedDevice, null);
  assert.equal(harness.store.getSnapshot().connectionPhase, 'connecting');

  harness.client.emit(status('connected', null));
  await settle();

  assert.deepEqual(harness.store.getSnapshot().connectedDevice, device);
  assert.equal(harness.store.getSnapshot().connectionPhase, 'connected');

  await harness.store.startScan();
  assert.equal(harness.client.scanCount, 0);
});

test('result persistence is serialized and stale session results are ignored', async () => {
  const firstPersistence = deferred();
  let persistenceCalls = 0;
  let concurrentPersistence = 0;
  let maxConcurrentPersistence = 0;
  const harness = createHarness({
    persistResult: async () => {
      persistenceCalls += 1;
      concurrentPersistence += 1;
      maxConcurrentPersistence = Math.max(maxConcurrentPersistence, concurrentPersistence);

      if (persistenceCalls === 1) await firstPersistence.promise;

      concurrentPersistence -= 1;
      return { saved: true, message: 'saved' };
    },
  });

  await connectReady(harness);
  harness.client.emit(status('measuring', 'fw-current'));
  harness.client.emit(started('fw-current'));
  await settle();

  harness.client.emit(result('fw-stale'));
  harness.client.emit(result('fw-current'));
  harness.client.emit(result('fw-current'));
  await settle();

  assert.equal(persistenceCalls, 1);
  assert.equal(harness.store.getSnapshot().result, null);
  assert.equal(
    harness.store
      .getSnapshot()
      .verificationLog.some(
        (entry) => entry.label === 'state:ignored-event' && entry.sessionId === 'fw-stale'
      ),
    true
  );

  firstPersistence.resolve();
  await settle();
  await settle();

  assert.equal(persistenceCalls, 2);
  assert.equal(maxConcurrentPersistence, 1);
  assert.equal(harness.store.getSnapshot().result?.session_id, 'fw-current');
});

test('disconnect invalidates context work before it can send a stale command', async () => {
  const context = deferred();
  const harness = createHarness({ buildContext: () => context.promise });

  await connectReady(harness);
  harness.client.emit(status('measuring', 'fw-context'));
  harness.client.emit(started('fw-context'));
  await settle();

  assert.equal(harness.store.getSnapshot().measurementPhase, 'waiting_context');

  await harness.store.disconnect();
  context.resolve(phoneContext('fw-context'));
  await settle();

  assert.equal(harness.store.getSnapshot().connectedDevice, null);
  assert.equal(harness.store.getSnapshot().measurementPhase, 'error');
  assert.equal(
    harness.client.commands.some(
      (command) => command.cmd === 'context' && command.session_id === 'fw-context'
    ),
    false
  );
});

test('disconnect failures become session errors instead of unhandled rejections', async () => {
  const harness = createHarness();

  await connectReady(harness);
  harness.client.disconnectError = new Error('disconnect failed');

  await harness.store.disconnect();

  assert.equal(harness.store.getSnapshot().connectionPhase, 'error');
  assert.equal(harness.store.getSnapshot().connectedDevice, null);
  assert.equal(harness.store.getSnapshot().message, 'disconnect failed');
});

test('mock disconnect does not leave a fake device in the real BLE reconnect list', async () => {
  const harness = createHarness();

  await harness.store.connectMockDevice();
  assert.equal(harness.store.getSnapshot().devices.length, 1);
  assert.equal(harness.store.getSnapshot().devices[0]?.id, 'mock-drnksafe-simulator');

  await harness.store.disconnect();

  assert.deepEqual(harness.store.getSnapshot().devices, []);
  assert.equal(harness.store.getSnapshot().mockMode, false);
});

test('mock cancellation clears the session and allows a baseline retry', async () => {
  const harness = createHarness();

  await harness.store.connectMockDevice();
  await harness.store.startMeasurement();
  const cancelledSessionId = harness.store.getSnapshot().activeSessionId;

  await harness.store.cancelMeasurement();

  assert.equal(harness.store.getSnapshot().measurementPhase, 'error');
  assert.equal(harness.store.getSnapshot().deviceErrorCode, 'cancelled');
  assert.equal(harness.store.getSnapshot().progress, null);
  assert.equal(harness.store.getSnapshot().result, null);

  await harness.store.startMeasurement('baseline');

  assert.equal(harness.store.getSnapshot().measurementPhase, 'measuring');
  assert.equal(harness.store.getSnapshot().activeMeasurementKind, 'baseline');
  assert.notEqual(harness.store.getSnapshot().activeSessionId, cancelledSessionId);

  await harness.store.destroy();
});

test('Bluetooth shutdown clears stale scan results and stops the active scan', async () => {
  const harness = createHarness();

  await settle();
  await harness.store.startScan();
  harness.client.discover(device);
  assert.deepEqual(harness.store.getSnapshot().devices, [device]);

  harness.client.emitState('PoweredOff');
  await settle();

  assert.equal(harness.store.getSnapshot().connectionPhase, 'bluetooth_off');
  assert.deepEqual(harness.store.getSnapshot().devices, []);
  assert.ok(harness.client.stopScanCount > 0);
});

test('reconnect is not blocked by context work left hanging on the previous connection', async () => {
  const abandonedContext = deferred();
  let contextCalls = 0;
  const harness = createHarness({
    buildContext: (sessionId) => {
      contextCalls += 1;
      return contextCalls === 1
        ? abandonedContext.promise
        : Promise.resolve(phoneContext(sessionId));
    },
  });

  await connectReady(harness);
  harness.client.emit(status('measuring', 'fw-abandoned'));
  harness.client.emit(started('fw-abandoned'));
  await settle();

  await harness.store.disconnect();
  await connectReady(harness);
  harness.client.emit(status('measuring', 'fw-reconnected'));
  harness.client.emit(started('fw-reconnected'));
  await settle();

  assert.equal(harness.store.getSnapshot().activeSessionId, 'fw-reconnected');
  assert.equal(harness.store.getSnapshot().measurementPhase, 'measuring');
  assert.equal(
    harness.client.commands.some(
      (command) => command.cmd === 'context' && command.session_id === 'fw-reconnected'
    ),
    true
  );
});

test('orphan idle status terminates an active session instead of leaving it stuck', async () => {
  const harness = createHarness();

  await connectReady(harness);
  harness.client.emit(status('measuring', 'fw-orphaned'));
  harness.client.emit(started('fw-orphaned'));
  await settle();

  harness.client.emit(status('idle', null));
  await settle();

  assert.equal(harness.store.getSnapshot().measurementPhase, 'error');
  assert.equal(harness.store.getSnapshot().activeSessionId, null);
  assert.match(harness.store.getSnapshot().message, /예기치 않게 종료/);
});

test('Bluetooth shutdown invalidates a connection that completes late', async () => {
  const pendingConnection = deferred();
  const harness = createHarness();
  harness.client.connection = pendingConnection.promise;

  await settle();
  const connecting = harness.store.connect(device.id);
  await settle();
  harness.client.emitState('PoweredOff');
  pendingConnection.resolve(device);
  await connecting;
  await settle();

  assert.equal(harness.store.getSnapshot().connectionPhase, 'bluetooth_off');
  assert.equal(harness.store.getSnapshot().connectedDevice, null);
  assert.equal(harness.client.eventListener, null);
});

function createHarness(overrides = {}) {
  const client = new FakeBleClient();
  const store = new BleSessionStore({
    createClient: () => client,
    buildContext:
      overrides.buildContext ?? ((sessionId) => Promise.resolve(phoneContext(sessionId))),
    persistResult:
      overrides.persistResult ?? (() => Promise.resolve({ saved: true, message: 'saved' })),
    now: () => 1_798_848_000_000,
  });

  store.initialize();

  return { client, store };
}

async function connect(harness) {
  await settle();
  await harness.store.connect(device.id);
}

async function connectReady(harness) {
  await connect(harness);
  harness.client.emit(status('connected', null));
  await settle();
}

function status(value, activeSessionId) {
  return {
    event: 'status',
    v: protocolVersion,
    status: value,
    active_session_id: activeSessionId,
    battery_percent: null,
    firmware_version: 'test',
  };
}

function started(sessionId) {
  return {
    event: 'measurement_started',
    v: protocolVersion,
    session_id: sessionId,
    source: 'phone',
    kind: 'measurement',
    history_limit: 8,
    needs_context: true,
    sync_time: false,
  };
}

function result(sessionId) {
  return {
    event: 'measurement_result',
    v: protocolVersion,
    session_id: sessionId,
    kind: 'measurement',
    measured_at_unix_ms: 1_798_848_000_000,
    alcohol: { mg_l_x1000: 160 },
    pulse: null,
    bac_milli_percent: 34,
    bac_upper_milli_percent: 38,
    sober_time_minutes: 152,
    risk: 'danger',
    confidence_percent: 80,
  };
}

function phoneContext(sessionId) {
  return {
    v: protocolVersion,
    session_id: sessionId,
    phone_time_unix_ms: 1_798_848_000_000,
    recent: [],
    sober_alcohol_mg_l_x1000: null,
    sober_alcohol_mad_mg_l_x1000: null,
    elimination_mg_l_per_hour_x1000: null,
    resting_bpm: null,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeBleClient {
  commands = [];
  connection = null;
  disconnectError = null;
  eventListener = null;
  scanCallbacks = null;
  scanCount = 0;
  stateListener = null;
  stopScanCount = 0;

  state() {
    return Promise.resolve('PoweredOn');
  }

  onStateChange(listener) {
    this.stateListener = listener;
    listener('PoweredOn');
    return removable();
  }

  startScan(callbacks) {
    this.scanCallbacks = callbacks;
    this.scanCount += 1;
    return Promise.resolve();
  }

  stopScan() {
    this.stopScanCount += 1;
    return Promise.resolve();
  }

  connect() {
    return this.connection ?? Promise.resolve(device);
  }

  disconnect() {
    return this.disconnectError ? Promise.reject(this.disconnectError) : Promise.resolve();
  }

  monitorEvents(listener) {
    this.eventListener = listener;
    return removable(() => {
      this.eventListener = null;
    });
  }

  send(command) {
    this.commands.push(command);
    return Promise.resolve();
  }

  destroy() {
    return Promise.resolve();
  }

  emit(event) {
    this.eventListener?.(event);
  }

  emitState(state) {
    this.stateListener?.(state);
  }

  discover(discoveredDevice) {
    this.scanCallbacks?.onDevice(discoveredDevice);
  }
}

function removable(remove = () => {}) {
  return { remove };
}
