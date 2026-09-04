Comparing `compare-tldraw.png` with `compare-mocanvas.png`. Both are the same unmodified fixture
rendered by each library. Re-measured on `2ef11f1`, in the same run that produced the numbers above.

**Interior IoU 96.0%** at 97.3% colour agreement, **stroke band distance 1.00 px median / 5.10 px
p95** against a ~4 px stroke, whole-image diff 3.33% at 81.6% painted-pixel IoU. Both libraries draw
the default `dash: "draw"` style as a genuinely hand-drawn outline — seeded wobble, rounded corners,
overshoot past the vertex — from *different* random numbers, and a pixel diff charges for that twice,
once in each direction. So the list below is ordered by what the first two numbers say; each shape's
share of the whole-image diff is quoted second, so the older version of this list stays comparable.

Every figure in this file was measured off the two PNGs; none is carried over from an earlier run.

#### Where the two renders genuinely differ

1. **The bound arrow terminates differently. Band 4.12 px median, 19.85 px p95 — the worst in the
   fixture by a wide margin, and now the only region whose median is more than half a stroke width
   out; 11.5% of the diff.** tldraw stops the bent arrow short of the rectangle it is bound to,
   leaving a visible gap; mocanvas runs it to the shape's edge, so its arrowhead sits on the border.
   The arrowhead is also slightly larger and at a slightly different angle. A binding difference, not
   a stroke one, and the largest single thing left on this list.

2. **The note's drop shadow spreads further. Interior IoU 90.3%, joint-lowest in the fixture; 10.3%
   of the diff.** The note *body* is not the problem: it measures 214 px wide in both renders, its
   top-to-bottom gradient reads `#f7dc99` at the top and `#fce19c` at the bottom in **both** images —
   identical, not merely within tolerance — and it sits 2 px right of tldraw's. What differs is the
   shadow around it. Including the shadow, mocanvas's note silhouette spans x 24–257 and starts at
   y 489, against tldraw's x 31–246 from y 496: mocanvas's shadow reaches about 7 px further on each
   side and 7 px higher. Since the interior metric scores the whole silhouette, that spread is most
   of the missing 10 points. It is also why mocanvas's ink bounding box starts 4 px further left than
   tldraw's (see 4).

3. **Font weight. Text-shape band 2.00 px median, 12.04 px p95, and the fixture's worst single pixel
   at 26.17 px; 7.9% of the diff.** Size, baseline and position agree — "Hello box", "Sticky note",
   "Plain text shape" and the frame label all sit where tldraw puts them, at the same size, and
   "Plain text shape" starts at exactly x=334 in both. The face differs: tldraw's is heavier and
   slightly wider, so that line ends at x=522 in mocanvas against x=548 in tldraw — 26 px earlier —
   and inks 1,170 dark pixels against tldraw's 1,590. This is also what the rectangle's 94.8%
   interior colour agreement is (its "Hello box" label), and part of the note's 95.9%.

4. **Framing.** Zoom-to-fit still lands slightly differently. Ignoring the watermark, mocanvas's ink
   bounding box is 1146×710 px starting at (24, 44), against tldraw's 1143×712 starting at (28, 43).
   The 4 px on the left edge is the note's wider shadow (see 2); the rest is a 1 px vertical offset
   carried by every shape, which costs each interior-IoU row a point or two and costs the small
   shapes more than the large ones.

5. **tldraw watermark. 2.1% of the diff.** tldraw paints a "Get a license for production" badge in
   the bottom-right corner; mocanvas has nothing there. Not a rendering difference. Both region
   metrics exclude it — found automatically as the one place in the corner where the reference
   painted and mocanvas painted nothing at all.

#### Where a large diff share is *not* a difference worth fixing

- **The frame. 19.1% of the diff — the largest single region — at an interior IoU of 98.8% and a
  band of 1.00 px median / 2.00 px p95.** Almost all of it is one thing: the frame's border is a
  hairline, and it lands one pixel off in mocanvas. A 1 px offset of a 1 px line differs on every
  pixel of both copies, which is expensive in a pixel diff and invisible on screen. Border colour
  matches exactly (`#717171` on both sides), and the frame's two children score 98.4% and 94.7%
  interior IoU at 99.8% / 99.5% colour agreement for 3.5% and 5.3% of the diff.

