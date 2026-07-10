import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import type { BleSession } from '@/lib/ble/session';

export default function DeviceSection({ devices }: Props) {
  if (devices.length === 0) return null;

  return (
    <Section eyebrow="Scan" title="발견된 장치">
      {devices.map((device) => (
        <StatusRow
          key={device.id}
          label={device.name}
          value={device.rssi === null ? 'RSSI -' : `${device.rssi} dBm`}
          description={device.id}
        />
      ))}
    </Section>
  );
}

interface Props {
  devices: BleSession['devices'];
}
