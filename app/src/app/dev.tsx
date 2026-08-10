import { useState, type PropsWithChildren } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import {
  useBleSession,
  useBleVerification,
  type ConnectionState,
  type MeasurementState,
} from '@/lib/ble/session';
import { removeJson } from '@/lib/storage/json';
import { emptyBaseline, writeBaseline } from '@/lib/storage/profile';

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
    case 'error':
      return measurement.kind;
    case 'result':
      return measurement.record.kind;
    case 'idle':
      return '-';
  }
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
