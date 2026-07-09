import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { isProfileComplete } from '@/lib/personalization/profile-context';
import { readBaseline, readProfile } from '@/lib/storage/profile';

export default function useContextReadiness() {
  const [state, setState] = useState<ContextReadiness>({ ready: false, failed: false });

  useFocusEffect(
    useCallback(() => {
      let active = true;

      Promise.all([readProfile(), readBaseline()])
        .then(([profile, baseline]) => {
          if (!active) return;
          setState({
            ready: baseline.sample_count > 0 || isProfileComplete(profile),
            failed: false,
          });
        })
        .catch(() => {
          if (active) setState({ ready: false, failed: true });
        });

      return () => {
        active = false;
      };
    }, [])
  );

  return state;
}

interface ContextReadiness {
  ready: boolean;
  failed: boolean;
}
