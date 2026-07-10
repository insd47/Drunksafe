use super::connection::Connection;
use esp_idf_svc::bt::ble::gatt::server::ConnectionId;
use esp_idf_svc::bt::BdAddr;
use std::sync::Mutex;

pub struct Connections {
    values: Mutex<Vec<Connection>>,
}

impl Connections {
    pub const fn new() -> Self {
        Self {
            values: Mutex::new(Vec::new()),
        }
    }

    pub fn add(&self, id: ConnectionId, peer: BdAddr) -> bool {
        let mut values = self.values.lock().unwrap();

        if values.iter().any(|connection| connection.peer() == peer) {
            return false;
        }

        let first = values.is_empty();
        values.push(Connection::new(id, peer));
        first
    }

    pub fn remove(&self, peer: BdAddr) -> bool {
        let mut values = self.values.lock().unwrap();

        if let Some(index) = values
            .iter()
            .position(|connection| connection.peer() == peer)
        {
            values.swap_remove(index);
        }

        values.is_empty()
    }

    pub fn mtu(&self, id: ConnectionId, mtu: u16) {
        if let Some(connection) = self
            .values
            .lock()
            .unwrap()
            .iter_mut()
            .find(|connection| connection.id() == id)
        {
            connection.mtu(mtu);
        }
    }

    pub fn subscribe(&self, id: ConnectionId, enabled: bool) -> bool {
        let mut values = self.values.lock().unwrap();
        let Some(connection) = values.iter_mut().find(|connection| connection.id() == id) else {
            return false;
        };

        connection.subscribe(enabled);
        log::info!("BLE client subscribed={enabled}");
        true
    }

    pub fn targets(&self) -> Vec<(ConnectionId, usize)> {
        self.values
            .lock()
            .unwrap()
            .iter()
            .filter_map(Connection::target)
            .collect()
    }
}
