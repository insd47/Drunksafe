export type SessionIdentity = {
  id: string;
  downloaded_at_unix_ms: number;
};

/** Firmware sequence IDs restart after reboot, so the app timestamp must be part of the key. */
export function createSessionStorageId(deviceSessionId: string, downloadedAtUnixMs: number) {
  return `${deviceSessionId}-${downloadedAtUnixMs}`;
}

/** Same-day sessions are numbered oldest-first in the device's local timezone. */
export function sessionMeasurementNumber(
  sessions: SessionIdentity[],
  target: SessionIdentity
): number {
  const sameDay = sessions
    .filter(
      (session) =>
        localDateKey(session.downloaded_at_unix_ms) === localDateKey(target.downloaded_at_unix_ms)
    )
    .sort(
      (left, right) =>
        left.downloaded_at_unix_ms - right.downloaded_at_unix_ms || left.id.localeCompare(right.id)
    );
  const index = sameDay.findIndex((session) => session.id === target.id);
  return index < 0 ? 1 : index + 1;
}

export function formatSessionMeasurementTitle(unixMs: number, measurementNumber: number) {
  const date = new Date(unixMs);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${measurementNumber}번째 측정`;
}

function localDateKey(unixMs: number) {
  const date = new Date(unixMs);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
