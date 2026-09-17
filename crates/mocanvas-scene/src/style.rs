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
    /// Host texture id (0 = none). When set, the fill mesh is replaced by one
    /// textured quad over the shape's local geometry bounds, tinted white × `opacity`.
    pub texture: u32,
    /// Hatch colour, `0xRRGGBBAA`; alpha 0 means no hatch. Drawn *over* the fill
    /// and under the stroke, as parallel lines clipped to the shape — the
    /// texture a "pattern" fill is supposed to be, rather than a flat tint of
    /// the colour that is meant to be the hatch's own stroke.
    ///
    /// Carried outside `SET_STYLE` like [`Self::texture`], so the command that
    /// has been eight words since the first release stays eight words.
    pub hatch: u32,
    /// Distance between hatch lines, in page units. Page units rather than
    /// screen pixels so the hatch belongs to the drawing: it grows and shrinks
    /// with the shape it is in, the way the stroke width does.
    pub hatch_spacing: f32,
    /// Host-supplied per-shape random seed. Only the hand-drawn dash style
    /// (`dash == 3`) reads it: it selects that shape's wobble, so the same seed
    /// with the same geometry always produces the same outline. The host derives
    /// it from the shape's stable id, not from its slot or handle, so a shape that
    /// is removed and re-added under the same id keeps the outline it had.
    pub seed: u32,
}

impl Default for Style {
    fn default() -> Self {
        Self {
            fill: 0,
            stroke: 0x1d1d1dff,
            stroke_width: 2.0,
            dash: 0,
            opacity: 1.0,
            texture: 0,
            hatch: 0,
            hatch_spacing: DEFAULT_HATCH_SPACING,
            seed: 0,
        }
    }
}

/// Spacing a hatch falls back to when the host sends none, in page units.
pub const DEFAULT_HATCH_SPACING: f32 = 6.0;

impl Style {
    /// Whether the hatch is visible.
    #[inline]
    pub fn has_hatch(&self) -> bool {
        self.hatch & 0xff != 0 && self.hatch_spacing > 0.0
    }

    /// Whether the fill is visible.
    #[inline]
    pub fn has_fill(&self) -> bool {
        (self.fill & 0xff) != 0
    }
    /// Whether the fill is a texture.
    #[inline]
    pub fn has_texture(&self) -> bool {
        self.texture != 0
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
