import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';

export function OnboardingScreen() {
  const [sex, setSex] = useState<'male' | 'female' | null>(null);

  return (
    <Screen>
      <Section eyebrow="Baseline" title="Sober 기준값">
        <StatusRow
          label="Baseline 세션"
          value="별도 측정"
          description="일반 음주 측정과 분리해서 저장합니다."
        />
        <StatusRow
          label="호기 baseline"
          value="미측정"
          description="완전 sober 상태에서 3회 이상 측정합니다."
        />
        <StatusRow
          label="안정시 BPM"
          value="미측정"
          description="Pulse가 안정적인 측정만 baseline에 반영합니다."
        />
      </Section>

      <Section eyebrow="Profile" title="사용자 정보">
        <ProfileInput label="나이" placeholder="입력" suffix="세" />
        <ProfileInput label="키" placeholder="입력" suffix="cm" />
        <ProfileInput label="몸무게" placeholder="입력" suffix="kg" />
        <View className="gap-2 py-3">
          <Text className="text-sm font-medium text-gray-950">성별</Text>
          <View className="flex-row gap-2">
            <Segment label="남성" selected={sex === 'male'} onPress={() => setSex('male')} />
            <Segment label="여성" selected={sex === 'female'} onPress={() => setSex('female')} />
          </View>
        </View>
      </Section>

      <Section eyebrow="Recovery" title="개인 분해 경향">
        <StatusRow
          label="개인 분해율"
          value="기본값"
          description="히스토리가 쌓이면 천천히 보정합니다."
        />
      </Section>

      <ActionLink href="/measure/baseline" label="Baseline 측정 시작" />
    </Screen>
  );
}

function ProfileInput({ label, placeholder, suffix }: ProfileInputProps) {
  return (
    <View className="flex-row items-center justify-between gap-4 py-3">
      <Text className="text-sm font-medium text-gray-950">{label}</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          className="h-10 w-20 border border-gray-300 px-3 text-right text-sm text-gray-950"
          keyboardType="number-pad"
          placeholder={placeholder}
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
};

type SegmentProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};
