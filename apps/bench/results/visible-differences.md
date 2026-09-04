Comparing `compare-tldraw.png` with `compare-mocanvas.png`. Both are the same unmodified fixture
rendered by each library. This list was re-measured on `ef4d079`, after the fill-ramp fix; the
entry that used to head it — "fill strength", ~85% of the diff — is gone, and the list below is
re-ordered accordingly.

The percentages are measured, not guessed: differing pixels inside a box drawn around each shape,
at the same tolerance as the headline number (any channel differing by more than 24/255), as a
share of all differing pixels in the image (36,368). The boxes overlap where the shapes do — the
bent arrow crosses both the rectangle and the ellipse — so the shares add up to slightly more than
100%. They are shares of a diff that is now a third of its previous size, so a share that went *up*
does not mean that difference got worse: every remaining cause grew as a fraction of a much smaller
whole.

1. **Hand-drawn outline geometry — now the largest cause, roughly half the diff.** tldraw's default
   `dash: "draw"` wobbles the outline, overshoots at corners, varies the stroke width, and rounds
   every corner generously. mocanvas draws the exact polygon with a uniform stroke and sharp
   vertices. Now that the fills agree, this is *all* that is left inside most of the filled shapes:
   two rings of stroke that do not sit on the same pixels, around interiors that match exactly.
   - Share of the diff: hexagon 15.8%, rectangle 11.6%, star 10.3%, ellipse 5.8%,
     triangle 4.8%, line 3.0%, straight arrow 2.4%.
   - The hexagon is the clearest case and the single largest region in the diff. The star is the
     most extreme in relative terms: its box scores a region IoU of only 20.0%, because a `semi`
     star is nothing but outline and tldraw rounds every one of its ten points.
   - The rectangle's 11.6% is not all outline — about 3.5 points of it is the "Hello box" label
     (see 5) and the bent arrow crosses the box (see 4). Its outline band alone is about 2.9%.
   - Stroke *colours* match exactly: scanning across the ellipse, both libraries put the same
     `#e03131` ring in the same place; the star's is `#f1ac4b` on both sides.

2. **Frame chrome. 14.6% of the diff, region IoU 47.8%.** tldraw's frame border is `#717171`;
   mocanvas's is a lighter, bluer `#9fa8b2`, one pixel lower (the top edge lands on y=475 against
   tldraw's y=474). The "Frame A" label is lighter in mocanvas and sits 2 px right and 3 px down of
   tldraw's. The frame's two children contribute about 6.0% between them, and that is outline
   geometry (cause 1), not fill: both children's interiors are `#fcfffe` in both renders.

3. **Note chrome. 11.1% of the diff at a region IoU of 95.9%**, on the largest single shape in the
   fixture — the high IoU says the note is in the right place at the right size, and the 11.1% is
   almost entirely colour. What is missing in mocanvas is the trim: tldraw draws a soft drop shadow
   below the note (about 3.7% of the diff on its own; the strip below the body fades to `#e6e7e9`)
   and a subtle top-to-bottom gradient on the body (`#f7dc99` at the top → `#fce19c` at the
   bottom). mocanvas's body is a flat `#fce19c` — matching tldraw's *bottom* — with nothing beneath
   it. The "Sticky note" label matches in position and size, and is marginally lighter.

4. **The bound arrow terminates differently. 9.0%, region IoU 48.1%.** tldraw stops the bent arrow
   short of the rectangle it is bound to, leaving a visible gap; mocanvas runs it to the shape's
   edge, so its arrowhead overlaps the border. The arrowhead is also slightly larger and at a
   slightly different angle. The bent-arrow box overlaps the rectangle and the ellipse, so part of
   that 9.0% is their outlines.

5. **Font weight. Text shape region: 6.9% of the diff, region IoU 25.5%** (low because a glyph
   either lands on a pixel or does not). Size, baseline and position agree — "Hello box", "Sticky
   note", "Plain text shape" and the frame label all sit where tldraw puts them, at the same size.
   What differs is the face: tldraw's is heavier and slightly wider, so "Plain text shape" ends at
   x=523 in mocanvas against x=548 in tldraw — about 25 px earlier — and inks 1,237 dark pixels
   against tldraw's 1,683.

6. **Freehand stroke taper. 4.3% of the diff, region IoU 48.8%.** Both draw the same wave along the
   same curve. tldraw's stroke varies in width and tapers to a point at both ends (pressure
   simulation); mocanvas's is uniform width, blunt at both ends, and marginally thinner overall.

7. **tldraw watermark. 1.9%, region IoU 0.0%.** tldraw paints a "Get a license for production" badge
   in the bottom-right corner; mocanvas has nothing there. Not a rendering difference at all — and
   it is a larger share of the diff than it used to be only because the diff shrank around it.

8. **Framing.** Zoom-to-fit lands slightly differently: ignoring the watermark, mocanvas's ink
   bounding box is 1136×708 px starting at (32, 46), against tldraw's 1142×712 starting at (29, 43)
   — 3 px right, 3 px down, and 0.5% smaller. Every shape carries that offset, which widens every
   edge in the diff a little. Part of the size difference is tldraw's hand-drawn overshoot spilling
   past the true geometry.

**Retired from this list** — these were real in earlier runs and are not differences any more:

- **Fill strength (was #1, ~85% of the diff).** `getFillRgba`
  (`packages/mocanvas/src/shapes/shape-theme.ts`, commit `ef4d079`) now maps `semi` to the paper
  colour, `solid` to the hue's pale tint, and `fill` to the hue itself. Measured over the eroded
  interior of each filled shape — well inside the outline, so no stroke pixels are counted — the
  two renders are now byte-identical: the red ellipse is `#f4dadb` on both sides (9,374 px, 0.0%
  differing), the violet hexagon `#ecdcf2` on both (7,448 px, 0.0%), the blue rectangle `#fcfffe`
  on both (7,503 px, 0.0%), the star `#fcfffe` on both (1,672 px, 0.6% — that residue is the
  hand-drawn outline of a point intruding into the sample box, not fill), and both of the frame's
  children `#fcfffe` on both (0.0%). The ellipse's box, which the old list put at 20.0% of the
  diff on a fill disagreement, is down to 5.8% at a region IoU of 96.7%. This single change took
  the whole-image diff from 12.14% to 3.79% and the painted-pixel IoU from 56.4% to 79.1%.
- mocanvas rendered *nothing* from the unmodified file (it threw on `props.richText`). It loads and
  draws all 14 shapes.
- The sticky note's "Sticky note" label was missing. It renders, at the right size and position.
- The text shape's and the freehand stroke's content were only present in a shimmed render. Both
  come from the raw file now.

Everything else lines up: the page background (`#f9fafb` on both, exactly), the note body colour,
every fill colour, every stroke colour, shape positions and sizes, the geo shape set, the bent
arrow's binding to the rectangle, the straight arrow, the line's spline, the frame and both of its
children, and the text shape's position.
