import { useEffect, useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ActionButton } from '@/components/action-button';
import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { Separator } from '@/components/separator';
import { StatusRow } from '@/components/status-row';
import { protocolVersion, type MeasurementResult } from '@/lib/ble/model';
import { useBleSession } from '@/lib/ble/session';
import {
  formatAlcohol,
  formatBac,
  formatBpm,
  formatMinutes,
  formatRisk,
  riskTone,
} from '@/lib/format/measurement';
import { recordFromResult, type MeasurementKind } from '@/lib/storage/history';

export function ResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ble = useBleSession();
  const initializeBle = ble.initialize;
  const liveResult = ble.result?.session_id === id ? ble.result : null;
  const kind: MeasurementKind = liveResult
    ? ble.activeMeasurementKind
    : id === 'baseline-demo'
      ? 'baseline'
      : 'measurement';
  const result = useMemo(() => liveResult ?? createDemoResult(kind), [kind, liveResult]);
  const record = useMemo(() => recordFromResult(result, kind), [kind, result]);

  useEffect(() => {
    initializeBle();
  }, [initializeBle]);

  return (
    <Screen>
      <Section eyebrow="Result" title={kind === 'baseline' ? 'Baseline 결과' : '운전 금지'}>
        <StatusRow
          label="위험 단계"
          value={formatRisk(record.risk)}
          description={
            kind === 'baseline'
              ? '개인 sober 기준값으로 저장할 수 있습니다.'
              : '보수적 BAC 상한 기준으로 판단했습니다.'
          }
          tone={riskTone(record.risk)}
        />
        <StatusRow label="호기 알코올" value={formatAlcohol(record.alcohol_mg_l_x1000)} />
        <StatusRow label="BAC 추정" value={formatBac(record.bac_milli_percent)} />
        <StatusRow
          label="BAC 상한"
          value={formatBac(record.bac_upper_milli_percent)}
          tone={record.risk === 'danger' ? 'danger' : 'neutral'}
        />
        <StatusRow
          label="해소 예상"
          value={formatMinutes(record.sober_time_minutes)}
          description="최근 히스토리 기준 추정값입니다."
        />
        <StatusRow label="신뢰도" value={`${record.confidence_percent}%`} />
      </Section>

      <Section eyebrow="Pulse" title="보조 지표">
        <StatusRow label="심박수" value={formatBpm(record.pulse_bpm)} />
        <StatusRow
          label="품질"
          value={formatPulseQuality(record.pulse_stable)}
          tone={record.pulse_stable === null ? 'neutral' : record.pulse_stable ? 'safe' : 'caution'}
        />
        <StatusRow
          label="저장 상태"
          value={liveResult ? (ble.resultSaved ? '저장됨' : '저장 실패') : '미리보기'}
          description={
            liveResult
              ? 'BLE result를 기준으로 표시합니다.'
              : '실측 BLE result가 붙으면 저장합니다.'
          }
          tone={liveResult && !ble.resultSaved ? 'danger' : liveResult ? 'safe' : 'neutral'}
        />
      </Section>

      <Separator />

      <ActionButton
        label={
          liveResult
            ? '결과 저장 완료'
            : kind === 'baseline'
              ? '실측 Baseline만 저장'
              : '실측 결과만 저장'
        }
        disabled
        onPress={() => {}}
      />
      <ActionLink href="/history" label="히스토리에 저장된 기록 보기" />
      <ActionLink href="/" label="연결 화면으로 돌아가기" variant="secondary" />
    </Screen>
  );
}

function createDemoResult(kind: MeasurementKind): MeasurementResult {
  const baseline = kind === 'baseline';

  return {
    v: protocolVersion,
    session_id: baseline ? 'baseline-demo' : 'demo-session',
    measured_at_unix_ms: Date.now(),
    alcohol: {
      mg_l_x1000: baseline ? 8 : 80,
    },
    pulse: {
      bpm: baseline ? 72 : 92,
      stable: true,
      confidence_percent: baseline ? 88 : 82,
    },
    bac_milli_percent: baseline ? 4 : 38,
    bac_upper_milli_percent: baseline ? 6 : 46,
    sober_time_minutes: baseline ? null : 130,
    risk: baseline ? 'safe' : 'danger',
    confidence_percent: baseline ? 88 : 82,
  };
}

function formatPulseQuality(value: boolean | null) {
  if (value === null) {
    return '미측정';
  }

  return value ? '안정' : '불안정';
}
