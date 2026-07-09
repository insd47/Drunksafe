import ActionButton from '@/components/action-button';
import ActionLink from '@/components/action-link';
import Screen from '@/components/screen';
import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import BaselineSection from '@/screens/onboarding/_views/baseline';
import ProfileSection from '@/screens/onboarding/_views/profile';
import { formatElimination } from '@/screens/onboarding/format';
import useProfileForm from '@/screens/onboarding/use-profile-form';

export default function OnboardingScreen() {
  const profile = useProfileForm();

  return (
    <Screen>
      <BaselineSection baseline={profile.baseline} />
      <ProfileSection
        form={profile.form}
        saveState={profile.saveState}
        complete={profile.complete}
        onChange={profile.update}
      />
      <Section eyebrow="Recovery" title="개인 분해 경향">
        <StatusRow
          label="개인 분해율"
          value={formatElimination(
            profile.baseline.elimination_mg_l_per_hour_x1000,
            profile.profileElimination
          )}
          description="baseline 학습값이 없으면 프로필 기반 보수값을 씁니다."
        />
      </Section>

      <ActionButton label="프로필 저장" onPress={() => void profile.save()} />
      <ActionLink href="/measure/baseline" label="Baseline 측정 시작" />
    </Screen>
  );
}
