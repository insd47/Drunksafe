import ActionButton from '@/components/action-button';
import Section from '@/components/section';
import type { BleSession } from '@/lib/ble/session';

export default function ControlSection({
  ble,
  scanDisabled,
  startDisabled,
  onScan,
  onStart,
}: Props) {
  return (
    <Section eyebrow="Control" title="측정 제어">
      <ActionButton
        label={ble.connectionPhase === 'scanning' ? '스캔 중지' : 'Drunksafe 스캔'}
        disabled={scanDisabled}
        onPress={onScan}
      />
      {shouldShowMock(ble) ? (
        <ActionButton
          label="시뮬레이터 데모 연결"
          variant="secondary"
          onPress={() => void ble.connectMockDevice()}
        />
      ) : null}
      {!ble.connectedDevice
        ? ble.devices.map((device) => (
            <ActionButton
              key={device.id}
              label={`${device.name} 연결`}
              disabled={ble.connectionPhase === 'connecting'}
              variant="secondary"
              onPress={() => void ble.connect(device.id)}
            />
          ))
        : null}
      <ActionButton label="측정 시작" disabled={startDisabled} onPress={onStart} />
      {ble.connectedDevice ? (
        <ActionButton label="연결 해제" variant="secondary" onPress={() => void ble.disconnect()} />
      ) : null}
    </Section>
  );
}

function shouldShowMock(ble: BleSession) {
  return (
    !ble.connectedDevice &&
    (ble.bluetoothState === 'Unsupported' ||
      ble.connectionPhase === 'unsupported' ||
      ble.connectionPhase === 'bluetooth_off')
  );
}

interface Props {
  ble: BleSession;
  scanDisabled: boolean;
  startDisabled: boolean;
  onScan: () => void;
  onStart: () => void;
}