- **The outlines of the rectangle, ellipse, star, hexagon and triangle. 13.2%, 7.7%, 7.4%, 7.0% and
  6.1% of the diff.** All five now sit at a 1.00 px median band distance with a p95 of 2.24–3.00 px,
  which is as close as two independently seeded hand-drawn outlines can get. Their interior IoUs are
  96.8%, 96.8%, 90.3%, 95.7% and 92.8%, at ≥98.0% colour agreement inside. This is the case the
  whole-image number cannot score: two hand-drawn rings that never coincide, around interiors that
  agree. The star's and triangle's IoUs are the lowest of the five simply because they are the two
  smallest interiors in the fixture (8,666 and 8,897 px), so the 6 px erosion and the 1 px framing
  offset both cost them proportionally more. The rectangle's diff share is additionally inflated by
  the "Hello box" label and by the bent arrow crossing its box.

- **The freehand stroke. 4.9% of the diff, band 1.00 px median / 3.00 px p95.** Both draw the same
  wave along the same curve, within a stroke width the whole way, and at closely matching widths.

- **The line and the straight arrow. 4.7% and 1.9%, band medians 1.00 px and 0.00 px.** The straight
  arrow is the closest match in the fixture.

#### Retired from this list

These were real in earlier runs and are not differences any more:

- **The star's inner radius (was cause #1 at `83ff957`, interior IoU 69.9%, 9.9% of the diff).**
  mocanvas drew the star with an inner radius of 0.40 of the outer where the reference uses about
  0.51, so its arms were visibly thinner and its points longer. `2ef11f1` sets the ratio to 0.5 as a
  named constant with a test. Interior IoU 69.9% → **90.3%**, band median 2.83 px → **1.00 px**,
  p95 8.06 px → **3.00 px**. What remains is small-shape erosion, not shape.
- **The hexagon's orientation (was cause #2 at `83ff957`, interior IoU 80.1%, 15.4% of the diff).**
  mocanvas put a vertex left and right where the reference puts one top and bottom, which made the
  shape half a box narrower across the flats. `2ef11f1` rotated it. Interior IoU 80.1% → **95.7%**,
  band median 6.71 px → **1.00 px**, p95 14.42 px → **3.00 px**. It was the second-worst band in the
  fixture and is now at the fixture median.
- **The note's trim (was cause #3 two runs ago).** mocanvas draws the note's gradient and drop
  shadow. The gradient is now an exact match at both ends of the body; only the shadow's spread
  differs, which is item 2 above.
- **The frame's border colour.** mocanvas drew `#9fa8b2`; it now draws `#717171`, the same as tldraw.
- **Fill strength (was #1 at `15b670a`, ~85% of the diff).** `getFillRgba`
  (`packages/mocanvas/src/shapes/shape-theme.ts`, commit `ef4d079`) maps `semi` to the paper colour,
  `solid` to the hue's pale tint, and `fill` to the hue. Interior colour agreement is now ≥98.0% on
  every shape that is only fill, and ≥99.1% on all but the star.
- **Exact, uniform outlines (was cause #1 at `ef4d079`).** mocanvas drew the exact polygon with a
  uniform stroke and sharp vertices where tldraw wobbled, overshot and rounded. It now draws a
  hand-drawn outline of its own. That change *raised* the whole-image diff slightly, which is why
  that number is reported last.
- mocanvas rendered *nothing* from the unmodified file (it threw on `props.richText`). It loads and
  draws all 14 shapes.
- The sticky note's "Sticky note" label was missing, and the text shape's and freehand stroke's
  content were only present in a shimmed render. All three come from the raw file now.

Everything else lines up: the page background (`#f9fafb` on both, exactly), every fill colour, every
stroke colour, shape positions and sizes, the geo shape set, the bent arrow's binding to the
rectangle, the line's spline, the frame and both of its children, and the text shape's position.
