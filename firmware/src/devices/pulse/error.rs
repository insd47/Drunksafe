use esp_idf_svc::sys::EspError;

/// pulse 센서 I/O와 분석 입력 검증 중 발생하는 오류다.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// ESP-IDF HAL에서 전달된 오류다.
    #[error(transparent)]
    Esp(#[from] EspError),
    /// sample timestamp가 이전 sample보다 뒤로 이동했다.
    #[error(
        "pulse sample timestamp moved backwards: previous {previous_ms}ms, current {current_ms}ms"
    )]
    NonMonotonic {
        /// 직전 sample의 측정 경과 시간이다.
        previous_ms: u32,
        /// 현재 sample의 측정 경과 시간이다.
        current_ms: u32,
    },
}

/// pulse device에서 사용하는 결과 타입이다.
pub type Result<T> = core::result::Result<T, Error>;
