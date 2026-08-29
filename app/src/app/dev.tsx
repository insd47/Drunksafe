import { useEffect, useState, type PropsWithChildren } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

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
import {
  readFittingProfile,
  writeFittingProfile,
  type AlcoholFittingProfile,
} from '@/lib/personalization/fitting-profile';
import { demoPrediction, fittingDemoUsers } from '@/lib/personalization/fitting-demo';
import {
  readConnectionIncidents,
  type ConnectionIncident,
} from '@/lib/storage/connection-incidents';

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
      <FittingProfileSection />
      <FittingDemoSection />
      <ConnectionIncidentSection />

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
 * 심박/스케줄(DORMANT·PROBE) 없이 10분 고정 구간으로 알코올 값을 측정한다.
 * 종료 후 다운로드가 완료되면 peak 이후 데이터로 개인 지수 감쇠 profile을 저장한다.
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
        label="10분 간격 fitting 측정 시작"
        onPress={() => {
          void ble.startAlcoholTrack();
        }}
      />
      <ActionButton
        disabled={!connected || session.phase !== 'active' || session.alcoholMeasurementPending}
        label={session.alcoholMeasurementPending ? '측정 진행 중…' : '알코올 측정'}
        onPress={() => {
          void ble.measureSessionAlcohol();
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

function FittingProfileSection() {
  const [profile, setProfile] = useState<AlcoholFittingProfile | null>(null);
  const [k, setK] = useState('0.009796');
  const [low, setLow] = useState('0.008680');
  const [high, setHigh] = useState('0.011310');
  const [message, setMessage] = useState('미저장');
  useEffect(() => {
    void readFittingProfile().then((p) => {
      if (!p) return;
      setProfile(p);
      setK(String(p.kPerMinute));
      setLow(String(p.kLowPerMinute));
      setHigh(String(p.kHighPerMinute));
      setMessage('저장값 불러옴');
    });
  }, []);
  const fields: [string, string, (v: string) => void][] = [
    ['k (/분)', k, setK],
    ['k 하한', low, setLow],
    ['k 상한', high, setHigh],
  ];
  return (
    <Section eyebrow="Fitting" title="임시 개인 fitting 데이터">
      {fields.map(([label, value, set]) => (
        <View className="gap-1" key={label}>
          <Text className="text-xs text-gray-600">{label}</Text>
          <TextInput
            className="border border-gray-300 px-3 py-2 text-gray-950"
            keyboardType="decimal-pad"
            onChangeText={set}
            value={value}
          />
        </View>
      ))}
      <StatusRow label="상태" value={message} />
      {profile?.diagnostics ? (
        <>
          <StatusRow
            label="C0 / 사용점"
            value={`${profile.diagnostics.c0} · ${profile.diagnostics.includedPoints}/${profile.diagnostics.totalDescentPoints}`}
          />
          <StatusRow
            label="R² / RMSE / 등급"
            value={`${profile.diagnostics.rSquare.toFixed(3)} / ${profile.diagnostics.rmse.toFixed(2)} / ${profile.diagnostics.grade}`}
          />
          <StatusRow
            label="K21"
            value={
              profile.diagnostics.k21Low === null
                ? '교집합 없음'
                : `${profile.diagnostics.k21Low.toFixed(6)}~${profile.diagnostics.k21High?.toFixed(6)}`
            }
          />
          <StatusRow
            label="K95"
            value={`${profile.diagnostics.k95Low.toFixed(6)}~${profile.diagnostics.k95High.toFixed(6)}`}
          />
          <StatusRow
            label="Kjoint"
            value={
              profile.diagnostics.kJointLow === null
                ? '충돌 · K95 적용'
                : `${profile.diagnostics.kJointLow.toFixed(6)}~${profile.diagnostics.kJointHigh?.toFixed(6)}`
            }
          />
          <StatusRow label="예측 적용 범위" value={profile.diagnostics.appliedRange} />
        </>
      ) : null}
      <ActionButton
        label="k와 범위 저장"
        onPress={() => {
          const next = {
            kPerMinute: Number(k),
            kLowPerMinute: Number(low),
            kHighPerMinute: Number(high),
            source: 'developer_input' as const,
            updatedAtUnixMs: Date.now(),
          };
          void writeFittingProfile(next)
            .then(() => {
              setProfile(next);
              setMessage('음주 세션에 적용됨');
            })
            .catch((e) => setMessage(e instanceof Error ? e.message : '저장 실패'));
        }}
      />
    </Section>
  );
}

function FittingDemoSection() {
  return (
    <Section eyebrow="Demo" title="5명 fitting·검증 결과">
      {fittingDemoUsers.map((user) => (
        <Collapsible key={user.name} label={`${user.name} · ${user.grade}등급`}>
          <StatusRow label="fitting 세션" value={`세션 ${user.fittingSession}`} />
          <StatusRow
            label="k (K95)"
            value={`${user.k.toFixed(6)} (${user.kLow.toFixed(6)}~${user.kHigh.toFixed(6)})`}
          />
          <StatusRow
            label="R² / RMSE"
            value={`${user.rSquare.toFixed(3)} / ${user.rmse.toFixed(2)}`}
          />
          {user.validations.flatMap((validation) =>
            validation.points.map((point, index) => {
              const p = demoPrediction(point, index, validation, user);
              const actual =
                p.actualFinish === null
                  ? '실제 완료 미관측'
                  : `실제 완료 ${p.actualFinish}분${p.relativeErrorPercent === null ? '' : ` · 오차 ${p.relativeErrorPercent.toFixed(1)}%`}`;
              return (
                <StatusRow
                  key={`${validation.session}-${index}`}
                  label={`S${validation.session} · ${point[0]}분 · 값 ${point[1]}`}
                  description={actual}
                  value={`예상 잔여 ${p.remaining}분 · 완료 ${p.finish}분 (범위 ${p.earliest}~${p.latest})`}
                />
              );
            })
          )}
        </Collapsible>
      ))}
    </Section>
  );
}

function ConnectionIncidentSection() {
  const [items, setItems] = useState<ConnectionIncident[]>([]);
  useEffect(() => {
    void readConnectionIncidents().then(setItems);
  }, []);
  return (
    <Section eyebrow="BLE" title="비정상 연결 종료 기록">
      {items.length === 0 ? (
        <StatusRow label="기록 없음" value="-" />
      ) : (
        items.map((item, index) => (
          <StatusRow
            key={`${item.atUnixMs}-${index}`}
            label={new Date(item.atUnixMs).toLocaleString()}
            description={item.message}
            value={item.sessionId ?? '세션 없음'}
          />
        ))
      )}
    </Section>
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
      return 'fitting (10분 알림)';
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
