use std::time::Duration;

use esp_idf_svc::hal::task::block_on;

use crate::devices::{Devices, TriggerDevice};
use crate::error::Result;
use crate::services::ble::{
    analysis, event, session, BleService, ErrorCode, MeasurementKind, MeasurementStep, Source,
    StatusKind,
};
use crate::services::measure::{MeasureRun, MeasureService};
use crate::services::screen::{ScreenService, View};

const IDLE_POLL: Duration = Duration::from_millis(20);

pub struct Application {
    ble: BleService,
    measure: MeasureService<'static>,
    screen: ScreenService<'static>,
    trigger: TriggerDevice,
    sequence: u32,
}

impl Application {
    pub fn new(devices: Devices) -> Result<Self> {
        Ok(Self {
            ble: BleService::new(devices.modem)?,
            measure: MeasureService::new(devices.pulse, devices.alcohol),
            screen: ScreenService::new(devices.display),
            trigger: devices.trigger,
            sequence: 0,
        })
    }

    pub fn run(mut self) -> ! {
        self.screen.show(View::Home);
        self.ble.send(event::status(StatusKind::Idle, None));

        loop {
            if let Some((source, kind)) = self.start() {
                self.measure(source, kind);
            }

            std::thread::sleep(IDLE_POLL);
        }
    }

    fn start(&mut self) -> Option<(Source, MeasurementKind)> {
        let phone = session::start(&self.ble);

        if self.trigger.pressed() {
            Some((Source::BoardButton, MeasurementKind::Measurement))
        } else {
            phone.map(|kind| (Source::Phone, kind))
        }
    }

    fn measure(&mut self, source: Source, kind: MeasurementKind) {
        self.sequence = self.sequence.wrapping_add(1);
        let session_id = format!("fw-{}", self.sequence);

        self.ble.send(event::status(
            StatusKind::Measuring,
            Some(session_id.clone()),
        ));
        self.ble
            .send(event::started(session_id.clone(), source, kind));
        self.screen.show(View::Context);

        let context = match session::context(&self.ble, &session_id) {
            Ok(context) => context,
            Err(code) => {
                self.ble.send(event::error(Some(session_id.clone()), code));
                self.ble.send(event::status(StatusKind::Idle, None));
                self.screen.show(if code == ErrorCode::Cancelled {
                    View::Home
                } else {
                    View::Failed
                });
                return;
            }
        };

        for step in [
            MeasurementStep::Preparing,
            MeasurementStep::WarmingSensor,
            MeasurementStep::WaitingBreath,
            MeasurementStep::SamplingBreath,
            MeasurementStep::SamplingPulse,
        ] {
            self.ble.send(event::progress(session_id.clone(), step));
        }

        self.screen.show(View::Measuring);
        let result = block_on(
            self.measure
                .run_until_cancelled(session::cancel(&self.ble, &session_id)),
        );

        match result {
            Ok(MeasureRun::Completed(measurement)) => {
                self.screen.show(View::Analyzing);
                self.ble.send(event::progress(
                    session_id.clone(),
                    MeasurementStep::Analyzing,
                ));
                self.ble
                    .send(event::progress(session_id.clone(), MeasurementStep::Done));
                self.ble.send(analysis::result(
                    session_id.clone(),
                    kind,
                    measurement,
                    Some(&context),
                ));
                self.ble
                    .send(event::status(StatusKind::ResultReady, Some(session_id)));
                self.screen.show(View::Result(measurement));
            }
            Ok(MeasureRun::Cancelled) => {
                self.ble
                    .send(event::error(Some(session_id.clone()), ErrorCode::Cancelled));
                self.ble.send(event::status(StatusKind::Idle, None));
                self.screen.show(View::Home);
            }
            Err(error) => {
                self.ble
                    .send(event::error(Some(session_id.clone()), event::code(&error)));
                self.ble
                    .send(event::status(StatusKind::Error, Some(session_id)));
                self.screen.show(View::Failed);
                log::error!("measure failed: error={error}");
            }
        }
    }
}
