use esp_idf_svc::bt::ble::gatt::server::ConnectionId;
use esp_idf_svc::bt::BdAddr;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConnectionAction {
    None,
    StopAdvertising,
    BeginAdvertising,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NotificationTarget {
    pub conn_id: ConnectionId,
    pub max_payload_bytes: usize,
}

#[derive(Clone, Debug)]
struct Connection {
    peer: BdAddr,
    conn_id: ConnectionId,
    subscribed: bool,
    mtu: Option<u16>,
}

#[derive(Default)]
pub struct ConnectionState {
    connection: Option<Connection>,
}

impl ConnectionState {
    pub fn connected(&mut self, conn_id: ConnectionId, peer: BdAddr) -> ConnectionAction {
        self.connection = Some(Connection {
            peer,
            conn_id,
            subscribed: false,
            mtu: None,
        });
        ConnectionAction::StopAdvertising
    }

    pub fn disconnected(&mut self, peer: BdAddr) -> ConnectionAction {
        if !self
            .connection
            .as_ref()
            .is_some_and(|connection| connection.peer == peer)
        {
            return ConnectionAction::None;
        }

        self.connection = None;
        ConnectionAction::BeginAdvertising
    }

    pub fn mtu(&mut self, conn_id: ConnectionId, mtu: u16) -> Option<bool> {
        let connection = self
            .connection
            .as_mut()
            .filter(|connection| connection.conn_id == conn_id)?;
        connection.mtu = Some(mtu);
        Some(connection.subscribed)
    }

    pub fn subscribed(&mut self, conn_id: ConnectionId, enabled: bool) -> Option<bool> {
        let connection = self
            .connection
            .as_mut()
            .filter(|connection| connection.conn_id == conn_id)?;
        connection.subscribed = enabled;
        Some(enabled && connection.mtu.is_some())
    }

    pub fn notification_target(&self) -> Option<NotificationTarget> {
        let connection = self.connection.as_ref()?;
        let mtu = connection.mtu?;

        connection.subscribed.then_some(NotificationTarget {
            conn_id: connection.conn_id,
            max_payload_bytes: max_payload_bytes(mtu),
        })
    }
}

pub const fn max_payload_bytes(mtu: u16) -> usize {
    mtu.saturating_sub(3) as usize
}
