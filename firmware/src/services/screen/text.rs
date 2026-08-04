use embedded_graphics::pixelcolor::BinaryColor;
use embedded_graphics::prelude::Point;
use u8g2_fonts::types::{FontColor, HorizontalAlignment, VerticalPosition};
use u8g2_fonts::{fonts, Content, FontRenderer};

use crate::devices::DisplayFrame;

const FONT: FontRenderer =
    FontRenderer::new::<fonts::u8g2_font_gulim11_t_korean2>().with_ignore_unknown_chars(false);

pub fn center(frame: &mut DisplayFrame, baseline: i32, content: impl Content) {
    render(
        frame,
        Point::new(64, baseline),
        HorizontalAlignment::Center,
        content,
    );
}

pub fn left(frame: &mut DisplayFrame, baseline: i32, content: impl Content) {
    render(
        frame,
        Point::new(16, baseline),
        HorizontalAlignment::Left,
        content,
    );
}

pub fn right(frame: &mut DisplayFrame, baseline: i32, content: impl Content) {
    render(
        frame,
        Point::new(120, baseline),
        HorizontalAlignment::Right,
        content,
    );
}

fn render(
    frame: &mut DisplayFrame,
    point: Point,
    alignment: HorizontalAlignment,
    content: impl Content,
) {
    if let Err(error) = FONT.render_aligned(
        content,
        point,
        VerticalPosition::Baseline,
        alignment,
        FontColor::Transparent(BinaryColor::On),
        frame,
    ) {
        log::warn!("screen text render failed: {error:?}");
    }
}
