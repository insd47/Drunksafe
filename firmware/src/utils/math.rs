pub fn mean(values: &[f32]) -> f32 {
    values.iter().sum::<f32>() / values.len() as f32
}

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

pub fn round(value: f32, places: i32) -> f32 {
    let scale = 10_f32.powi(places);
    (value * scale).round() / scale
}
