pub struct ResultPager {
    snapshot: Option<ResultSnapshot>,
    page: ResultTab,
}

#[derive(Clone, Copy)]
struct ResultSnapshot {
    alcohol_mg_l_x1000: u16,
    pulse_bpm: Option<u16>,
}

#[derive(Clone, Copy)]
enum ResultTab {
    Done,
    Alcohol,
    Pulse,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResultPage {
    Home,
    Done {
        alcohol_mg_l_x1000: u16,
        pulse_bpm: Option<u16>,
    },
    Alcohol {
        alcohol_mg_l_x1000: u16,
    },
    Pulse {
        pulse_bpm: Option<u16>,
    },
}

impl ResultPager {
    pub const fn new() -> Self {
        Self {
            snapshot: None,
            page: ResultTab::Done,
        }
    }

    pub fn set(&mut self, alcohol_mg_l_x1000: u16, pulse_bpm: Option<u16>) {
        self.snapshot = Some(ResultSnapshot {
            alcohol_mg_l_x1000,
            pulse_bpm,
        });
        self.page = ResultTab::Done;
    }

    pub fn clear(&mut self) {
        self.snapshot = None;
        self.page = ResultTab::Done;
    }

    pub fn current(&self) -> ResultPage {
        match self.snapshot {
            Some(snapshot) => self.page.page(snapshot),
            None => ResultPage::Home,
        }
    }

    pub fn next(&self) -> ResultPage {
        match self.snapshot {
            Some(snapshot) => self.page.next().page(snapshot),
            None => ResultPage::Home,
        }
    }

    pub fn advance(&mut self) {
        if self.snapshot.is_some() {
            self.page = self.page.next();
        }
    }
}

impl ResultTab {
    const fn next(self) -> Self {
        match self {
            Self::Done => Self::Alcohol,
            Self::Alcohol => Self::Pulse,
            Self::Pulse => Self::Done,
        }
    }

    const fn page(self, snapshot: ResultSnapshot) -> ResultPage {
        match self {
            Self::Done => ResultPage::Done {
                alcohol_mg_l_x1000: snapshot.alcohol_mg_l_x1000,
                pulse_bpm: snapshot.pulse_bpm,
            },
            Self::Alcohol => ResultPage::Alcohol {
                alcohol_mg_l_x1000: snapshot.alcohol_mg_l_x1000,
            },
            Self::Pulse => ResultPage::Pulse {
                pulse_bpm: snapshot.pulse_bpm,
            },
        }
    }
}
