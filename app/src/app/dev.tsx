import { useState, type PropsWithChildren } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { PpgSparkline } from '@/components/ppg-sparkline';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import type { SessionStateLabel } from '@/lib/ble/model';
import {
  useBleSession,
  useBleVerification,
  usePpgSnapshot,
  usePulseReading,
  usePulseStreaming,
  useSession,
  type ConnectionState,
  type MeasurementState,
  type SessionUiSnapshot,
} from '@/lib/ble/session';
import { removeJson } from '@/lib/storage/json';
import { emptyBaseline, writeBaseline } from '@/lib/storage/profile';
import { persistSessionDownload } from '@/lib/storage/sessions';

/** lib/storage/history.ts가 소유한 키 — 개발자 도구에서만 직접 지운다. */
const historyKey = 'drunksafe.history.v1';

export default function DevRoute() {
  const ble = useBleSession();
  const { verificationLog, verificationEvidence } = useBleVerification();
  const connection = ble.connection;
  const measurement = ble.measurement;
  const [clearedAtUnixMs, setClearedAtUnixMs] = useState(0);
  const [maintenance, setMaintenance] = useState('대기');
  const entries = verificationLog.filter((entry) => entry.atUnixMs > clearedAtUnixMs);

  function run(label: string, action: () => Promise<unknown>) {
    setMaintenance(`${label} 실행 중`);
    action()
      .then(() => setMaintenance(`${label} 완료`))
      .catch(() => setMaintenance(`${label} 실패`));
  }

  return (
    <Screen>
      <Section eyebrow="Session" title="세션 상태">
        <StatusRow label="bluetoothState" value={ble.bluetoothState} />
        <StatusRow label="connectionPhase" value={connection.phase} />
        <StatusRow label="measurementPhase" value={measurement.phase} />
        <StatusRow
          label="deviceStatus"
          value={connection.phase === 'connected' ? connection.status : '-'}
        />
        <StatusRow
          label="activeSessionId"
          value={measurement.phase === 'active' ? measurement.sessionId : '-'}
        />
        <StatusRow label="activeMeasurementKind" value={measurementKind(measurement)} />
        <StatusRow
          label="deviceErrorCode"
          value={measurement.phase === 'error' ? measurement.code : '-'}
        />
        <StatusRow
          label="resultSaved"
          value={measurement.phase === 'result' ? String(measurement.saved) : '-'}
        />
        <StatusRow label="mockMode" value={String(ble.mockMode)} />
        <StatusRow label="message" value={connectionMessage(connection) ?? '-'} />
      </Section>

      <PulseStreamSection />
      <AlcoholTrackSection />

      <Section eyebrow="Raw" title={`원시 이벤트 (${entries.length})`}>
        {entries.length === 0 ? <StatusRow label="기록 없음" value="-" /> : null}
        {entries.map((entry) => (
          <StatusRow
            description={`${entry.detail}${entry.sessionId ? ` · ${entry.sessionId}` : ''}`}
            key={entry.id}
            label={entry.label}
            value={new Date(entry.atUnixMs).toISOString().slice(11, 23)}
          />
        ))}
      </Section>
      <ActionButton
        label="로그 지우기"
        onPress={() => setClearedAtUnixMs(Date.now())}
        variant="secondary"
      />

      <Collapsible label="증거 집계">
        {Object.entries(verificationEvidence).map(([key, value]) => (
          <StatusRow key={key} label={key} value={value === null ? '-' : String(value)} />
        ))}
      </Collapsible>

      <Section eyebrow="Control" title="강제 동작">
        <StatusRow label="마지막 작업" value={maintenance} />
      </Section>
      <ActionButton
        label="시뮬레이터 데모 기기 연결"
        onPress={() => {
          void ble.connectMockDevice();
          Alert.alert("알림", "시뮬레이션 데모 기기가 연결되었습니다.");
        }}
      />
      <ActionButton
        label="데모 음주 세션 생성"
        onPress={() => {
          run('데모 세션 생성', async () => {
            const now = Date.now();
            
            // C0: 0.02% ~ 0.20% BAC (mg_l_x1000 기준 약 95 ~ 952)
            const C0 = Math.floor(Math.random() * (952 - 95 + 1)) + 95;
            
            // 분해 속도: 0.015% ± 0.01% BAC/h (0.005 ~ 0.025)
            // 성인 남성 평균 분해속도 0.015% +- 0.005% (0.010% ~ 0.020% BAC/hr)
            // 0.010% BAC -> 약 47 mg_l_x1000
            // 0.020% BAC -> 약 95 mg_l_x1000
            const eliminationPerHour = Math.floor(Math.random() * (95 - 47 + 1)) + 47; 
            
            // BAC 0.01% 에 해당하는 mg_l_x1000 수치는 약 45
            const targetC = 45; 
            
            // C0에서 targetC(0.01%)까지 떨어지는 데 걸리는 시간(시간 단위)
            const descentHours = (C0 - targetC) / eliminationPerHour;
            const descentMs = descentHours * 3600000;
            const ascentMs = 3600000; // 피크(C0) 도달 시간 1시간 가정
            
            // 실제 혈중 알코올 감소는 지수 감쇠(Exponential decay)를 따른다는 기획 의도 반영
            // C(t) = C0 * e^(-k * t)
            // t = descentHours 일 때 C(t) = targetC 가 되도록 k(지수 감쇠 상수)를 구함
            const k = Math.log(C0 / targetC) / descentHours;

            const fakeRecords: any[] = [
              { v: 12, session_id: 'mock-session', index: 0, total: 6, t_ms: 0, kind: 'state', state: 'track', mg_l_x1000: null, bpm: null },
              { v: 12, session_id: 'mock-session', index: 1, total: 6, t_ms: 0, kind: 'alcohol', state: 'track', mg_l_x1000: C0, bpm: null },
              { v: 12, session_id: 'mock-session', index: 2, total: 6, t_ms: Math.round(descentMs * 0.25), kind: 'alcohol', state: 'track', mg_l_x1000: Math.round(C0 * Math.exp(-k * (descentHours * 0.25))), bpm: null },
              { v: 12, session_id: 'mock-session', index: 3, total: 6, t_ms: Math.round(descentMs * 0.5), kind: 'alcohol', state: 'track', mg_l_x1000: Math.round(C0 * Math.exp(-k * (descentHours * 0.5))), bpm: null },
              { v: 12, session_id: 'mock-session', index: 4, total: 6, t_ms: Math.round(descentMs * 0.75), kind: 'alcohol', state: 'track', mg_l_x1000: Math.round(C0 * Math.exp(-k * (descentHours * 0.75))), bpm: null },
              { v: 12, session_id: 'mock-session', index: 5, total: 6, t_ms: Math.round(descentMs), kind: 'alcohol', state: 'track', mg_l_x1000: targetC, bpm: null },
            ];
            await persistSessionDownload(fakeRecords, now);
            Alert.alert("알림", "데모 음주 세션이 1건 생성되었습니다.\\n기록 탭에서 확인하세요.");
          });
        }}
      />
      <ActionButton
        label="히스토리 전체 삭제"
        onPress={() => run('히스토리 삭제', () => removeJson(historyKey))}
        variant="secondary"
      />
      <ActionButton
        label="기준값 초기화"
        onPress={() => run('기준값 초기화', () => writeBaseline(emptyBaseline))}
        variant="secondary"
      />
    </Screen>
  );
}

