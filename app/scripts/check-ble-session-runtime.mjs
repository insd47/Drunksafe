import assert from 'node:assert/strict';
import test from 'node:test';

import { notifySubscriptionReadyTimeoutMs } from '@/lib/ble/connection-readiness';
import { protocolVersion } from '@/lib/ble/model';
import { MockBleEventSource } from '@/lib/ble/mock';
import { BleSessionStore } from '@/lib/ble/session/store';

const device = {
  id: 'drunksafe-test',
  name: 'Drunksafe Test',
  rssi: -40,
  serviceUUIDs: [],
};

test('connection stays pending until the first status notify', async () => {
  const harness = await createHarness();

  await harness.store.connect(device.id);
  assert.equal(harness.store.getSnapshot().connection.phase, 'connecting');

  harness.client.emit(status('connected', null));
  await settle();

  assert.deepEqual(harness.store.getSnapshot().connection, {
    phase: 'connected',
    device,
    status: 'connected',
    message: null,
  });
  await harness.store.destroy();
});

test('duplicate result notify enters the serialized persistence queue once and stale sessions are ignored', async () => {
  const harness = await createHarness();
  await connectReady(harness);
  harness.client.emit(started('fw-current'));
  await settle();

  harness.client.emit(result('fw-stale'));
  harness.client.emit(result('fw-current'));
  harness.client.emit(result('fw-current'));

  await waitFor(() =>
    harness.store.verification
      .getSnapshot()
      .verificationLog.some((entry) => entry.label === 'state:persist-end')
  );

  const persistenceStarts = harness.store.verification
    .getSnapshot()
    .verificationLog.filter((entry) => entry.label === 'state:persist-start');
  assert.equal(persistenceStarts.length, 1);
  assert.equal(persistenceStarts[0]?.sessionId, 'fw-current');
  assert.equal(harness.store.getSnapshot().measurement.phase, 'result');
  assert.equal(harness.store.getSnapshot().measurement.record.session_id, 'fw-current');
  await harness.store.destroy();
});

test('disconnect invalidates an active measurement and ignores its late result', async () => {
  const harness = await createHarness();
  await connectReady(harness);
  harness.client.emit(started('fw-disconnected'));
  await settle();

  await harness.store.disconnect();
  harness.client.emit(result('fw-disconnected'));
  await settle();

  assert.deepEqual(harness.store.getSnapshot().measurement, {
    phase: 'error',
    code: 'connection_lost',
    message: '측정 중 연결이 해제되었습니다.',
    kind: 'measurement',
  });
  assert.equal(
    harness.store.verification
      .getSnapshot()
      .verificationLog.some((entry) => entry.label === 'state:persist-start'),
    false
  );
  await harness.store.destroy();
});

