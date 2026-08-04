import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import ActionLink from '@/components/action-link';
import Screen from '@/components/screen';
import Separator from '@/components/separator';
import ConnectionSection from '@/features/connect/connection';
import ControlSection from '@/features/connect/controls';
import DeviceSection from '@/features/connect/devices';
import EvidenceSections from '@/features/connect/evidence';
import { LatestResultSection, PersonalizationSection } from '@/features/connect/summary';
import useConnectionSummary from '@/features/connect/use-summary';
import { canRequestBleScan } from '@/lib/ble/connection-readiness';
import { hasActiveMeasurement } from '@/lib/ble/measurement-phase';
import { useBleSession } from '@/lib/ble/session';
import { measurementStartBlocker } from '@/lib/ble/start-readiness';

export default function HomeRoute() {
  const router = useRouter();
  const ble = useBleSession();
  const initializeBle = ble.initialize;
  const summary = useConnectionSummary();
  const contextReady = summary.baselineReady || summary.profileReady;
  const startBlocker = measurementStartBlocker({
    connected: Boolean(ble.connectedDevice && ble.connectionPhase === 'connected'),
    activeMeasurement: hasActiveMeasurement(ble),
    contextReady,
    mockMode: ble.mockMode,
  });
  const scanDisabled =
    ble.mockMode ||
    Boolean(ble.connectedDevice) ||
    ble.connectionPhase === 'connecting' ||
    hasActiveMeasurement(ble) ||
    !canRequestBleScan(ble.bluetoothState);

  useEffect(() => {
    initializeBle();
  }, [initializeBle]);

  const handleScan = () => {
    if (ble.connectionPhase === 'scanning') {
      void ble.stopScan();
      return;
    }

    void ble.startScan();
  };

  const handleStart = () => {
    if (startBlocker) return;

    void ble.startMeasurement();
    router.push('/measure/live');
  };

  return (
    <Screen>
      <ConnectionSection
        ble={ble}
        summary={summary}
        contextReady={contextReady}
        startBlocker={startBlocker}
      />
      <DeviceSection devices={ble.devices} />
      <ControlSection
        ble={ble}
        scanDisabled={scanDisabled}
        startDisabled={startBlocker !== null}
        onScan={handleScan}
        onStart={handleStart}
      />
      <EvidenceSections ble={ble} />
      <PersonalizationSection summary={summary} />
      <LatestResultSection summary={summary} />

      <Separator />

      <ActionLink href="/onboarding" label="온보딩 시작" />
      <ActionLink href="/measure/live" label="측정 화면 열기" variant="secondary" />
      <ActionLink href="/history" label="히스토리 보기" variant="secondary" />
    </Screen>
  );
}
