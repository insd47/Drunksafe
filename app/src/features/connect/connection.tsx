import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import type { BleSession } from '@/lib/ble/session';
import {
  measurementStartBlockerMessage,
  type MeasurementStartBlocker,
} from '@/lib/ble/start-readiness';
import {
  bluetoothLabel,
  bluetoothTone,
  connectionLabel,
  connectionTone,
  measurementLabel,
  measurementTone,
} from '@/features/connect/labels';
import type { ConnectionSummary } from '@/features/connect/use-summary';

export default function ConnectionSection({ ble, summary, contextReady, startBlocker }: Props) {
  return (
    <Section eyebrow="BLE" title="장치 연결">
      <StatusRow
        label="Bluetooth"
        value={ble.mockMode ? '데모' : bluetoothLabel(ble.bluetoothState)}
        description={
          ble.mockMode
            ? '시뮬레이터 데모 장치로 앱 흐름을 검증합니다.'
            : (ble.message ?? '근처 Drunksafe 장치를 검색할 수 있습니다.')
        }
        tone={ble.mockMode ? 'safe' : bluetoothTone(ble.bluetoothState)}
      />
      <StatusRow
        label="스캔"
        value={connectionLabel(ble.connectionPhase)}
        description={
          ble.devices.length > 0
            ? `${ble.devices.length}개 장치를 찾았습니다.`
            : 'Drunksafe 보드 notify를 받을 준비가 됐습니다.'
        }
        tone={connectionTone(ble.connectionPhase)}
      />
      <StatusRow
        label="연결"
        value={ble.connectedDevice?.name ?? '미연결'}
        description={
          ble.mockMode
            ? '실제 BLE 없이 측정 이벤트를 재생합니다.'
            : ble.connectedDevice
              ? '측정 시작과 context 전송이 가능합니다.'
              : '연결되면 측정 context를 보낼 수 있습니다.'
        }
        tone={ble.connectedDevice ? 'safe' : 'neutral'}
      />
      <StatusRow
        label="Context"
        value={contextReady ? '준비됨' : '필요'}
        description={
          summary.failed
            ? '로컬 context를 불러오지 못했습니다.'
            : '프로필 파생값, baseline, 최근 히스토리를 보냅니다.'
        }
        tone={summary.failed ? 'danger' : contextReady ? 'safe' : 'caution'}
      />
      <StatusRow
        label="측정"
        value={measurementLabel(ble.measurementPhase)}
        description={
          measurementStartBlockerMessage(startBlocker) ??
          ble.activeSessionId ??
          '아직 활성 세션이 없습니다.'
        }
        tone={measurementTone(ble.measurementPhase)}
      />
    </Section>
  );
}

interface Props {
  ble: BleSession;
  summary: ConnectionSummary;
  contextReady: boolean;
  startBlocker: MeasurementStartBlocker | null;
}