test('notify-ready timeout physically disconnects and enters connection error', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let timeoutCallback = null;
  let timeoutDelay = null;
  globalThis.setTimeout = (callback, delay) => {
    timeoutCallback = callback;
    timeoutDelay = delay;
    return 101;
  };
  globalThis.clearTimeout = () => {};

  try {
    const harness = await createHarness();
    await harness.store.connect(device.id);

    assert.equal(timeoutDelay, notifySubscriptionReadyTimeoutMs);
    assert.ok(timeoutCallback);
    timeoutCallback();
    await settle();

    assert.equal(harness.store.getSnapshot().connection.phase, 'error');
    assert.match(harness.store.getSnapshot().connection.message, /notify 구독 확인 시간이 초과/);
    assert.equal(harness.client.disconnectCount, 1);
    await harness.store.destroy();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('mock event source owns and clears every scheduled result timer', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const cleared = [];
  let nextTimer = 200;
  globalThis.setTimeout = () => {
    nextTimer += 1;
    return nextTimer;
  };
  globalThis.clearTimeout = (timer) => {
    cleared.push(timer);
  };

  try {
    const source = new MockBleEventSource();
    const events = [];
    source.start('measurement', (event) => events.push(event));

    assert.equal(events[0]?.event, 'measurement_started');
    assert.equal(source.pendingTimerCount, 1);

    source.cancel();
    assert.equal(source.pendingTimerCount, 0);
    assert.deepEqual(cleared, [201]);

    source.start('baseline', (event) => events.push(event));
    source.stop();
    assert.equal(source.pendingTimerCount, 0);
    assert.deepEqual(cleared, [201, 202]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('mock measurements enter the same reducer path as device events', async () => {
  const harness = await createHarness();

  await harness.store.connectMockDevice();
  await harness.store.startMeasurement('baseline');

  const active = harness.store.getSnapshot().measurement;
  assert.equal(active.phase, 'active');
  assert.equal(active.kind, 'baseline');
  assert.match(active.sessionId, /^baseline-mock-/);

  await harness.store.cancelMeasurement();
  assert.deepEqual(harness.store.getSnapshot().measurement, {
    phase: 'error',
    code: 'cancelled',
    message: '측정이 취소됐습니다.',
    kind: 'baseline',
  });
  await harness.store.destroy();
});

test('verification updates do not notify session snapshot subscribers', async () => {
  const harness = await createHarness();
  let sessionNotifications = 0;
  let verificationNotifications = 0;
  const unsubscribeSession = harness.store.subscribe(() => {
    sessionNotifications += 1;
  });
  const unsubscribeVerification = harness.store.verification.subscribe(() => {
    verificationNotifications += 1;
  });

  harness.store.verification.state('state:test', 'separate store');

  assert.equal(sessionNotifications, 0);
  assert.equal(verificationNotifications, 1);
  unsubscribeSession();
  unsubscribeVerification();
  await harness.store.destroy();
});

test('HR watch requires baseline, waits for firmware ack, and sends no alcohol command', async () => {
  const harness = await createHarness({ resting_bpm: 71, sample_count: 3 });
  await connectReady(harness);
  const startedPromise = harness.store.startSession();
  await waitFor(() => harness.client.commands.length === 1);
  assert.deepEqual(harness.client.commands[0], { cmd: 'start_hr_watch', resting_bpm: 71 });
  assert.equal(harness.store.getSessionSnapshot().phase, 'idle');
  harness.client.emit(sessionStatus('fw-hrwatch-1', 'dormant', 0, 71, null));
  await startedPromise;
  assert.equal(harness.store.getSessionSnapshot().phase, 'active');
  harness.client.emit(sessionStatus('fw-hrwatch-1', 'probe', 300000, 71, null));
  await settle();
  assert.equal(harness.store.getSessionSnapshot().status?.state, 'probe');
  assert.equal(
    harness.client.commands.some((command) => command.cmd === 'start'),
    false
  );
  await harness.store.destroy();
});

test('HR watch refuses to start without a measured resting baseline', async () => {
  const harness = await createHarness({ resting_bpm: null, sample_count: 0 });
  await connectReady(harness);
  await assert.rejects(() => harness.store.startSession(), /baseline/);
  assert.equal(harness.client.commands.length, 0);
  assert.equal(harness.store.getSessionSnapshot().phase, 'idle');
  await harness.store.destroy();
});

test('manual session alcohol measurement is available before an HR trigger and re-enables after a result', async () => {
  const harness = await createHarness({ resting_bpm: 71, sample_count: 3 });
  await connectReady(harness);
  const startedPromise = harness.store.startSession();
  await waitFor(() => harness.client.commands.length === 1);
  harness.client.emit(sessionStatus('fw-hrwatch-1', 'dormant', 120000, 71, 71));
  await startedPromise;

  await harness.store.measureSessionAlcohol();
  assert.deepEqual(harness.client.commands.at(-1), { cmd: 'measure_session_alcohol' });
  assert.equal(harness.store.getSessionSnapshot().alcoholMeasurementPending, true);
  await assert.rejects(
    () => harness.store.measureSessionAlcohol(),
    /알코올 측정이 이미 진행 중입니다/
  );

  harness.client.emit({
    event: 'session_alcohol_result',
    v: protocolVersion,
    session_id: 'fw-hrwatch-1',
    elapsed_ms: 140000,
    trigger_percent: null,
    alcohol_mg_l_x1000: 132,
  });
  await settle();
  assert.equal(harness.store.getSessionSnapshot().alcoholMeasurementPending, false);
  assert.equal(harness.store.getSessionSnapshot().alcoholResults.at(-1)?.alcohol_mg_l_x1000, 132);
  await harness.store.destroy();
});

async function createHarness(baseline = { resting_bpm: 71, sample_count: 1 }) {
  const client = new FakeBleClient();
  const store = new BleSessionStore({
    createClient: () => client,
    baselineReader: () =>
      Promise.resolve({
        sober_alcohol_mg_l_x1000: 8,
        sober_alcohol_mad_mg_l_x1000: null,
        elimination_mg_l_per_hour_x1000: null,
        updated_at_unix_ms: null,
        ...baseline,
      }),
  });
  store.initialize();
  await settle();
  return { client, store };
}

async function connectReady(harness) {
  await harness.store.connect(device.id);
  harness.client.emit(status('connected', null));
  await settle();
}

function status(value, activeSessionId) {
  return {
    event: 'status',
    v: protocolVersion,
    status: value,
    active_session_id: activeSessionId,
  };
}

function started(sessionId) {
  return {
    event: 'measurement_started',
    v: protocolVersion,
    session_id: sessionId,
    source: 'phone',
    kind: 'measurement',
  };
}

function result(sessionId) {
  return {
    event: 'measurement_result',
    v: protocolVersion,
    session_id: sessionId,
    kind: 'measurement',
    alcohol_mg_l_x1000: 160,
    pulse: { status: 'unavailable', reason: 'no_signal' },
  };
}

function sessionStatus(sessionId, state, elapsed, r0, lastBpm, overrides = {}) {
  return {
    event: 'session_status',
    v: protocolVersion,
    session_id: sessionId,
    state,
    elapsed_ms: elapsed,
    records: 1,
    r0_bpm: r0,
    last_bpm: lastBpm,
    valid_minutes: null,
    high_minutes: null,
    next_threshold_percent: null,
    alerted_percent: null,
    ...overrides,
  };
}

async function waitFor(predicate) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.fail('timed out waiting for session runtime');
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeBleClient {
  commands = [];
  disconnectCount = 0;
  eventListener = null;
  disconnectListener = null;
  scanCallbacks = null;
  stateListener = null;

  state() {
    return Promise.resolve('PoweredOn');
  }

  onStateChange(listener) {
    this.stateListener = listener;
    return removable(() => {
      this.stateListener = null;
    });
  }

  startScan(callbacks) {
    this.scanCallbacks = callbacks;
    return Promise.resolve();
  }

  stopScan() {
    return Promise.resolve();
  }

  connect() {
    return Promise.resolve(device);
  }

  disconnect() {
    this.disconnectCount += 1;
    return Promise.resolve();
  }

  onDisconnected(listener) {
    this.disconnectListener = listener;
    return removable(() => {
      this.disconnectListener = null;
    });
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
}

function removable(remove = () => {}) {
  return { remove };
}
