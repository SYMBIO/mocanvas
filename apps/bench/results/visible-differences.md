Comparing `compare-tldraw.png` with `compare-mocanvas.png`. Both are the same unmodified fixture
rendered by each library. Re-measured on `83ff957`, in the same run that produced the numbers above.

**Interior IoU 94.1%** at 97.3% colour agreement, **stroke band distance 1.00 px median / 10.05 px
p95** against a ~4 px stroke, whole-image diff 3.82% at 78.2% painted-pixel IoU. Both libraries draw
the default `dash: "draw"` style as a genuinely hand-drawn outline — seeded wobble, rounded corners,
overshoot past the vertex — from *different* random numbers, and a pixel diff charges for that twice,
once in each direction. So the list below is ordered by what the first two numbers say; each shape's
share of the whole-image diff is quoted second, so the older version of this list is still comparable.

#### Where the two renders genuinely differ

1. **The star's inner radius. Interior IoU 69.9% — the lowest in the fixture; 9.9% of the diff.**
   mocanvas draws a five-pointed star with a smaller inner radius than tldraw, so its arms are
   visibly thinner and its points longer. The stroke band agrees with that reading: 2.83 px median,
   8.06 px p95, roughly twice the fixture median. Colour over the shared interior is 99.6%, so this
   is geometry, not fill. Invisible in the whole-image number, where it is buried under stroke
   wobble.

2. **The hexagon's proportions. Interior IoU 80.1%; 15.4% of the diff, the second-largest region.**
   mocanvas's hexagon is narrower across the flats than tldraw's — its vertical edges sit further
   in — so the two outlines diverge by 6.71 px at the median and 14.42 px at the 95th percentile,
   the second-worst band in the fixture. Again 99.3% colour agreement inside: geometry only.

3. **The bound arrow terminates differently. Band 4.12 px median, 19.85 px p95 — the worst in the
   fixture; 10.1% of the diff.** tldraw stops the bent arrow short of the rectangle it is bound to,
   leaving a visible gap; mocanvas runs it to the shape's edge, so its arrowhead overlaps the
   border. The arrowhead is also slightly larger and at a slightly different angle. A binding
   difference, not a stroke one.

4. **Font weight. Text-shape band 2.00 px median, 12.04 px p95; 6.9% of the diff.** Size, baseline
   and position agree — "Hello box", "Sticky note", "Plain text shape" and the frame label all sit
   where tldraw puts them, at the same size. The face differs: tldraw's is heavier and slightly
   wider, so "Plain text shape" ends at x=523 in mocanvas against x=548 in tldraw — about 25 px
   earlier — and inks 1,206 dark pixels against tldraw's 1,638. This is also what the rectangle's
   94.8% interior colour agreement is (its "Hello box" label), and most of the note's 95.9%.

5. **tldraw watermark. 1.8% of the diff.** tldraw paints a "Get a license for production" badge in
   the bottom-right corner; mocanvas has nothing there. Not a rendering difference. Both region
   metrics exclude it — found automatically as the one place in the corner where the reference
   painted and mocanvas painted nothing at all.

6. **Framing.** Zoom-to-fit still lands a little differently: ignoring the watermark, mocanvas's ink
   bounding box is 1141×709 px starting at (29, 45), against tldraw's 1142×712 starting at (29, 43)
   — same left edge, 2 px lower, 3 px shorter. Every shape carries that offset, which costs each
   interior-IoU row a point or two and costs the small shapes more.

#### Where a large diff share is *not* a difference worth fixing

- **The frame. 16.7% of the diff — the largest single region — at an interior IoU of 98.8% and a
  band of 1.00 px median / 2.00 px p95.** Almost all of it is one thing: the frame's border is a
  hairline, and it lands one pixel lower in mocanvas than in tldraw. Rows y=474/475 and y=752/753/754
  contribute 431 differing pixels each — about 4.7% of the whole image diff for a one-pixel offset
  of a 1 px line. Border colour matches exactly (`#717171` on both sides), and the frame's two
  children score 98.4% and 94.7% interior IoU at 99.8% / 99.5% colour agreement.

- **The outlines of the rectangle, ellipse and triangle. 11.5%, 6.7% and 5.3% of the diff.** All
  three sit at a 1.00 px median band distance and a p95 of 2.24–3.00 px, and at 96.8%, 96.8% and
  92.8% interior IoU with ≥99.3% colour agreement inside. This is the case the whole-image number
  cannot score: two hand-drawn rings that never coincide, around interiors that agree. The
  rectangle's share is also inflated by the "Hello box" label and by the bent arrow crossing its box.

- **The freehand stroke. 4.3% of the diff, band 1.00 px median / 3.00 px p95.** Both draw the same
  wave along the same curve, within a stroke width the whole way. Widths now agree closely too —
  column-summed dark pixels are 1,316 for tldraw against 1,421 for mocanvas — so the earlier note
  that mocanvas's stroke was uniform-width, blunt and thinner no longer holds; only the very start
  of the stroke is still noticeably thicker in tldraw.

- **The line and the straight arrow. 4.1% and 1.7%, band medians 1.00 px and 0.00 px.** The straight
  arrow is the closest match in the fixture.

#### Retired from this list

These were real in earlier runs and are not differences any more:

- **The note's trim (was cause #3, 11.1% of the diff).** mocanvas draws the note's top-to-bottom
  gradient and its drop shadow now. At the note's centre column the body reads `#f7dc99` (tldraw)
  against `#f8dd9a` (mocanvas) at the top and `#fce19c` against `#fbe09c` at the bottom, and the
  shadow below the body fades through the same greys on both sides — every one of those pairs is
  inside the comparison's 24/255 tolerance. What is left of the note's 9.0% diff share is the label's
  font weight and a one-pixel offset of its bottom edge.
- **The frame's border colour (was part of cause #2).** mocanvas drew `#9fa8b2`; it now draws
  `#717171`, the same as tldraw.
- **Fill strength (was #1, ~85% of the diff).** `getFillRgba`
  (`packages/mocanvas/src/shapes/shape-theme.ts`, commit `ef4d079`) maps `semi` to the paper colour,
  `solid` to the hue's pale tint, and `fill` to the hue. Interior colour agreement is now ≥99.3% on
  every shape that is only fill.
- **Exact, uniform outlines (was cause #1 at `ef4d079`).** mocanvas drew the exact polygon with a
  uniform stroke and sharp vertices where tldraw wobbled, overshot and rounded. It now draws a
  hand-drawn outline of its own. This *raised* the whole-image diff slightly, which is why that
  number is reported last.
- mocanvas rendered *nothing* from the unmodified file (it threw on `props.richText`). It loads and
  draws all 14 shapes.
- The sticky note's "Sticky note" label was missing, and the text shape's and freehand stroke's
  content were only present in a shimmed render. All three come from the raw file now.

Everything else lines up: the page background (`#f9fafb` on both, exactly), every fill colour, every
stroke colour, shape positions and sizes, the geo shape set, the bent arrow's binding to the
rectangle, the line's spline, the frame and both of its children, and the text shape's position.
