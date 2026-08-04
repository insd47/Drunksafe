import { Pressable, Text, TextInput, View } from 'react-native';

import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import type { Sex } from '@/lib/storage/profile';
import type { ProfileForm, SaveState } from '@/features/onboarding/use-profile-form';

export default function ProfileSection({ form, saveState, complete, onChange }: Props) {
  return (
    <Section eyebrow="Profile" title="사용자 정보">
      <ProfileInput
        label="나이"
        suffix="세"
        value={form.age}
        onChangeText={(value) => onChange('age', value)}
      />
      <ProfileInput
        label="키"
        suffix="cm"
        value={form.height}
        onChangeText={(value) => onChange('height', value)}
      />
      <ProfileInput
        label="몸무게"
        suffix="kg"
        value={form.weight}
        onChangeText={(value) => onChange('weight', value)}
      />
      <View className="gap-2 py-3">
        <Text className="text-sm font-medium text-gray-950">성별</Text>
        <View accessibilityLabel="성별" accessibilityRole="radiogroup" className="flex-row gap-2">
          <SexOption label="남성" value="male" selected={form.sex} onChange={onChange} />
          <SexOption label="여성" value="female" selected={form.sex} onChange={onChange} />
        </View>
      </View>
      <StatusRow
        label="저장 상태"
        value={saveLabels[saveState]}
        description={complete ? '프로필 context가 준비됐습니다.' : '부분 저장도 가능합니다.'}
        tone={saveState === 'failed' ? 'danger' : complete ? 'safe' : 'neutral'}
      />
    </Section>
  );
}

function ProfileInput({ label, suffix, value, onChangeText }: ProfileInputProps) {
  return (
    <View className="flex-row items-center justify-between gap-4 py-3">
      <Text className="text-sm font-medium text-gray-950">{label}</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          className="h-10 w-20 border border-gray-300 px-3 text-right text-sm text-gray-950"
          keyboardType="number-pad"
          onChangeText={onChangeText}
          placeholder="입력"
          value={value}
        />
        <Text className="w-8 text-sm text-gray-500">{suffix}</Text>
      </View>
    </View>
  );
}

function SexOption({ label, value, selected, onChange }: SexOptionProps) {
  const active = selected === value;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      aria-checked={active}
      className={
        active
          ? 'h-10 flex-1 items-center justify-center border border-gray-950 bg-gray-950 px-3'
          : 'h-10 flex-1 items-center justify-center border border-gray-300 px-3'
      }
      onPress={() => onChange('sex', value)}>
      <Text
        className={
          active ? 'text-sm font-semibold text-white' : 'text-sm font-semibold text-gray-950'
        }>
        {label}
      </Text>
    </Pressable>
  );
}

const saveLabels: Record<SaveState, string> = {
  idle: '대기',
  saved: '저장됨',
  failed: '실패',
};

interface Props {
  form: ProfileForm;
  saveState: SaveState;
  complete: boolean;
  onChange: <Key extends keyof ProfileForm>(key: Key, value: ProfileForm[Key]) => void;
}

interface ProfileInputProps {
  label: string;
  suffix: string;
  value: string;
  onChangeText: (value: string) => void;
}

interface SexOptionProps {
  label: string;
  value: Sex;
  selected: Sex | null;
  onChange: Props['onChange'];
}
