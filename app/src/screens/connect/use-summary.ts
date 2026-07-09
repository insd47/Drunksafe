import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { isProfileComplete } from '@/lib/personalization/profile-context';
import { readHistory, type MeasurementRecord } from '@/lib/storage/history';
import { readBaseline, readProfile } from '@/lib/storage/profile';

const emptySummary: ConnectionSummary = {
  baselineReady: false,
  profileReady: false,
  recentCount: 0,
  latest: null,
  failed: false,
};

export default function useConnectionSummary() {
  const [summary, setSummary] = useState(emptySummary);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      Promise.all([readProfile(), readBaseline(), readHistory()])
        .then(([profile, baseline, history]) => {
          if (!active) return;

          setSummary({
            baselineReady: baseline.sample_count > 0,
            profileReady: isProfileComplete(profile),
            recentCount: history.filter((record) => record.kind === 'measurement').length,
            latest: history.find((record) => record.kind === 'measurement') ?? null,
            failed: false,
          });
        })
        .catch(() => {
          if (!active) return;

          setSummary({ ...emptySummary, failed: true });
        });

      return () => {
        active = false;
      };
    }, [])
  );

  return summary;
}

export interface ConnectionSummary {
  baselineReady: boolean;
  profileReady: boolean;
  recentCount: number;
  latest: MeasurementRecord | null;
  failed: boolean;
}
