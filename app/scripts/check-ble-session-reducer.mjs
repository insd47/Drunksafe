import assert from 'node:assert/strict';
import test from 'node:test';

import { protocolVersion } from '@/lib/ble/model';
import { initialBleSessionState, reduceBleSession } from '@/lib/ble/session/reducer';

const device = {
  id: 'reducer-device',
  name: 'Drunksafe Reducer',
  rssi: -50,
  serviceUUIDs: [],
};

test('connecting keeps the selected scan device', () => {
  const transition = reduceBleSession(
    {
      ...initialBleSessionState,
      bluetoothState: 'PoweredOn',
      connection: {
        phase: 'scanning',
        devices: [device],
        message: 'Drunksafe 장치를 찾는 중입니다.',
      },
    },
    { type: 'connect_requested', deviceId: device.id }
  );

  assert.deepEqual(transition.state.connection, {
    phase: 'connecting',
    deviceId: device.id,
    device,
    reconnectAttempt: 0,
    message: 'Drunksafe 장치에 연결하는 중입니다.',
  });
});

test('measurement transition owns only fields valid for its discriminant', () => {
  let state = connectedState();

  state = reduceBleSession(state, {
    type: 'start_measurement_requested',
    kind: 'baseline',
  }).state;
  assert.deepEqual(state.measurement, { phase: 'starting', kind: 'baseline' });

  state = reduceBleSession(state, {
    type: 'device_event',
    event: started('fw-baseline', 'baseline'),
    atUnixMs: 1_798_848_000_000,
    readyDevice: null,
  }).state;
  assert.deepEqual(state.measurement, {
    phase: 'active',
    sessionId: 'fw-baseline',
    kind: 'baseline',
    stage: 'alcohol',
    startedAtUnixMs: 1_798_848_000_000,
  });
  assert.equal(Object.hasOwn(state.measurement, 'record'), false);
  assert.equal(Object.hasOwn(state.measurement, 'saved'), false);
});

test('active measurement blocks duplicate starts without emitting effects', () => {
  const active = reduceBleSession(
    {
      ...connectedState(),
      measurement: {
        phase: 'active',
        sessionId: 'fw-active',
        kind: 'measurement',
        startedAtUnixMs: 1000,
      },
    },
    { type: 'start_measurement_requested', kind: 'baseline' }
  );

  assert.equal(active.state.measurement.phase, 'active');
  assert.deepEqual(active.effects, []);
});

test('result effects are emitted only for the current active session', () => {
  const state = {
    ...connectedState(),
    measurement: {
      phase: 'active',
      sessionId: 'fw-current',
      kind: 'measurement',
      startedAtUnixMs: 1000,
    },
  };
  const stale = reduceBleSession(state, {
    type: 'device_event',
    event: result('fw-stale'),
    atUnixMs: 2000,
    readyDevice: null,
  });
  const current = reduceBleSession(state, {
    type: 'device_event',
    event: result('fw-current'),
    atUnixMs: 2000,
    readyDevice: null,
  });

  assert.deepEqual(stale.effects, []);
  assert.deepEqual(current.effects, [
    { type: 'persist_record', result: result('fw-current'), measuredAtUnixMs: 2000 },
  ]);
});

test('disconnect turns an active measurement into a typed connection error', () => {
  const transition = reduceBleSession(
    {
      ...connectedState(),
      measurement: {
        phase: 'active',
        sessionId: 'fw-current',
        kind: 'measurement',
        startedAtUnixMs: 1000,
      },
    },
    { type: 'disconnect_requested' }
  );

  assert.deepEqual(transition.state.connection, { phase: 'idle' });
  assert.deepEqual(transition.state.measurement, {
    phase: 'error',
    code: 'connection_lost',
    message: '측정 중 연결이 해제되었습니다.',
    kind: 'measurement',
  });
  assert.deepEqual(
    transition.effects.map((effect) => effect.type),
    ['stop_mock', 'disconnect_client']
  );
});

function connectedState() {
  return {
    ...initialBleSessionState,
    bluetoothState: 'PoweredOn',
    connection: {
      phase: 'connected',
      device,
      status: 'connected',
      message: null,
    },
  };
}

function started(sessionId, kind) {
  return {
    event: 'measurement_started',
    v: protocolVersion,
    session_id: sessionId,
    source: 'phone',
    kind,
  };
}

function result(sessionId) {
  return {
    event: 'measurement_result',
    v: protocolVersion,
    session_id: sessionId,
    kind: 'measurement',
    alcohol_mg_l_x1000: 160,
    pulse: null,
  };
}