/** idle을 뺀 모든 연결 상태가 사람이 읽을 메시지를 들고 있다. */
function connectionMessage(connection: ConnectionState) {
  return connection.phase === 'idle' ? null : connection.message;
}

function measurementKind(measurement: MeasurementState) {
  switch (measurement.phase) {
    case 'starting':
    case 'active':
    case 'awaiting_pulse':
    case 'error':
      return measurement.kind;
    case 'result':
      return measurement.record.kind;
    case 'idle':
      return '-';
  }
}

/** 실시간 pulse 스트리밍 중인 PPG raw waveform — "BPM 파형 표시"를 켰을 때만 보인다. */
function PpgWaveform() {
  const points = usePpgSnapshot();
  const latest = points.at(-1) ?? null;
  const first = points.at(0) ?? null;
  const span = first && latest && first !== latest ? `${first.t}ms ~ ${latest.t}ms` : '-';

  return (
    <Section eyebrow="Raw" title={`PPG raw 파형 (${points.length})`}>
      <PpgSparkline points={points} />
      <StatusRow label="최근 raw 값" value={latest ? String(latest.raw) : '-'} />
      <StatusRow label="구간" value={span} />
    </Section>
  );
}

/**
 * 알코올을 빼고 ESP32가 계산한 BPM을 1초마다 실시간으로 받아 본다.
 * "왜 BPM이 --로만 나오는가"(신호 없음 / peak 부족 / 불안정)를 눈으로 진단하는 용도.
 * raw 파형은 전송량이 많아 "BPM 파형 표시"를 켰을 때만 스트리밍/표시한다.
 */
