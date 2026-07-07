import { useEffect, useMemo, useState } from 'react';
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
  formatDrivingDescription,
  formatDrivingStatus,
  formatMinutes,
  formatRisk,
  riskTone,
} from '@/lib/format/measurement';
import { baselineResultDescription } from '@/lib/personalization/baseline-acceptance';
import {
  readMeasurementById,
  recordFromResult,
  type MeasurementKind,
  type MeasurementRecord,
} from '@/lib/storage/history';

export function ResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ble = useBleSession();
  const initializeBle = ble.initialize;
  const liveResult = ble.result?.session_id === id ? ble.result : null;
  const [savedLookup, setSavedLookup] = useState<SavedLookup>({
    id: null,
    record: null,
    state: 'idle',
  });
  const demoKind =
    id === 'baseline-demo' ? 'baseline' : id === 'demo-result' ? 'measurement' : null;
  const savedRecord = savedLookup.id === id ? savedLookup.record : null;
  const recordLoadState =
    liveResult || demoKind ? 'idle' : savedLookup.id === id ? savedLookup.state : 'loading';
  const liveRecord = useMemo(
    () => (liveResult ? recordFromResult(liveResult) : null),
    [liveResult]
  );
  const demoRecord = useMemo(
    () => (demoKind ? recordFromResult(createDemoResult(demoKind)) : null),
    [demoKind]
  );
  const record = liveRecord ?? savedRecord ?? demoRecord;
  const kind: MeasurementKind = record?.kind ?? demoKind ?? 'measurement';
  const isPreview = !liveRecord && !savedRecord && Boolean(demoRecord);

  useEffect(() => {
    initializeBle();
  }, [initializeBle]);

  useEffect(() => {
    if (!id || liveResult || demoKind) {
      return;
    }

    let mounted = true;

    readMeasurementById(id)
      .then((record) => {
        if (!mounted) {
          return;
        }

        setSavedLookup({
          id,
          record,
          state: 'loaded',
        });
      })
      .catch(() => {
        if (mounted) {
          setSavedLookup({
            id,
            record: null,
            state: 'failed',
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, [demoKind, id, liveResult]);

  return (
    <Screen>
      <Section
        eyebrow="Result"
        title={
          record
            ? kind === 'baseline'
              ? 'Baseline 결과'
              : formatDrivingStatus(record.risk)
            : '결과 없음'
        }>
        {!record ? (
          <StatusRow
            label="저장 결과"
            value={recordLoadLabel[recordLoadState]}
            description="히스토리에 저장된 측정 결과를 찾지 못했습니다."
            tone={recordLoadState === 'failed' ? 'danger' : 'caution'}
          />
        ) : null}
        {kind !== 'baseline' ? (
          <StatusRow
            label="운전 상태"
            value={record ? formatDrivingStatus(record.risk) : '-'}
            description={record ? formatDrivingDescription(record.risk) : '저장 결과가 없습니다.'}
            tone={record ? riskTone(record.risk) : 'neutral'}
          />
        ) : null}
        {record ? (
          <>
            <StatusRow
              label="위험 단계"
              value={formatRisk(record.risk)}
              description={
                kind === 'baseline'
                  ? baselineResultDescription(record)
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
          </>
        ) : null}
      </Section>

      <Section eyebrow="Pulse" title="보조 지표">
        <StatusRow label="심박수" value={record ? formatBpm(record.pulse_bpm) : '-'} />
        {record ? (
          <StatusRow
            label="품질"
            value={formatPulseQuality(record.pulse_stable)}
            tone={
              record.pulse_stable === null ? 'neutral' : record.pulse_stable ? 'safe' : 'caution'
            }
          />
        ) : null}
        <StatusRow
          label="저장 상태"
          value={
            liveResult
              ? ble.resultSaved
                ? '저장됨'
                : '저장 실패'
              : savedRecord
                ? '저장됨'
                : isPreview
                  ? '미리보기'
                  : recordLoadLabel[recordLoadState]
          }
          description={
            liveResult
              ? 'BLE result를 기준으로 표시합니다.'
              : savedRecord
                ? '히스토리에 저장된 결과입니다.'
                : isPreview
                  ? '실측 BLE result가 붙으면 저장합니다.'
                  : '히스토리에서 결과를 불러옵니다.'
          }
          tone={
            liveResult && !ble.resultSaved
              ? 'danger'
              : liveResult || savedRecord
                ? 'safe'
                : recordLoadState === 'failed'
                  ? 'danger'
                  : 'neutral'
          }
        />
      </Section>

      <Separator />

      <ActionButton
        label={
          liveResult
            ? '결과 저장 완료'
            : savedRecord
              ? '저장된 결과'
              : kind === 'baseline'
                ? '실측 Baseline만 저장'
                : '실측 결과만 저장'
        }
        disabled
        onPress={() => {}}
      />
      <ActionLink
        href={kind === 'baseline' ? '/onboarding' : '/history'}
        label={kind === 'baseline' ? '온보딩에서 baseline 확인' : '히스토리에 저장된 기록 보기'}
      />
      <ActionLink href="/" label="연결 화면으로 돌아가기" variant="secondary" />
    </Screen>
  );
}

function createDemoResult(kind: MeasurementKind): MeasurementResult {
  const baseline = kind === 'baseline';

  return {
    v: protocolVersion,
    session_id: baseline ? 'baseline-demo' : 'demo-session',
    kind,
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

type SavedLookup = {
  id: string | null;
  record: MeasurementRecord | null;
  state: 'idle' | 'loading' | 'loaded' | 'failed';
};

const recordLoadLabel = {
  idle: '대기',
  loading: '불러오는 중',
  loaded: '없음',
  failed: '실패',
} as const;
