import type { UserProfile } from '@/lib/storage/profile';

const conservativeBacEliminationMilliPercentPerHour = 13;

export function isProfileComplete(profile: UserProfile) {
  return (
    profile.age_years !== null &&
    profile.height_cm !== null &&
    profile.weight_kg !== null &&
    profile.sex !== null
  );
}

export function estimateProfileEliminationMgLPerHourX1000(profile: UserProfile) {
  if (!isProfileComplete(profile)) {
    return null;
  }

  return bacMilliPercentPerHourToBracMgLPerHourX1000(conservativeBacEliminationMilliPercentPerHour);
}

function bacMilliPercentPerHourToBracMgLPerHourX1000(bacMilliPercentPerHour: number) {
  return Math.ceil((bacMilliPercentPerHour * 100) / 21);
}
