import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateProfileEliminationMgLPerHourX1000,
  isProfileComplete,
} from '@/lib/personalization/profile-context';

const completeProfile = {
  age_years: 32,
  height_cm: 174,
  weight_kg: 72,
  sex: 'male',
};

test('profile context requires every MVP profile field', () => {
  assert.equal(isProfileComplete(completeProfile), true);
  assert.equal(
    isProfileComplete({
      ...completeProfile,
      weight_kg: null,
    }),
    false
  );
  assert.equal(
    estimateProfileEliminationMgLPerHourX1000({
      ...completeProfile,
      sex: null,
    }),
    null
  );
});

test('profile fallback uses a conservative BrAC elimination rate', () => {
  assert.equal(estimateProfileEliminationMgLPerHourX1000(completeProfile), 62);
});

test('profile fallback does not overfit sex or body size without measured baseline data', () => {
  const femaleSmallBodyProfile = {
    age_years: 52,
    height_cm: 158,
    weight_kg: 49,
    sex: 'female',
  };

  assert.equal(
    estimateProfileEliminationMgLPerHourX1000(femaleSmallBodyProfile),
    estimateProfileEliminationMgLPerHourX1000(completeProfile)
  );
});
