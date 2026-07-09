import type { DeviceEvent } from '@/lib/ble/model';
import { createMockProgressEvent, createMockResultEvent, mockProgressPlan } from '@/lib/ble/mock';
import type { MeasurementKind } from '@/lib/storage/history';

export default class MockTimeline {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  schedule(sessionId: string, kind: MeasurementKind, emit: (event: DeviceEvent) => void) {
    mockProgressPlan.forEach((progress) => {
      this.after(progress.delayMs, () => {
        emit(createMockProgressEvent(sessionId, progress.step, progress.percent));
      });
    });

    this.after(3800, () => emit(createMockResultEvent(sessionId, kind)));
  }

  clear() {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }

  private after(delayMs: number, callback: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delayMs);

    this.timers.add(timer);
  }
}
