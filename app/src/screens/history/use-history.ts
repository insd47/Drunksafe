import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { readHistory, type MeasurementRecord } from '@/lib/storage/history';

export default function useHistory() {
  const [records, setRecords] = useState<MeasurementRecord[]>([]);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      readHistory()
        .then((history) => {
          if (!active) return;
          setRecords(history.filter((record) => record.kind === 'measurement'));
          setFailed(false);
        })
        .catch(() => {
          if (!active) return;
          setRecords([]);
          setFailed(true);
        });

      return () => {
        active = false;
      };
    }, [])
  );

  return { records, failed };
}
