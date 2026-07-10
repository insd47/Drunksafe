use esp_idf_svc::bt::ble::gatt::server::ConnectionId;
use esp_idf_svc::bt::BdAddr;

use crate::services::ble::transport::MAX_BLE_JSON_PAYLOAD_BYTES;

pub struct Connection {
    id: ConnectionId,
    peer: BdAddr,
    subscribed: bool,
    mtu: Option<u16>,
}

impl Connection {
    pub const fn new(id: ConnectionId, peer: BdAddr) -> Self {
        Self {
            id,
            peer,
            subscribed: false,
            mtu: None,
        }
    }

    pub const fn id(&self) -> ConnectionId {
        self.id
    }

    pub const fn peer(&self) -> BdAddr {
        self.peer
    }

    pub fn mtu(&mut self, value: u16) {
        self.mtu = Some(value);
    }

    pub fn subscribe(&mut self, enabled: bool) {
        self.subscribed = enabled;
    }

    pub fn target(&self) -> Option<(ConnectionId, usize)> {
        self.subscribed.then(|| {
            let payload = self
                .mtu
                .map(|value| value.saturating_sub(3) as usize)
                .unwrap_or(MAX_BLE_JSON_PAYLOAD_BYTES)
                .min(MAX_BLE_JSON_PAYLOAD_BYTES);

            (self.id, payload)
        })
    }
}