function PulseStreamSection() {
  const ble = useBleSession();
  const reading = usePulseReading();
  const streaming = usePulseStreaming();
  const startPulseStream = ble.startPulseStream;
  const stopPulseStream = ble.stopPulseStream;
  const connected = ble.connection.phase === 'connected' && !ble.mockMode;
  const [showWaveform, setShowWaveform] = useState(false);

  const bpm = reading && reading.bpm > 0 ? reading.bpm.toFixed(0) : '--';

  return (
    <>
      <Section eyebrow="Pulse" title="심박 실시간 진단 (알코올 제외)">
        <StatusRow label="BPM" tone={reading?.stable ? 'safe' : 'neutral'} value={bpm} />
        <StatusRow label="peak 수" value={reading ? String(reading.peak_count) : '-'} />
        <StatusRow
          label="IBI 표준편차(ms)"
          value={reading ? reading.ibi_stddev_ms.toFixed(1) : '-'}
        />
        <StatusRow label="안정 여부" value={reading ? (reading.stable ? '안정' : '불안정') : '-'} />
        <StatusRow label="경과(ms)" value={reading ? String(reading.elapsed_ms) : '-'} />
        <StatusRow
          label="스트리밍"
          value={!connected ? '연결 필요' : streaming ? '진행 중' : '정지'}
        />
      </Section>
      <CheckboxRow
        checked={showWaveform}
        disabled={streaming}
        label="BPM 파형 표시 (테스트용 · 전송량 증가)"
        onToggle={() => setShowWaveform((value) => !value)}
      />
      {showWaveform ? <PpgWaveform /> : null}
      <ActionButton
        disabled={!connected || streaming}
        label="심박 실시간 측정 시작"
        onPress={() => {
          void startPulseStream(showWaveform);
        }}
      />
      <ActionButton
        disabled={!connected || !streaming}
        label="정지"
        onPress={() => {
          void stopPulseStream();
        }}
        variant="secondary"
      />
    </>
  );
}

/**
 * 심박/스케줄(DORMANT·PROBE) 없이 알코올 값만 추적해 분해 곡선을 얻는다.
 * 값이 10을 넘으면 15분 간격으로 dense 측정. 종료하면 일반 세션으로 저장돼
 * 기록 탭 > 음주 세션에서 하강 회귀 결과를 상세히 볼 수 있다.
 */
function AlcoholTrackSection() {
  const ble = useBleSession();
  const session = useSession();
  const connected = ble.connection.phase === 'connected' && !ble.mockMode;
  const active = session.phase === 'active' || session.phase === 'downloading';
  const status = session.status;

  return (
    <>
      <Section eyebrow="Alcohol" title="알코올 분해 곡선 측정 (심박 제외)">
        <StatusRow label="상태" value={alcoholTrackPhaseText(session)} />
        <StatusRow label="단계" value={status ? sessionStateText(status.state) : '-'} />
        <StatusRow label="측정 횟수" value={status ? String(status.records) : '-'} />
        <StatusRow label="경과(ms)" value={status ? String(status.elapsed_ms) : '-'} />
        {session.phase === 'complete' ? (
          <StatusRow
            label="분해속도"
            tone={session.result?.eliminationMgLPerHourX1000 != null ? 'safe' : 'neutral'}
            value={formatElimination(session.result?.eliminationMgLPerHourX1000 ?? null)}
          />
        ) : null}
      </Section>
      <ActionButton
        disabled={!connected || active}
        label="알코올 추적 시작"
        onPress={() => {
          void ble.startAlcoholTrack();
        }}
      />
      <ActionButton
        disabled={!connected || !active}
        label="종료 & 데이터 받기"
        onPress={() => {
          void ble.endSession();
        }}
        variant="secondary"
      />
    </>
  );
}

function alcoholTrackPhaseText(session: SessionUiSnapshot) {
  switch (session.phase) {
    case 'idle':
      return '대기';
    case 'active':
      return '측정 중';
    case 'downloading':
      return '데이터 받는 중';
    case 'complete':
      return '완료';
  }
}

function sessionStateText(state: SessionStateLabel) {
  switch (state) {
    case 'dormant':
      return '관찰 (임계 이하)';
    case 'probe':
      return '확인';
    case 'track':
      return '추적 (15분 간격)';
  }
}

function formatElimination(mgLPerHourX1000: number | null) {
  return mgLPerHourX1000 === null ? '추정 불가' : `${(mgLPerHourX1000 / 1000).toFixed(3)} mg/L·h`;
}

/** 개발자 도구에서만 쓰는 단순 체크박스 행 (외부 UI 의존성 없이 Pressable로 구현). */
function CheckboxRow({
  label,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: disabled ?? false }}
      className="flex-row items-center gap-3 py-2"
      disabled={disabled}
      onPress={onToggle}>
      <View
        className={`h-5 w-5 items-center justify-center border ${
          checked ? 'border-gray-950 bg-gray-950' : 'border-gray-300 bg-white'
        }`}>
        {checked ? <Text className="text-xs font-bold text-white">✓</Text> : null}
      </View>
      <Text className={`text-sm ${disabled ? 'text-gray-400' : 'text-gray-950'}`}>{label}</Text>
    </Pressable>
  );
}

function Collapsible({ label, children }: PropsWithChildren<{ label: string }>) {
  const [open, setOpen] = useState(false);

  return (
    <View className="gap-3">
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}>
        <Text className="text-sm font-semibold text-gray-950">
          {open ? '▾' : '▸'} {label}
        </Text>
      </Pressable>
      {open ? <View className="gap-1 border-y border-gray-200">{children}</View> : null}
    </View>
  );
}
