import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeSession } from '@/lib/personalization/session-insight';

test('R0 and peak delta use the baseline saved with the session', () => {
  const insight = analyzeSession(session({ resting_bpm: 72, heartBpms: [91, 78, 96] }), null, 65);

  assert.equal(insight.hr.r0, 72);
  assert.equal(insight.hr.peakDeltaVsR0, 24);
});

test('legacy sessions use measured profile baseline, never session minimum or first BPM', () => {
  const insight = analyzeSession(session({ heartBpms: [91, 78, 96] }), null, 70);

  assert.equal(insight.hr.r0, 70);
  assert.equal(insight.hr.peakDeltaVsR0, 26);
});

test('R0 is unavailable when neither stored nor profile baseline exists', () => {
  const insight = analyzeSession(session({ heartBpms: [61, 80, 95] }), null);

  assert.equal(insight.hr.r0, null);
  assert.equal(insight.hr.peakDeltaVsR0, null);
});

test('one BrAC sample at 0.020 mg/L confirms drinking without a button event', () => {
  const insight = analyzeSession(session({ heartBpms: [], alcoholValues: [8, 20] }), null);

  assert.equal(insight.drinkConfirmed, true);
  assert.deepEqual(
    insight.alcoholMeasurements.map((measurement) => measurement.mgLX1000),
    [8, 20]
  );
});

test('BrAC values below 0.020 mg/L do not confirm drinking by themselves', () => {
  const insight = analyzeSession(session({ heartBpms: [], alcoholValues: [19] }), null);

  assert.equal(insight.drinkConfirmed, false);
});

function session({ resting_bpm, heartBpms, alcoholValues = [] }) {
  const heartSamples = heartBpms.map((bpm, index) => ({
    t_ms: index * 60_000,
    at_unix_ms: 900_000 + index * 60_000,
    kind: 'heart',
    state: null,
    mg_l_x1000: null,
    bpm,
  }));
  const alcoholSamples = alcoholValues.map((mg_l_x1000, index) => ({
    t_ms: (heartSamples.length + index) * 60_000,
    at_unix_ms: 900_000 + (heartSamples.length + index) * 60_000,
    kind: 'alcohol',
    state: null,
    mg_l_x1000,
    bpm: null,
  }));
  return {
    id: 'session-test',
    downloaded_at_unix_ms: 1_000_000,
    session_start_unix_ms: 900_000,
    ...(resting_bpm === undefined ? {} : { resting_bpm }),
    samples: [...heartSamples, ...alcoholSamples],
  };
}
