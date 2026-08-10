import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Banner } from '@/components/banner';
import { LegalNotice } from '@/components/legal-notice';
import { Screen } from '@/components/screen';
import { StatusRow } from '@/components/status-row';
import { cn } from '@/lib/utils/cn';
import type { Risk } from '@/lib/ble/model';
import { useBleSession } from '@/lib/ble/session';
import {
  formatAlcohol,
  formatBac,
  formatBpm,
  formatDrivingStatus,
  formatMeasuredAt,
  formatMinutes,
} from '@/lib/format/measurement';
import {
  readMeasurementById,
  recordFromResult,
  type MeasurementRecord,
} from '@/lib/storage/history';

/** 판정을 먼저 보여주고 근거는 접어 둔다. */
export default function ResultRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const ble = useBleSession();
  const liveResult = ble.result?.session_id === id ? ble.result : null;
  const [lookup, setLookup] = useState<SavedLookup>({ id: null, record: null });
  const liveRecord = useMemo(
    () => (liveResult ? recordFromResult(liveResult) : null),
    [liveResult]
  );
  const record = liveRecord ?? (lookup.id === id ? lookup.record : null);
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
      {liveResult && !ble.resultSaved ? (
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
        <StatusRow label="신뢰도" value={`${record.confidence_percent}%`} />
        <StatusRow label="심박수" value={formatBpm(record.pulse_bpm)} />
        <StatusRow label="측정 시각" value={formatMeasuredAt(record.measured_at_unix_ms)} />
      </Details>
    </>
  );
}

function BaselineSummary({ record }: { record: MeasurementRecord }) {
  return (
    <>
      <View className="gap-2 border-2 border-gray-950 p-6">
        <Text className="text-2xl font-bold text-gray-950">기준값이 기록되었습니다</Text>
        <Text className="text-sm leading-6 text-gray-600">
          술을 마시지 않은 상태의 측정값을 기준으로 삼아 다음 측정 결과를 더 정확하게 계산합니다.
        </Text>
      </View>

      <Details>
        <StatusRow label="호기 알코올" value={formatAlcohol(record.alcohol_mg_l_x1000)} />
        <StatusRow label="심박수" value={formatBpm(record.pulse_bpm)} />
        <StatusRow label="측정 시각" value={formatMeasuredAt(record.measured_at_unix_ms)} />
      </Details>
    </>
  );
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
