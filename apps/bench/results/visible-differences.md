Comparing `compare-tldraw.png` with `compare-mocanvas-shimmed.png` (the raw-file mocanvas
screenshot is blank — see the load warnings). Ordered roughly by how much they cost in the pixel diff:

1. **Stroke style.** tldraw's default `dash: "draw"` renders a hand-drawn stroke: variable width,
   slightly wobbly geometry, overshooting corners. mocanvas draws a clean, uniform-width geometric
   stroke. This is the single largest source of differing pixels and it touches every outlined shape —
   most obvious on the star, hexagon and ellipse.
2. **Fill saturation.** mocanvas's `semi` and `solid` fills are noticeably more saturated than
   tldraw's. The blue rectangle's `semi` fill is a clear periwinkle in mocanvas but almost white in
   tldraw; the red ellipse and violet hexagon are flat saturated colour in mocanvas versus a paler
   tint in tldraw.
3. **Outlines on filled shapes.** tldraw strokes solid-filled shapes with a darker outline of the same
   hue (visible on the red ellipse and violet hexagon). mocanvas fills them with no contrasting stroke,
   so those shapes read as flat discs.
4. **Note text is missing.** mocanvas renders the sticky note's yellow body but not its "Sticky note"
   label; tldraw renders the text. mocanvas also omits tldraw's note drop shadow and the subtle
   top-to-bottom gradient on the note body, so the note is a flat rectangle.
5. **Font.** tldraw's default draw font is heavy and quirky; mocanvas falls back to a lighter, more
   conventional sans. "Hello box", "Plain text shape" and the frame label all differ in weight, letter
   shapes and advance widths, so the glyphs never line up even where the layout box does.
6. **Freehand stroke taper.** tldraw's draw stroke tapers to a point at both ends (pressure
   simulation); mocanvas's is uniform width end to end.
7. **tldraw watermark.** tldraw paints a "Get a license for production" badge in the bottom-right
   corner. mocanvas has nothing there, so this is a small fixed contribution to the diff that is not a
   rendering difference at all.
8. **Framing.** zoom-to-fit lands a few pixels apart — the mocanvas scene sits roughly 2–4 px lower and
   marginally narrower. Since every shape is offset by that amount, it inflates the diff slightly
   across the whole image.
9. **Arrowheads.** Very close. mocanvas's arrowhead on the bent arrow is a little smaller and sits at a
   slightly different angle, and the bent arrow's curve terminates a few pixels short of tldraw's.

Everything else lines up: shape positions and sizes, the geo shape set (rectangle, ellipse, star,
triangle, hexagon), the bent arrow's binding to the rectangle, the straight arrow, the line's spline,
the frame and both of its children, and the text shape's position.
