import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { estimateProfileEliminationMgLPerHourX1000 } from '@/lib/personalization/profile-context';
import {
  emptyBaseline,
  emptyProfile,
  readBaseline,
  readProfile,
  writeProfile,
  type Sex,
  type UserBaseline,
} from '@/lib/storage/profile';

const emptyForm: ProfileForm = {
  age: '',
  height: '',
  weight: '',
  sex: null,
};

export default function useProfileForm() {
  const [form, setForm] = useState(emptyForm);
  const [baseline, setBaseline] = useState<UserBaseline>(emptyBaseline);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useFocusEffect(
    useCallback(() => {
      let active = true;

      Promise.all([readProfile(), readBaseline()])
        .then(([profile, savedBaseline]) => {
          if (!active) return;

          setForm({
            age: profile.age_years?.toString() ?? '',
            height: profile.height_cm?.toString() ?? '',
            weight: profile.weight_kg?.toString() ?? '',
            sex: profile.sex,
          });
          setBaseline(savedBaseline);
        })
        .catch(() => {
          if (active) setSaveState('failed');
        });

      return () => {
        active = false;
      };
    }, [])
  );

  const parsed = parseForm(form);
  const complete =
    parsed.age !== null && parsed.height !== null && parsed.weight !== null && form.sex !== null;
  const profileElimination = estimateProfileEliminationMgLPerHourX1000({
    age_years: parsed.age,
    height_cm: parsed.height,
    weight_kg: parsed.weight,
    sex: form.sex,
  });

  const update = <Key extends keyof ProfileForm>(key: Key, value: ProfileForm[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveState('idle');
  };

  const save = async () => {
    if (!parsed.valid) {
      setSaveState('failed');
      return;
    }

    try {
      await writeProfile({
        ...emptyProfile,
        age_years: parsed.age,
        height_cm: parsed.height,
        weight_kg: parsed.weight,
        sex: form.sex,
      });
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  };

  return { form, baseline, saveState, complete, profileElimination, update, save };
}

function parseForm(form: ProfileForm) {
  const age = parseNullableInt(form.age, 1, 130);
  const height = parseNullableInt(form.height, 30, 250);
  const weight = parseNullableInt(form.weight, 2, 500);

  return {
    valid: age.valid && height.valid && weight.valid,
    age: age.value,
    height: height.value,
    weight: weight.value,
  };
}

function parseNullableInt(value: string, min: number, max: number): ParsedInteger {
  const trimmed = value.trim();

  if (!trimmed) return { valid: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { valid: false, value: null };

  const parsed = Number(trimmed);

  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? { valid: true, value: parsed }
    : { valid: false, value: null };
}

export interface ProfileForm {
  age: string;
  height: string;
  weight: string;
  sex: Sex | null;
}

export type SaveState = 'idle' | 'saved' | 'failed';

type ParsedInteger = { valid: true; value: number | null } | { valid: false; value: null };
