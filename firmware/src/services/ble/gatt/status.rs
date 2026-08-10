use esp_idf_svc::bt::ble::gatt::GattStatus;
use esp_idf_svc::sys::{EspError, ESP_FAIL};

pub fn gatt(status: GattStatus) -> Result<(), EspError> {
    if matches!(status, GattStatus::Ok) {
        Ok(())
    } else {
        log::warn!("GATT status is not ok: {status:?}");
        Err(EspError::from_infallible::<ESP_FAIL>())
    }
}

pub fn callback(result: Result<(), EspError>) {
    if let Err(error) = result {
        log::warn!("BLE callback failed: {error:?}");
    }
}
