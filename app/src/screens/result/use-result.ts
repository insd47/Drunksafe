import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { useBleSession } from '@/lib/ble/session';
import {
  readMeasurementById,
  recordFromResult,
  type MeasurementKind,
  type MeasurementRecord,
} from '@/lib/storage/history';
import createDemoResult from '@/screens/result/demo';

const emptyLookup: SavedLookup = { id: null, record: null, state: 'idle' };

export default function useResult(): ResultViewModel {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ble = useBleSession();
  const initializeBle = ble.initialize;
  const [lookup, setLookup] = useState(emptyLookup);
  const liveResult = ble.result?.session_id === id ? ble.result : null;
  const demoKind = demoKindFromId(id);
  const savedRecord = lookup.id === id ? lookup.record : null;
  const liveRecord = useMemo(
    () => (liveResult ? recordFromResult(liveResult) : null),
    [liveResult]
  );
  const demoRecord = useMemo(
    () => (demoKind ? recordFromResult(createDemoResult(demoKind)) : null),
    [demoKind]
  );
  const record = liveRecord ?? savedRecord ?? demoRecord;
  const origin: ResultOrigin = liveRecord
    ? 'live'
    : savedRecord
      ? 'saved'
      : demoRecord
        ? 'preview'
        : 'missing';
  const loadState: RecordLoadState =
    liveResult || demoKind ? 'idle' : lookup.id === id ? lookup.state : 'loading';

  useEffect(() => {
    initializeBle();
  }, [initializeBle]);

  useEffect(() => {
    if (!id || liveResult || demoKind) return;

    let active = true;

    readMeasurementById(id)
      .then((record) => {
        if (active) setLookup({ id, record, state: 'loaded' });
      })
      .catch(() => {
        if (active) setLookup({ id, record: null, state: 'failed' });
      });

    return () => {
      active = false;
    };
  }, [demoKind, id, liveResult]);

  return {
    record,
    kind: record?.kind ?? demoKind ?? 'measurement',
    origin,
    loadState,
    saved: origin === 'saved' || (origin === 'live' && ble.resultSaved),
  };
}

function demoKindFromId(id?: string): MeasurementKind | null {
  if (id === 'baseline-demo') return 'baseline';
  if (id === 'demo-result') return 'measurement';
  return null;
}

export interface ResultViewModel {
  record: MeasurementRecord | null;
  kind: MeasurementKind;
  origin: ResultOrigin;
  loadState: RecordLoadState;
  saved: boolean;
}

export type ResultOrigin = 'live' | 'saved' | 'preview' | 'missing';
export type RecordLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

interface SavedLookup {
  id: string | null;
  record: MeasurementRecord | null;
  state: RecordLoadState;
}
