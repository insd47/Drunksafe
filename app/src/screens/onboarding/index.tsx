import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import { formatAlcohol, formatBpm } from '@/lib/format/measurement';
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

export function OnboardingScreen() {
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [baseline, setBaseline] = useState<UserBaseline>(emptyBaseline);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');

  useEffect(() => {
    let mounted = true;

    Promise.all([readProfile(), readBaseline()])
      .then(([profile, savedBaseline]) => {
        if (!mounted) {
          return;
        }

        setAge(profile.age_years?.toString() ?? '');
        setHeight(profile.height_cm?.toString() ?? '');
        setWeight(profile.weight_kg?.toString() ?? '');
        setSex(profile.sex);
        setBaseline(savedBaseline);
      })
      .catch(() => {
        if (mounted) {
          setSaveState('failed');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const profileComplete =
    isValidRequiredInt(age, 1, 130) &&
    isValidRequiredInt(height, 30, 250) &&
    isValidRequiredInt(weight, 2, 500) &&
    sex !== null;
  const profileElimination = estimateProfileEliminationMgLPerHourX1000({
    age_years: parseNullableInt(age, 1, 130).value,
    height_cm: parseNullableInt(height, 30, 250).value,
    weight_kg: parseNullableInt(weight, 2, 500).value,
    sex,
  });

  async function handleSaveProfile() {
    const parsedAge = parseNullableInt(age, 1, 130);
    const parsedHeight = parseNullableInt(height, 30, 250);
    const parsedWeight = parseNullableInt(weight, 2, 500);

    if (!parsedAge.ok || !parsedHeight.ok || !parsedWeight.ok) {
      setSaveState('failed');
      return;
    }

    const nextProfile = {
      ...emptyProfile,
      age_years: parsedAge.value,
      height_cm: parsedHeight.value,
      weight_kg: parsedWeight.value,
      sex,
    };

    try {
      await writeProfile(nextProfile);
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  }

  return (
    <Screen>
      <Section eyebrow="Baseline" title="Sober 기준값">
        <StatusRow
          label="Baseline 세션"
          value={baseline.sample_count > 0 ? `${baseline.sample_count}회` : '미측정'}
          description={formatUpdatedAt(baseline.updated_at_unix_ms)}
          tone={baseline.sample_count > 0 ? 'safe' : 'caution'}
        />
        <StatusRow
          label="호기 baseline"
          value={
            baseline.sober_alcohol_mg_l_x1000 === null
              ? '미측정'
              : formatAlcohol(baseline.sober_alcohol_mg_l_x1000)
          }
          description="완전 sober 상태에서 3회 이상 측정합니다."
        />
        <StatusRow
          label="안정시 BPM"
          value={formatBpm(baseline.resting_bpm)}
          description="Pulse가 안정적인 측정만 baseline에 반영합니다."
        />
      </Section>

      <Section eyebrow="Profile" title="사용자 정보">
        <ProfileInput
          label="나이"
          placeholder="입력"
          suffix="세"
          value={age}
          onChangeText={setAge}
        />
        <ProfileInput
          label="키"
          placeholder="입력"
          suffix="cm"
          value={height}
          onChangeText={setHeight}
        />
        <ProfileInput
          label="몸무게"
          placeholder="입력"
          suffix="kg"
          value={weight}
          onChangeText={setWeight}
        />
        <View className="gap-2 py-3">
          <Text className="text-sm font-medium text-gray-950">성별</Text>
          <View className="flex-row gap-2">
            <Segment label="남성" selected={sex === 'male'} onPress={() => setSex('male')} />
            <Segment label="여성" selected={sex === 'female'} onPress={() => setSex('female')} />
          </View>
        </View>
        <StatusRow
          label="저장 상태"
          value={saveLabel[saveState]}
          description={
            profileComplete ? '프로필 context가 준비됐습니다.' : '부분 저장도 가능합니다.'
          }
          tone={saveState === 'failed' ? 'danger' : profileComplete ? 'safe' : 'neutral'}
        />
      </Section>

      <Section eyebrow="Recovery" title="개인 분해 경향">
        <StatusRow
          label="개인 분해율"
          value={formatElimination(baseline.elimination_mg_l_per_hour_x1000, profileElimination)}
          description="baseline 학습값이 없으면 프로필 기반 보수값을 씁니다."
        />
      </Section>

      <ActionButton label="프로필 저장" onPress={handleSaveProfile} />
      <ActionLink href="/measure/baseline" label="Baseline 측정 시작" />
    </Screen>
  );
}

function ProfileInput({ label, placeholder, suffix, value, onChangeText }: ProfileInputProps) {
  return (
    <View className="flex-row items-center justify-between gap-4 py-3">
      <Text className="text-sm font-medium text-gray-950">{label}</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          className="h-10 w-20 border border-gray-300 px-3 text-right text-sm text-gray-950"
          keyboardType="number-pad"
          onChangeText={onChangeText}
          placeholder={placeholder}
          value={value}
        />
        <Text className="w-8 text-sm text-gray-500">{suffix}</Text>
      </View>
    </View>
  );
}

function Segment({ label, selected, onPress }: SegmentProps) {
  return (
    <Pressable
      className={
        selected
          ? 'h-10 flex-1 items-center justify-center border border-gray-950 bg-gray-950 px-3'
          : 'h-10 flex-1 items-center justify-center border border-gray-300 px-3'
      }
      onPress={onPress}>
      <Text
        className={
          selected ? 'text-sm font-semibold text-white' : 'text-sm font-semibold text-gray-950'
        }>
        {label}
      </Text>
    </Pressable>
  );
}

type ProfileInputProps = {
  label: string;
  placeholder: string;
  suffix: string;
  value: string;
  onChangeText: (value: string) => void;
};

type SegmentProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

const saveLabel = {
  idle: '대기',
  saved: '저장됨',
  failed: '실패',
} as const;

function parseNullableInt(value: string, min: number, max: number): ParseResult {
  const trimmed = value.trim();

  if (!trimmed) {
    return { ok: true, value: null };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, value: null };
  }

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { ok: false, value: null };
  }

  return { ok: true, value: parsed };
}

function isValidRequiredInt(value: string, min: number, max: number) {
  const parsed = parseNullableInt(value, min, max);
  return parsed.ok && parsed.value !== null;
}

function formatElimination(value: number | null, fallback: number | null) {
  if (value === null) {
    return fallback === null ? '기본값' : `${formatAlcohol(fallback)}/h`;
  }

  return `${formatAlcohol(value)}/h`;
}

function formatUpdatedAt(value: number | null) {
  if (value === null) {
    return '일반 음주 측정과 분리해서 저장합니다.';
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

type ParseResult = { ok: true; value: number | null } | { ok: false; value: null };
