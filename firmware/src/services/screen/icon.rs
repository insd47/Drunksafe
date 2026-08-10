use crate::devices::display::Frame;
use embedded_graphics::geometry::Size;
use embedded_graphics::pixelcolor::BinaryColor;
use embedded_graphics::prelude::{Drawable, Point, Primitive};
use embedded_graphics::primitives::{Circle, Line, PrimitiveStyle, Rectangle};

const STROKE: PrimitiveStyle<BinaryColor> = PrimitiveStyle::with_stroke(BinaryColor::On, 1);
const FILL: PrimitiveStyle<BinaryColor> = PrimitiveStyle::with_fill(BinaryColor::On);

pub fn cross(frame: &mut Frame) {
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

pub fn breath(frame: &mut Frame) {
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

pub fn separator(frame: &mut Frame, y: i32) {
    let _ = Rectangle::new(Point::new(8, y), Size::new(112, 1))
        .into_styled(FILL)
        .draw(frame);
}

pub fn bullet(frame: &mut Frame, y: i32) {
    let _ = Circle::new(Point::new(7, y - 3), 5)
        .into_styled(FILL)
        .draw(frame);
}
