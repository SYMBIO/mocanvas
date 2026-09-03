//! Per-shape render style mirrored from the record's props.

/// Colors are `0xRRGGBBAA`.
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(C)]
pub struct Style {
    /// Fill color; alpha 0 means no fill.
    pub fill: u32,
    /// Stroke color; alpha 0 means no stroke.
    pub stroke: u32,
    /// Stroke width in page units.
    pub stroke_width: f32,
    /// Dash pattern id (0 = solid). Interpreted by the tessellator.
    pub dash: u32,
    /// Opacity multiplier 0..1 applied to both fill and stroke.
    pub opacity: f32,
}

impl Default for Style {
    fn default() -> Self {
        Self { fill: 0, stroke: 0x1d1d1dff, stroke_width: 2.0, dash: 0, opacity: 1.0 }
    }
}

impl Style {
    /// Whether the fill is visible.
    #[inline]
    pub fn has_fill(&self) -> bool {
        (self.fill & 0xff) != 0
    }
    /// Whether the stroke is visible.
    #[inline]
    pub fn has_stroke(&self) -> bool {
        (self.stroke & 0xff) != 0 && self.stroke_width > 0.0
    }
}

/// Unpack `0xRRGGBBAA` to normalized floats, applying `opacity`.
#[inline]
pub fn unpack_rgba(c: u32, opacity: f32) -> [f32; 4] {
    let inv = 1.0 / 255.0;
    [
        ((c >> 24) & 0xff) as f32 * inv,
        ((c >> 16) & 0xff) as f32 * inv,
        ((c >> 8) & 0xff) as f32 * inv,
        (c & 0xff) as f32 * inv * opacity,
    ]
}
