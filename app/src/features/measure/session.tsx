import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import type { BleSession } from '@/lib/ble/session';
import {
  measurementReadinessDescription,
  type MeasurementStartBlocker,
} from '@/lib/ble/start-readiness';

export default function SessionSection({
  ble,
  baseline,
  sessionId,
  progress,
  hasResult,
  routeMatchesActive,
  active,
  blocker,
  contextLoadFailed,
}: Props) {
  return (
    <Section eyebrow="Session" title={baseline ? 'Baseline 측정' : sessionId}>
      <StatusRow label="세션 종류" value={baseline ? 'Baseline' : '일반 측정'} />
      <StatusRow
        label="연결 상태"
        value={ble.connectedDevice ? '연결됨' : '미연결'}
        description={ble.connectedDevice?.name ?? 'Drunksafe 장치 연결이 필요합니다.'}
        tone={ble.connectedDevice ? 'safe' : 'caution'}
      />
      <StatusRow
        label="진행률"
        value={`${hasResult ? 100 : progress}%`}
        description={measurementReadinessDescription({
          routeMatchesActive,
          activeMeasurement: active,
          hasResult,
          message: ble.message,
          blocker,
          contextLoadFailed,
        })}
        tone={hasResult ? 'safe' : ble.measurementPhase === 'error' ? 'danger' : 'caution'}
      />
      {ble.deviceErrorCode ? (
        <StatusRow label="오류" value={ble.deviceErrorCode} tone="danger" />
      ) : null}
    </Section>
  );
}

interface Props {
  ble: BleSession;
  baseline: boolean;
  sessionId: string;
  progress: number;
  hasResult: boolean;
  routeMatchesActive: boolean;
  active: boolean;
  blocker: MeasurementStartBlocker | null;
  contextLoadFailed: boolean;
}
