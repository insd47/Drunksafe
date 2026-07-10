import { Fragment } from 'react';

import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import type { BleSession } from '@/lib/ble/session';
import {
  isBleVerificationAckCorrelated,
  type BleVerificationEvidenceSummary,
  type BleVerificationLogEntry,
} from '@/lib/ble/verification-log';
import type { StatusTone } from '@/features/connect/labels';

export default function EvidenceSections({ ble }: Props) {
  if (ble.verificationLog.length === 0) return null;

  const evidence = ble.verificationEvidence;
  const ackCorrelated = isBleVerificationAckCorrelated(evidence);

  return (
    <Fragment>
      <Section eyebrow="Evidence" title="MVP 증거 누적">
        <StatusRow
          label="Notify 준비"
          value={evidence.notifyReadyAtUnixMs ? formatTime(evidence.notifyReadyAtUnixMs) : '대기'}
          description="첫 status notify 수신 후 연결 승격을 확인합니다."
          tone={evidence.notifyReadyAtUnixMs ? 'safe' : 'neutral'}
        />
        <StatusRow
          label="시간 동기화"
          value={evidence.timeSyncAtUnixMs ? formatTime(evidence.timeSyncAtUnixMs) : '대기'}
          description="cmd:time write가 성공한 시점입니다."
          tone={evidence.timeSyncAtUnixMs ? 'safe' : 'neutral'}
        />
        <EvidenceRow
          label="Context 전송"
          sessionId={evidence.contextSessionId}
          description="cmd:context write가 성공한 세션입니다."
        />
        <EvidenceRow
          label="Baseline 세션"
          sessionId={evidence.baselineSessionId}
          description="event:started kind=baseline 증거입니다."
        />
        <EvidenceRow
          label="일반 측정"
          sessionId={evidence.measurementSessionId}
          description="event:started kind=measurement 증거입니다."
        />
        <EvidenceRow
          label="보드 버튼"
          sessionId={evidence.boardButtonSessionId}
          description="event:started source=board_button 증거입니다."
        />
        <StatusRow
          label="취소 응답"
          value={evidence.cancelLatencyMs === null ? '-' : `${evidence.cancelLatencyMs}ms`}
          description="cmd:cancel부터 device_error(cancelled)까지의 시간입니다."
          tone={cancelTone(evidence.cancelLatencyMs)}
        />
        <EvidenceRow
          label="결과 세션"
          sessionId={evidence.resultSessionId}
          description="event:result를 수신한 세션입니다."
        />
        <StatusRow
          label="저장 ACK"
          value={evidence.ackSessionId ?? '-'}
          description="결과와 같은 세션일 때 저장 ACK 증거로 봅니다."
          tone={ackTone(evidence, ackCorrelated)}
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
              value={formatTime(entry.atUnixMs)}
              description={formatDescription(entry)}
              tone={logTone(entry)}
            />
          ))}
      </Section>
    </Fragment>
  );
}

function EvidenceRow({ label, sessionId, description }: EvidenceRowProps) {
  return (
    <StatusRow
      label={label}
      value={sessionId ?? '-'}
      description={description}
      tone={sessionId ? 'safe' : 'neutral'}
    />
  );
}

function formatTime(atUnixMs: number) {
  const date = new Date(atUnixMs);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

function formatDescription(entry: BleVerificationLogEntry) {
  return entry.sessionId ? `${entry.detail} · session=${entry.sessionId}` : entry.detail;
}

function logTone(entry: BleVerificationLogEntry): StatusTone {
  if (entry.label === 'event:error') return 'danger';
  if (entry.label === 'state:notify-ready' || entry.label === 'event:result') return 'safe';
  if (entry.kind === 'command') return 'caution';
  return 'neutral';
}

function cancelTone(latency: BleVerificationEvidenceSummary['cancelLatencyMs']): StatusTone {
  if (latency === null) return 'neutral';
  return latency <= 1000 ? 'safe' : 'caution';
}

function ackTone(evidence: BleVerificationEvidenceSummary, correlated: boolean): StatusTone {
  if (!evidence.ackSessionId) return 'neutral';
  return correlated ? 'safe' : 'caution';
}

interface Props {
  ble: BleSession;
}

interface EvidenceRowProps {
  label: string;
  sessionId: string | null;
  description: string;
}
