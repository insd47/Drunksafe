import { useEffect, useState, type PropsWithChildren } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Banner } from '@/components/banner';
import { LegalNotice } from '@/components/legal-notice';
import { pulseIssueCopy } from '@/components/pulse-issue-copy';
import { Screen } from '@/components/screen';
import { StatusRow } from '@/components/status-row';
import { cn } from '@/lib/utils/cn';
import { useBleSession } from '@/lib/ble/session';
import {
  baselineIssueCopy,
  baselineIssues,
  shouldUpdateSoberBaseline,
} from '@/lib/personalization/baseline-acceptance';
import {
  formatAlcohol,
  formatBac,
  formatBpm,
  formatDrivingStatus,
  formatMeasuredAt,
  formatMinutes,
} from '@/lib/format/measurement';
import { readMeasurementById, type MeasurementRecord, type Risk } from '@/lib/storage/history';

/** 판정을 먼저 보여주고 근거는 접어 둔다. */
export default function ResultRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const ble = useBleSession();
  const measurement = ble.measurement;
  /** 방금 끝난 측정이 이 화면의 세션이면 저장을 기다리지 않고 그대로 보여준다. */
  const liveResult =
    measurement.phase === 'result' && measurement.record.session_id === id
      ? measurement.record
      : null;
  const liveResultUnsaved =
    measurement.phase === 'result' && measurement.record.session_id === id && !measurement.saved;
  const [lookup, setLookup] = useState<SavedLookup>({ id: null, record: null });
  const record = liveResult ?? (lookup.id === id ? lookup.record : null);
  const loading = !record && lookup.id !== id;

  useEffect(() => {
    if (!id || liveResult) {
      return;
    }

    let mounted = true;

    readMeasurementById(id)
      .then((saved) => {
        if (mounted) {
          setLookup({ id, record: saved });
        }
      })
      .catch(() => {
        if (mounted) {
          setLookup({ id, record: null });
        }
      });

    return () => {
      mounted = false;
    };
  }, [id, liveResult]);

  function close() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/');
  }

  return (
    <Screen>
      {liveResultUnsaved ? (
        <Banner
          description="기록 탭에 남지 않을 수 있습니다."
          title="결과를 저장하지 못했습니다"
          tone="danger"
        />
      ) : null}

      {record ? (
        record.kind === 'baseline' ? (
          <BaselineSummary record={record} />
        ) : (
          <MeasurementSummary record={record} />
        )
      ) : (
        <View className="gap-1 border border-gray-200 p-4">
          <Text className="text-sm font-semibold text-gray-950">
            {loading ? '결과를 불러오는 중입니다' : '결과를 찾지 못했습니다'}
          </Text>
          <Text className="text-xs leading-5 text-gray-500">
            기록 탭에서 저장된 측정을 확인할 수 있습니다.
          </Text>
        </View>
      )}

      <LegalNotice />

      <ActionButton
        label="기록 보기"
        onPress={() => {
          router.navigate('/history');
        }}
      />
      <ActionButton label="닫기" onPress={close} variant="secondary" />
    </Screen>
  );
}

function MeasurementSummary({ record }: { record: MeasurementRecord }) {
  const ble = useBleSession();

  useEffect(() => {
    if (record.risk === 'danger') {
      // 위험 수준일 경우 BLE 기기로 WARN 신호를 보내 진동과 부저를 울립니다.
      ble.sendWarnSignal();
    }
  }, [record.risk, ble]);

  return (
    <>
      <VerdictBanner risk={record.risk} />

      <View className="items-center gap-1">
        <Text className="text-xs font-medium text-gray-500">BAC 상한</Text>
        <Text className="text-5xl font-bold text-gray-950">
          {formatBac(record.bac_upper_milli_percent ?? record.bac_milli_percent)}
        </Text>
      </View>

      <Text className="text-center text-xl text-gray-950">
        {record.sober_time_minutes === null
          ? '해소 예상 시간을 계산할 수 없습니다'
          : `약 ${formatMinutes(record.sober_time_minutes)} 후 해소 예상`}
      </Text>

      <Details>
        <StatusRow label="호기 알코올" value={formatAlcohol(record.alcohol_mg_l_x1000)} />
        <StatusRow label="BAC 추정" value={formatBac(record.bac_milli_percent)} />
        <StatusRow
          description="통계적 신뢰구간이 아니라 baseline·개인 분해속도·최근 기록·심박 확보 여부를 합산한 내부 분석 완성도 점수입니다."
          label="분석 완성도(참고)"
          value={`${record.confidence_percent}%`}
        />
        <PulseStatusRow record={record} />
        <StatusRow label="측정 시각" value={formatMeasuredAt(record.measured_at_unix_ms)} />
      </Details>
    </>
  );
}

