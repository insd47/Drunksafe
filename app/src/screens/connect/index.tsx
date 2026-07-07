import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';

import { ActionButton } from '@/components/action-button';
import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { Separator } from '@/components/separator';
import { StatusRow } from '@/components/status-row';
import { canRequestBleScan } from '@/lib/ble/connection-readiness';
import { hasActiveMeasurement } from '@/lib/ble/measurement-phase';
import { useBleSession, type BleConnectionPhase } from '@/lib/ble/session';
import { measurementStartBlocker, measurementStartBlockerMessage } from '@/lib/ble/start-readiness';
import {
  isBleVerificationAckCorrelated,
  type BleVerificationEvidenceSummary,
  type BleVerificationLogEntry,
} from '@/lib/ble/verification-log';
import {
  formatBac,
  formatDrivingStatus,
  formatMinutes,
  formatRisk,
  riskTone,
} from '@/lib/format/measurement';
import { latestMeasurement, readHistory, type MeasurementRecord } from '@/lib/storage/history';
import { isProfileComplete } from '@/lib/personalization/profile-context';
import { emptyBaseline, emptyProfile, readBaseline, readProfile } from '@/lib/storage/profile';

export function ConnectScreen() {
  const router = useRouter();
  const ble = useBleSession();
  const initializeBle = ble.initialize;
  const [summary, setSummary] = useState<Summary>({
    baselineReady: false,
    profileReady: false,
    recentCount: 0,
    latest: null,
    failed: false,
  });

  useEffect(() => {
    initializeBle();
  }, [initializeBle]);

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
            profileReady: isProfileComplete(profile),
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

  const contextReady = summary.baselineReady || summary.profileReady;
  const scanDisabled =
    ble.mockMode || ble.connectionPhase === 'connecting' || !canRequestBleScan(ble.bluetoothState);
  const startBlocker = measurementStartBlocker({
    connected: Boolean(ble.connectedDevice),
    activeMeasurement: hasActiveMeasurement(ble),
    contextReady,
    mockMode: ble.mockMode,
  });
  const measurementDisabled = startBlocker !== null;
  const verificationEvidence = ble.verificationEvidence;
  const ackCorrelated = isBleVerificationAckCorrelated(verificationEvidence);
  const showMockConnection =
    !ble.connectedDevice &&
    (ble.bluetoothState === 'Unsupported' ||
      ble.connectionPhase === 'unsupported' ||
      ble.connectionPhase === 'bluetooth_off');

  const handleScan = () => {
    if (ble.connectionPhase === 'scanning') {
      void ble.stopScan();
      return;
    }

    void ble.startScan();
  };

  const handleStartMeasurement = () => {
    if (startBlocker) {
      return;
    }

    void ble.startMeasurement();
    router.push(`/measure/${ble.activeSessionId ?? 'live'}`);
  };

  const handleMockConnection = () => {
    void ble.connectMockDevice();
  };

  return (
    <Screen>
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
          tone={
            ble.measurementPhase === 'error'
              ? 'danger'
              : ble.measurementPhase === 'result'
                ? 'safe'
                : ble.measurementPhase === 'idle'
                  ? 'neutral'
                  : 'caution'
          }
        />
      </Section>

      {ble.devices.length > 0 ? (
        <Section eyebrow="Scan" title="발견된 장치">
          {ble.devices.map((device) => (
            <StatusRow
              key={device.id}
              label={device.name}
              value={device.rssi === null ? 'RSSI -' : `${device.rssi} dBm`}
              description={device.id}
            />
          ))}
        </Section>
      ) : null}

      <Section eyebrow="Control" title="측정 제어">
        <ActionButton
          label={ble.connectionPhase === 'scanning' ? '스캔 중지' : 'Drunksafe 스캔'}
          disabled={scanDisabled}
          onPress={handleScan}
        />
        {showMockConnection ? (
          <ActionButton
            label="시뮬레이터 데모 연결"
            variant="secondary"
            onPress={handleMockConnection}
          />
        ) : null}
        {!ble.connectedDevice
          ? ble.devices.map((device) => (
              <ActionButton
                key={device.id}
                label={`${device.name} 연결`}
                disabled={ble.connectionPhase === 'connecting'}
                variant="secondary"
                onPress={() => {
                  void ble.connect(device.id);
                }}
              />
            ))
          : null}
        <ActionButton
          label="측정 시작"
          disabled={measurementDisabled}
          onPress={handleStartMeasurement}
        />
        {ble.connectedDevice ? (
          <ActionButton
            label="연결 해제"
            variant="secondary"
            onPress={() => {
              void ble.disconnect();
            }}
          />
        ) : null}
      </Section>

      {ble.verificationLog.length > 0 ? (
        <>
          <Section eyebrow="Evidence" title="MVP 증거 누적">
            <StatusRow
              label="Notify 준비"
              value={
                verificationEvidence.notifyReadyAtUnixMs
                  ? verificationLogTime(verificationEvidence.notifyReadyAtUnixMs)
                  : '대기'
              }
              description="첫 status notify 수신 후 연결 승격을 확인합니다."
              tone={verificationEvidence.notifyReadyAtUnixMs ? 'safe' : 'neutral'}
            />
            <StatusRow
              label="Baseline 세션"
              value={evidenceSessionValue(verificationEvidence.baselineSessionId)}
              description="event:started kind=baseline 증거입니다."
              tone={evidenceSessionTone(verificationEvidence.baselineSessionId)}
            />
            <StatusRow
              label="일반 측정"
              value={evidenceSessionValue(verificationEvidence.measurementSessionId)}
              description="event:started kind=measurement 증거입니다."
              tone={evidenceSessionTone(verificationEvidence.measurementSessionId)}
            />
            <StatusRow
              label="보드 버튼"
              value={evidenceSessionValue(verificationEvidence.boardButtonSessionId)}
              description="event:started source=board_button 증거입니다."
              tone={evidenceSessionTone(verificationEvidence.boardButtonSessionId)}
            />
            <StatusRow
              label="취소 응답"
              value={evidenceCancelLatencyValue(verificationEvidence.cancelLatencyMs)}
              description="cmd:cancel부터 device_error(cancelled)까지의 시간입니다."
              tone={evidenceCancelLatencyTone(verificationEvidence.cancelLatencyMs)}
            />
            <StatusRow
              label="결과 세션"
              value={evidenceSessionValue(verificationEvidence.resultSessionId)}
              description="event:result를 수신한 세션입니다."
              tone={evidenceSessionTone(verificationEvidence.resultSessionId)}
            />
            <StatusRow
              label="저장 ACK"
              value={evidenceSessionValue(verificationEvidence.ackSessionId)}
              description="결과와 같은 세션일 때 저장 ACK 증거로 봅니다."
              tone={evidenceAckTone(verificationEvidence, ackCorrelated)}
            />
          </Section>

          <Section eyebrow="Verify" title="BLE 검증 로그">
            {ble.verificationLog
              .slice(-5)
              .reverse()
              .map((entry) => (
                <StatusRow
                  key={entry.id}
                  label={entry.label}
                  value={verificationLogTime(entry.atUnixMs)}
                  description={verificationLogDescription(entry)}
                  tone={verificationLogTone(entry)}
                />
              ))}
          </Section>
        </>
      ) : null}

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
          description="원본은 앱에 보관하고 보수적 해소율만 context에 반영합니다."
          tone={summary.profileReady ? 'safe' : 'neutral'}
        />
      </Section>

      <Section eyebrow="최근 결과" title="마지막 측정">
        {summary.latest ? (
          <>
            <StatusRow
              label="운전 상태"
              value={formatDrivingStatus(summary.latest.risk)}
              description={`${formatRisk(summary.latest.risk)} · ${formatBac(
                summary.latest.bac_upper_milli_percent ?? summary.latest.bac_milli_percent
              )}`}
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
              label="운전 상태"
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
      <ActionLink href="/measure/live" label="측정 화면 열기" variant="secondary" />
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

type StatusRowTone = 'neutral' | 'safe' | 'caution' | 'danger';

function verificationLogDescription(entry: BleVerificationLogEntry) {
  return entry.sessionId ? `${entry.detail} · session=${entry.sessionId}` : entry.detail;
}

function verificationLogTime(atUnixMs: number) {
  const date = new Date(atUnixMs);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

function verificationLogTone(entry: BleVerificationLogEntry): StatusRowTone {
  if (entry.label === 'event:error') {
    return 'danger';
  }

  if (entry.label === 'state:notify-ready' || entry.label === 'event:result') {
    return 'safe';
  }

  if (entry.kind === 'command') {
    return 'caution';
  }

  return 'neutral';
}

function evidenceSessionValue(sessionId: string | null) {
  return sessionId ?? '-';
}

function evidenceSessionTone(sessionId: string | null): StatusRowTone {
  return sessionId ? 'safe' : 'neutral';
}

function evidenceCancelLatencyValue(
  cancelLatencyMs: BleVerificationEvidenceSummary['cancelLatencyMs']
) {
  return cancelLatencyMs === null ? '-' : `${cancelLatencyMs}ms`;
}

function evidenceCancelLatencyTone(
  cancelLatencyMs: BleVerificationEvidenceSummary['cancelLatencyMs']
): StatusRowTone {
  if (cancelLatencyMs === null) {
    return 'neutral';
  }

  return cancelLatencyMs <= 1000 ? 'safe' : 'caution';
}

function evidenceAckTone(
  verificationEvidence: BleVerificationEvidenceSummary,
  ackCorrelated: boolean
): StatusRowTone {
  if (!verificationEvidence.ackSessionId) {
    return 'neutral';
  }

  return ackCorrelated ? 'safe' : 'caution';
}

function bluetoothLabel(state: string) {
  if (state === 'PoweredOn') {
    return '켜짐';
  }

  if (state === 'Unsupported') {
    return '미지원';
  }

  if (state === 'Unauthorized') {
    return '권한 필요';
  }

  return '꺼짐';
}

function bluetoothTone(state: string) {
  if (state === 'PoweredOn') {
    return 'safe';
  }

  if (state === 'Unsupported') {
    return 'danger';
  }

  if (state === 'Unauthorized') {
    return 'caution';
  }

  return 'caution';
}

function connectionLabel(phase: BleConnectionPhase) {
  const labels: Record<BleConnectionPhase, string> = {
    idle: '대기',
    bluetooth_off: '대기',
    scanning: '검색 중',
    connecting: '연결 중',
    connected: '연결됨',
    unsupported: '미지원',
    error: '오류',
  };

  return labels[phase];
}

function connectionTone(phase: BleConnectionPhase) {
  if (phase === 'connected') {
    return 'safe';
  }

  if (phase === 'error' || phase === 'unsupported') {
    return 'danger';
  }

  if (phase === 'scanning' || phase === 'connecting' || phase === 'bluetooth_off') {
    return 'caution';
  }

  return 'neutral';
}

function measurementLabel(phase: SummaryMeasurementPhase) {
  const labels: Record<SummaryMeasurementPhase, string> = {
    idle: '대기',
    starting: '시작 중',
    waiting_context: 'Context 전송',
    measuring: '측정 중',
    result: '결과 수신',
    error: '오류',
  };

  return labels[phase];
}

type SummaryMeasurementPhase =
  | 'idle'
  | 'starting'
  | 'waiting_context'
  | 'measuring'
  | 'result'
  | 'error';
