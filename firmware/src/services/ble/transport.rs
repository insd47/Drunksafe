use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

use super::{DeviceEvent, PhoneCommand};

pub const SERVICE_UUID: u128 = 0x6f5f3f7a3b0d4df79d17151b71e12201;
pub const DEVICE_EVENT_CHARACTERISTIC_UUID: u128 = 0x6f5f3f7a3b0d4df79d17151b71e12202;
pub const PHONE_COMMAND_CHARACTERISTIC_UUID: u128 = 0x6f5f3f7a3b0d4df79d17151b71e12203;
pub const DEVICE_NAME: &str = "Drunksafe";

pub const MAX_BLE_JSON_PAYLOAD_BYTES: usize = 180;

const DEFAULT_CHUNK_DATA_BYTES: usize = 64;
const CHUNK_FRAME_OVERHEAD_RESERVE_BYTES: usize = 96;
const MAX_CHUNKS: usize = 64;
const MAX_PENDING_CHUNK_SESSIONS: usize = 4;

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("BLE payload is not UTF-8 JSON")]
    Utf8(#[from] std::str::Utf8Error),
    #[error("BLE JSON payload is invalid")]
    Json(#[from] serde_json::Error),
    #[error("BLE chunk count changed during reassembly")]
    ChunkCountChanged,
    #[error("BLE transport frame exceeds configured payload size")]
    FrameTooLarge,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ChunkFrame {
    frame: FrameKind,
    id: String,
    index: usize,
    count: usize,
    data: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum FrameKind {
    PhoneCommandChunk,
    DeviceEventChunk,
}

struct ChunkEntry {
    count: usize,
    chunks: Vec<Option<String>>,
}

#[derive(Default)]
pub struct PhoneCommandTransport {
    entries: BTreeMap<String, ChunkEntry>,
}

impl PhoneCommandTransport {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn accept(&mut self, value: &[u8]) -> Result<Option<PhoneCommand>, TransportError> {
        let payload = std::str::from_utf8(value)?;

        if let Ok(frame) = serde_json::from_str::<ChunkFrame>(payload) {
            if frame.frame == FrameKind::PhoneCommandChunk {
                return self.accept_chunk(frame);
            }
        }

        Ok(Some(serde_json::from_str(payload)?))
    }

    fn accept_chunk(&mut self, frame: ChunkFrame) -> Result<Option<PhoneCommand>, TransportError> {
        if frame.count == 0 || frame.count > MAX_CHUNKS || frame.index >= frame.count {
            return Err(TransportError::FrameTooLarge);
        }

        if !self.entries.contains_key(&frame.id) && self.entries.len() >= MAX_PENDING_CHUNK_SESSIONS
        {
            let Some(oldest_id) = self.entries.keys().next().cloned() else {
                return Ok(None);
            };

            self.entries.remove(&oldest_id);
        }

        let entry = self.entries.entry(frame.id).or_insert_with(|| ChunkEntry {
            count: frame.count,
            chunks: vec![None; frame.count],
        });

        if entry.count != frame.count {
            return Err(TransportError::ChunkCountChanged);
        }

        entry.chunks[frame.index] = Some(frame.data);

        if entry.chunks.iter().any(Option::is_none) {
            return Ok(None);
        }

        let payload = entry
            .chunks
            .iter()
            .filter_map(|chunk| chunk.as_deref())
            .collect::<String>();
        let command = serde_json::from_str(&payload)?;

        self.entries
            .retain(|_, value| value.chunks.iter().any(Option::is_none));

        Ok(Some(command))
    }
}

pub struct DeviceEventTransport {
    next_frame_id: u32,
}

impl DeviceEventTransport {
    pub const fn new() -> Self {
        Self { next_frame_id: 0 }
    }

    pub fn frames(&mut self, event: &DeviceEvent) -> Result<Vec<String>, TransportError> {
        self.frames_with_max_payload_bytes(event, MAX_BLE_JSON_PAYLOAD_BYTES)
    }

    pub fn frames_with_max_payload_bytes(
        &mut self,
        event: &DeviceEvent,
        max_payload_bytes: usize,
    ) -> Result<Vec<String>, TransportError> {
        let payload = serde_json::to_string(event)?;

        if payload.len() <= max_payload_bytes {
            return Ok(vec![payload]);
        }

        let frame_id = self.next_frame_id();
        let chunk_data_bytes = DEFAULT_CHUNK_DATA_BYTES
            .min(max_payload_bytes.saturating_sub(CHUNK_FRAME_OVERHEAD_RESERVE_BYTES))
            .max(1);
        let chunks = chunk_payload(&payload, chunk_data_bytes);

        chunks
            .iter()
            .enumerate()
            .map(|(index, data)| {
                serialize_frame(
                    &ChunkFrame {
                        frame: FrameKind::DeviceEventChunk,
                        id: frame_id.clone(),
                        index,
                        count: chunks.len(),
                        data: data.clone(),
                    },
                    max_payload_bytes,
                )
            })
            .collect()
    }

    fn next_frame_id(&mut self) -> String {
        self.next_frame_id = self.next_frame_id.wrapping_add(1);
        format!("fw-{}", self.next_frame_id)
    }
}

impl Default for DeviceEventTransport {
    fn default() -> Self {
        Self::new()
    }
}

fn serialize_frame(frame: &ChunkFrame, max_payload_bytes: usize) -> Result<String, TransportError> {
    let payload = serde_json::to_string(frame)?;

    if payload.len() > max_payload_bytes {
        return Err(TransportError::FrameTooLarge);
    }

    Ok(payload)
}

fn chunk_payload(payload: &str, chunk_data_bytes: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut chunk = String::new();

    for char in payload.chars() {
        if !chunk.is_empty() && chunk.len() + char.len_utf8() > chunk_data_bytes {
            chunks.push(std::mem::take(&mut chunk));
        }

        chunk.push(char);
    }

    if !chunk.is_empty() {
        chunks.push(chunk);
    }

    chunks
}
