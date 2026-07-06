import { toPhoneCommandPayload, type PhoneCommand } from '@/lib/ble/model';
import { utf8ByteLength } from '@/lib/ble/codec';

export const maxBleJsonPayloadBytes = 180;

const chunkDataBytes = 64;
let nextFrameSequence = 0;

type ChunkFrame = {
  frame: 'phone_command_chunk' | 'device_event_chunk';
  id: string;
  index: number;
  count: number;
  data: string;
};

type ChunkEntry = {
  count: number;
  chunks: (string | undefined)[];
};

export function serializePhoneCommandFrames(command: PhoneCommand) {
  const payload = toPhoneCommandPayload(command);

  if (utf8ByteLength(payload) <= maxBleJsonPayloadBytes) {
    return [payload];
  }

  const frameId = createFrameId();

  return chunkPayload(payload).map((data, index, chunks) =>
    serializeFrame({
      frame: 'phone_command_chunk',
      id: frameId,
      index,
      count: chunks.length,
      data,
    })
  );
}

export class DeviceEventFrameAssembler {
  private readonly entries = new Map<string, ChunkEntry>();

  accept(payload: string) {
    const value: unknown = JSON.parse(payload);

    if (!isDeviceEventChunk(value)) {
      return payload;
    }

    const entry = this.entries.get(value.id) ?? {
      count: value.count,
      chunks: new Array<string | undefined>(value.count).fill(undefined),
    };

    if (entry.count !== value.count) {
      throw new Error('BLE chunk count changed during reassembly');
    }

    entry.chunks[value.index] = value.data;
    this.entries.set(value.id, entry);

    if (!entry.chunks.every((chunk) => chunk !== undefined)) {
      return null;
    }

    this.entries.delete(value.id);
    return entry.chunks.join('');
  }
}

function chunkPayload(payload: string) {
  const chunks: string[] = [];
  let chunk = '';

  for (const char of payload) {
    if (chunk && utf8ByteLength(`${chunk}${char}`) > chunkDataBytes) {
      chunks.push(chunk);
      chunk = '';
    }

    chunk += char;
  }

  if (chunk) {
    chunks.push(chunk);
  }

  return chunks;
}

function serializeFrame(frame: ChunkFrame) {
  const payload = JSON.stringify(frame);

  if (utf8ByteLength(payload) > maxBleJsonPayloadBytes) {
    throw new Error('BLE transport frame exceeds configured payload size');
  }

  return payload;
}

function createFrameId() {
  nextFrameSequence += 1;
  return `${Date.now().toString(36)}-${nextFrameSequence.toString(36)}`;
}

function isDeviceEventChunk(value: unknown): value is ChunkFrame {
  return (
    isRecord(value) &&
    value.frame === 'device_event_chunk' &&
    typeof value.id === 'string' &&
    isChunkIndex(value.index) &&
    isChunkCount(value.count) &&
    value.index < value.count &&
    typeof value.data === 'string'
  );
}

function isChunkIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isChunkCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 64;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
