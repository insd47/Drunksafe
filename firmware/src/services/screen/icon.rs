use embedded_graphics::pixelcolor::BinaryColor;
use embedded_graphics::prelude::{Drawable, Point, Primitive};
use embedded_graphics::primitives::{Circle, Line, PrimitiveStyle, Rectangle};

use crate::devices::DisplayFrame;

const STROKE: PrimitiveStyle<BinaryColor> = PrimitiveStyle::with_stroke(BinaryColor::On, 1);
const FILL: PrimitiveStyle<BinaryColor> = PrimitiveStyle::with_fill(BinaryColor::On);

pub fn check(frame: &mut DisplayFrame) {
    let _ = Circle::new(Point::new(53, 1), 22)
        .into_styled(STROKE)
        .draw(frame);
    let _ = Line::new(Point::new(59, 12), Point::new(63, 16))
        .into_styled(STROKE)
        .draw(frame);
    let _ = Line::new(Point::new(63, 16), Point::new(70, 8))
        .into_styled(STROKE)
        .draw(frame);
}

pub fn cross(frame: &mut DisplayFrame) {
    let _ = Circle::new(Point::new(53, 1), 22)
        .into_styled(STROKE)
        .draw(frame);
    let _ = Line::new(Point::new(59, 8), Point::new(69, 18))
        .into_styled(STROKE)
        .draw(frame);
    let _ = Line::new(Point::new(69, 8), Point::new(59, 18))
        .into_styled(STROKE)
        .draw(frame);
}

pub fn spinner(frame: &mut DisplayFrame) {
    for point in [
        Point::new(58, 3),
        Point::new(66, 3),
        Point::new(54, 10),
        Point::new(70, 10),
        Point::new(54, 18),
        Point::new(70, 18),
        Point::new(58, 25),
        Point::new(66, 25),
    ] {
        let _ = Circle::new(point, 3).into_styled(FILL).draw(frame);
    }
}

pub fn breath(frame: &mut DisplayFrame) {
    for y in [5, 12, 19] {
        let _ = Line::new(Point::new(45, y), Point::new(59, y))
            .into_styled(STROKE)
            .draw(frame);
        let _ = Line::new(Point::new(59, y), Point::new(64, y + 3))
            .into_styled(STROKE)
            .draw(frame);
        let _ = Line::new(Point::new(64, y + 3), Point::new(72, y + 3))
            .into_styled(STROKE)
            .draw(frame);
        let _ = Line::new(Point::new(72, y + 3), Point::new(82, y))
            .into_styled(STROKE)
            .draw(frame);
    }
}

pub fn separator(frame: &mut DisplayFrame, y: i32) {
    let _ = Rectangle::new(
        Point::new(8, y),
        embedded_graphics::geometry::Size::new(112, 1),
    )
    .into_styled(FILL)
    .draw(frame);
}

pub fn bullet(frame: &mut DisplayFrame, y: i32) {
    let _ = Circle::new(Point::new(7, y - 3), 5)
        .into_styled(FILL)
        .draw(frame);
}
