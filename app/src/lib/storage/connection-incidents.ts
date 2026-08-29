import { readJson, writeJson } from '@/lib/storage/json';

const key = 'drunksafe.connection-incidents.v1';

export type ConnectionIncident = {
  atUnixMs: number;
  deviceId: string;
  sessionId: string | null;
  message: string;
};

export async function appendConnectionIncident(incident: ConnectionIncident) {
  const current = await readConnectionIncidents();
  await writeJson(key, [incident, ...current].slice(0, 50));
}

export function readConnectionIncidents() {
  return readJson<ConnectionIncident[]>(
    key,
    () => [],
    (value): value is ConnectionIncident[] => Array.isArray(value)
  );
}
