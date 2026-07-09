import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { isProfileComplete } from '@/lib/personalization/profile-context';
import { latestMeasurement, readHistory, type MeasurementRecord } from '@/lib/storage/history';
import { emptyBaseline, emptyProfile, readBaseline, readProfile } from '@/lib/storage/profile';

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

      Promise.all([readProfile(), readBaseline(), readHistory(), latestMeasurement()])
        .then(([profile, baseline, history, latest]) => {
          if (!active) return;

          setSummary({
            baselineReady: baseline.sample_count > 0,
            profileReady: isProfileComplete(profile),
            recentCount: history.filter((record) => record.kind === 'measurement').length,
            latest,
            failed: false,
          });
        })
        .catch(() => {
          if (!active) return;

          setSummary({
            baselineReady: emptyBaseline.sample_count > 0,
            profileReady: Boolean(emptyProfile.sex),
            recentCount: 0,
            latest: null,
            failed: true,
          });
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
