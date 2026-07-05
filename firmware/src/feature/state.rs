use std::sync::{Arc, Mutex};

pub type Shared<T> = Arc<Mutex<T>>;

pub fn shared<T>(state: T) -> Shared<T> {
    Arc::new(Mutex::new(state))
}
