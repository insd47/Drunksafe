use serde::{Deserialize, Serialize};

/// 호기 알코올 농도다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Concentration {
    /// mg/L 단위를 1000배 정수로 표현한 값이다.
    pub mg_l_x1000: u16,
}

impl Concentration {
    /// mg/L x1000 정수값으로 농도 모델을 만든다.
    pub const fn new(mg_l_x1000: u16) -> Self {
        Self { mg_l_x1000 }
    }
}
