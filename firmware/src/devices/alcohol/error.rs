use esp_idf_svc::sys::EspError;

/// ZE29 알코올 센서 통신과 frame 해석 중 발생하는 오류다.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// ESP-IDF UART driver에서 전달된 오류다.
    #[error(transparent)]
    Esp(#[from] EspError),
    /// UART write가 진행되지 않아 request frame을 끝까지 보낼 수 없다.
    #[error("zero bytes written to alcohol sensor UART")]
    WriteZero,
    /// 정해진 시간 안에 9 byte response frame을 모두 읽지 못했다.
    #[error("timed out while reading alcohol sensor frame")]
    Timeout,
    /// ZE29 frame start byte가 `0xFF`가 아니다.
    #[error("invalid alcohol sensor frame start byte: expected 0xff, found {found:#04x}")]
    InvalidStart {
        /// 실제로 수신한 첫 번째 byte다.
        found: u8,
    },
    /// ZE29 checksum 검증에 실패했다.
    #[error("invalid alcohol sensor checksum: expected {expected:#04x}, got {actual:#04x}")]
    InvalidChecksum {
        /// payload에서 다시 계산한 checksum이다.
        expected: u8,
        /// frame 마지막 byte로 수신한 checksum이다.
        actual: u8,
    },
    /// firmware가 지원하지 않는 ZE29 command byte를 받았다.
    #[error("unknown alcohol sensor command: {command:#04x}")]
    UnknownCommand {
        /// 해석할 수 없는 command byte다.
        command: u8,
    },
    /// 요청한 command와 다른 command의 response frame을 받았다.
    #[error("unexpected alcohol sensor command: expected {expected:#04x}, got {actual:#04x}")]
    UnexpectedCommand {
        /// 요청한 command byte다.
        expected: u8,
        /// response frame에서 수신한 command byte다.
        actual: u8,
    },
    /// response payload가 기대한 도메인 값으로 해석될 수 없다.
    #[error("invalid alcohol sensor payload")]
    InvalidPayload,
}

/// alcohol device에서 사용하는 결과 타입이다.
pub type Result<T> = core::result::Result<T, Error>;
