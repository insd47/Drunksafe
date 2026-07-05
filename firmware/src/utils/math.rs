/// 비어 있지 않은 `f32` slice의 산술 평균을 계산한다.
///
/// 호출자는 `values`가 비어 있지 않음을 보장해야 한다.
pub fn mean(values: &[f32]) -> f32 {
    values.iter().sum::<f32>() / values.len() as f32
}

/// 비어 있지 않은 `f32` slice의 표준편차를 계산한다.
///
/// `mean`은 같은 slice에서 계산한 평균이어야 한다.
pub fn stddev(values: &[f32], mean: f32) -> f32 {
    let variance = values
        .iter()
        .map(|value| {
            let diff = value - mean;
            diff * diff
        })
        .sum::<f32>()
        / values.len() as f32;

    variance.sqrt()
}

/// 소수점 `places` 자리까지 반올림한다.
pub fn round(value: f32, places: i32) -> f32 {
    let scale = 10_f32.powi(places);
    (value * scale).round() / scale
}
