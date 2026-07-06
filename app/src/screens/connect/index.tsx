import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { Separator } from '@/components/separator';
import { StatusRow } from '@/components/status-row';
import { formatBac, formatMinutes, formatRisk, riskTone } from '@/lib/format/measurement';
import { latestMeasurement, readHistory, type MeasurementRecord } from '@/lib/storage/history';
import { emptyBaseline, emptyProfile, readBaseline, readProfile } from '@/lib/storage/profile';

export function ConnectScreen() {
  const [summary, setSummary] = useState<Summary>({
    baselineReady: false,
    profileReady: false,
    recentCount: 0,
    latest: null,
    failed: false,
  });

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      Promise.all([readProfile(), readBaseline(), readHistory(), latestMeasurement()])
        .then(([profile, baseline, history, latest]) => {
          if (!mounted) {
            return;
          }

          setSummary({
            baselineReady: baseline.sample_count > 0,
            profileReady: Boolean(
              profile.age_years && profile.height_cm && profile.weight_kg && profile.sex
            ),
            recentCount: history.filter((record) => record.kind === 'measurement').length,
            latest,
            failed: false,
          });
        })
        .catch(() => {
          if (mounted) {
            setSummary({
              baselineReady: emptyBaseline.sample_count > 0,
              profileReady: Boolean(emptyProfile.sex),
              recentCount: 0,
              latest: null,
              failed: true,
            });
          }
        });

      return () => {
        mounted = false;
      };
    }, [])
  );

  const contextReady = summary.baselineReady;

  return (
    <Screen>
      <Section eyebrow="BLE" title="장치 연결">
        <StatusRow
          label="스캔"
          value="대기"
          description="Drunksafe 보드 notify를 받을 준비가 됐습니다."
        />
        <StatusRow
          label="연결"
          value="미연결"
          description="연결되면 측정 context를 보낼 수 있습니다."
        />
        <StatusRow
          label="Context"
          value={contextReady ? '준비됨' : '필요'}
          description={
            summary.failed
              ? '로컬 context를 불러오지 못했습니다.'
              : 'baseline과 최근 히스토리를 보냅니다.'
          }
          tone={summary.failed ? 'danger' : contextReady ? 'safe' : 'caution'}
        />
      </Section>

      <Section eyebrow="Context" title="개인화 준비">
        <StatusRow
          label="Sober baseline"
          value={summary.baselineReady ? '준비됨' : '미측정'}
          description="완전 sober 상태에서 별도 세션으로 잡습니다."
          tone={summary.baselineReady ? 'safe' : 'caution'}
        />
        <StatusRow
          label="최근 히스토리"
          value={`${summary.recentCount}건`}
          description="알코올 해소 추정에는 최근 기록이 필요합니다."
        />
        <StatusRow
          label="프로필"
          value={summary.profileReady ? '입력됨' : '미입력'}
          description="나이, 키, 몸무게, 성별은 앱 안에서만 보관합니다."
          tone={summary.profileReady ? 'safe' : 'neutral'}
        />
      </Section>

      <Section eyebrow="최근 결과" title="마지막 측정">
        {summary.latest ? (
          <>
            <StatusRow
              label="위험 단계"
              value={formatRisk(summary.latest.risk)}
              description={formatBac(
                summary.latest.bac_upper_milli_percent ?? summary.latest.bac_milli_percent
              )}
              tone={riskTone(summary.latest.risk)}
            />
            <StatusRow
              label="해소 예상"
              value={formatMinutes(summary.latest.sober_time_minutes)}
              description="최근 히스토리 기준 추정값입니다."
            />
          </>
        ) : (
          <>
            <StatusRow
              label="위험 단계"
              value="기록 없음"
              description="첫 일반 측정 후 결과가 저장됩니다."
            />
            <StatusRow
              label="해소 예상"
              value="-"
              description="최근 히스토리가 쌓이면 계산합니다."
            />
          </>
        )}
      </Section>

      <Separator />

      <ActionLink href="/onboarding" label="온보딩 시작" />
      <ActionLink href="/measure/demo-session" label="측정 화면 미리보기" variant="secondary" />
      <ActionLink href="/history" label="히스토리 보기" variant="secondary" />
    </Screen>
  );
}

type Summary = {
  baselineReady: boolean;
  profileReady: boolean;
  recentCount: number;
  latest: MeasurementRecord | null;
  failed: boolean;
};