function BaselineSummary({ record }: { record: MeasurementRecord }) {
  const accepted = shouldUpdateSoberBaseline(record);
  const issues = baselineIssues({
    risk: record.risk,
    alcohol_mg_l_x1000: record.alcohol_mg_l_x1000,
    pulse_bpm: record.pulse_bpm,
    pulse_stable: record.pulse_stable,
  });
  return (
    <>
      <View
        className={cn(
          'gap-2 border-2 p-6',
          accepted ? 'border-emerald-600' : 'border-amber-500 bg-amber-50'
        )}>
        <Text className="text-2xl font-bold text-gray-950">
          {accepted ? '기준값이 기록되었습니다' : '기준값으로 사용할 수 없습니다'}
        </Text>
        <Text className="text-sm leading-6 text-gray-600">
          {accepted
            ? '술을 마시지 않은 상태의 측정값을 기준으로 삼아 다음 측정 결과를 더 정확하게 계산합니다.'
            : '측정 기록은 남기지만 기존 개인 baseline에는 반영하지 않았습니다.'}
        </Text>
      </View>
      {!accepted
        ? issues.map((issue) => {
            const copy = baselineIssueCopy(issue);
            return (
              <View className="gap-1 border border-amber-300 bg-amber-50 p-4" key={issue}>
                <Text className="font-semibold text-amber-950">{copy.title}</Text>
                <Text className="text-sm leading-6 text-amber-900">{copy.description}</Text>
              </View>
            );
          })
        : null}

      <Details>
        <StatusRow label="호기 알코올" value={formatAlcohol(record.alcohol_mg_l_x1000)} />
        <PulseStatusRow record={record} />
        <StatusRow label="측정 시각" value={formatMeasuredAt(record.measured_at_unix_ms)} />
      </Details>
    </>
  );
}

function PulseStatusRow({ record }: { record: MeasurementRecord }) {
  const value = formatBpm(record.pulse_bpm);

  if (record.pulse_issue_reason === null) {
    return <StatusRow label="심박수" value={value} />;
  }

  const copy = pulseIssueCopy(record.pulse_issue_reason);
  return <StatusRow description={`${copy.title} · ${copy.action}`} label="심박수" value={value} />;
}

function VerdictBanner({ risk }: { risk: Risk }) {
  return (
    <View className={cn('items-center gap-2 p-6', verdictBoxClass[risk])}>
      <Text className={cn('text-3xl', verdictTextClass[risk])}>{verdictIcon[risk]}</Text>
      <Text className={cn('text-3xl font-bold', verdictTextClass[risk])}>
        {formatDrivingStatus(risk)}
      </Text>
    </View>
  );
}

function Details({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);

  return (
    <View className="gap-3">
      <Pressable
        accessibilityLabel="자세히 보기"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}>
        <Text className="text-sm font-semibold text-gray-950">{open ? '▾' : '▸'} 자세히 보기</Text>
      </Pressable>
      {open ? <View className="gap-1 border-y border-gray-200">{children}</View> : null}
    </View>
  );
}

type SavedLookup = {
  id: string | null;
  record: MeasurementRecord | null;
};

const verdictBoxClass: Record<Risk, string> = {
  danger: 'border border-red-600 bg-red-600',
  caution: 'border border-amber-500 bg-amber-500',
  safe: 'border-2 border-emerald-600 bg-white',
};

const verdictTextClass: Record<Risk, string> = {
  danger: 'text-white',
  caution: 'text-gray-950',
  safe: 'text-emerald-700',
};

const verdictIcon: Record<Risk, string> = {
  danger: '⛔',
  caution: '⚠️',
  safe: '✔︎',
};
