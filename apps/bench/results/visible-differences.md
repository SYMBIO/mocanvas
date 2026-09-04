Comparing `compare-tldraw.png` with `compare-mocanvas.png`. Both are now the same unmodified
fixture rendered by each library — the previous version of this list was written against a
down-converted ("shimmed") mocanvas render, next to a raw-file screenshot that was blank, and
several of its entries no longer describe anything real.

The percentages are measured, not guessed: differing pixels inside a box drawn around each shape,
at the same tolerance as the headline number (any channel differing by more than 24/255), as a
share of all differing pixels in the image. The boxes overlap where the shapes do — the bent arrow
crosses both the rectangle and the ellipse — so the shares add up to slightly more than 100%.

1. **Fill strength — the five filled shapes hold about 85% of all differing pixels, and this is why.**
   (Their boxes also contain those shapes' outlines and the arrow crossing them, so treat 85% as the
   ceiling for this one cause rather than an exact share.) mocanvas's
   fill ramp is about one step stronger than tldraw's at both fill levels, so the *interiors* of
   filled shapes disagree over large areas while their outlines agree exactly.
   - `fill: "solid"`: the red ellipse is `#e03131` in mocanvas against `#f4dadb` in tldraw; the
     violet hexagon `#ae3ec9` against `#ecdcf2`. tldraw's "solid" is a pale tint of the colour;
     mocanvas's is the colour itself.
   - `fill: "semi"`: the blue rectangle is `#dce1f8` against `#fcfffe` — tldraw's semi fill is
     indistinguishable from the white page. Same for the star (`#f9f0e6` vs `#fcfffe`) and both of
     the frame's children.
   - Share of the diff: rectangle 24.3%, frame (its two filled children) 23.5%, ellipse 20.0%,
     hexagon 16.3%, star 3.2%.
   - The stroke colours match exactly — scanning across the ellipse, both libraries put the same
     `#e03131` ring in the same place. The previous list claimed mocanvas draws filled shapes with
     no contrasting outline; that was wrong. The outline is drawn, it just vanishes into a fill of
     its own colour, which is a consequence of this difference rather than a separate one.

2. **Hand-drawn outline geometry.** tldraw's default `dash: "draw"` wobbles the outline, overshoots
   at corners, varies the stroke width, and rounds every corner generously — the hexagon is the
   clearest case, and the rectangle and the star's points are rounded too. mocanvas draws the exact
   polygon with a uniform stroke and sharp vertices. Because the rounding also cuts the silhouette
   back at each vertex, this shows up in `compare-diff.png` as isolated wedges at the corners of
   otherwise-agreeing shapes. Where there is no fill underneath it is cheap: triangle 1.5%, line
   0.9%, straight arrow 0.7%.

3. **Font weight.** Size, baseline and position now agree — "Hello box", "Sticky note", "Plain text
   shape" and the frame label all sit where tldraw puts them, at the same size. What differs is the
   face: tldraw's is heavier and slightly wider, so "Plain text shape" ends about 25 px earlier in
   mocanvas. Text shape region: 2.2% of the diff, region IoU 25.5% (low because a glyph either
   lands on a pixel or does not).

4. **The bound arrow terminates differently.** tldraw stops the bent arrow short of the rectangle it
   is bound to, leaving a visible gap; mocanvas runs it to the shape's edge, so its arrowhead
   overlaps the border. The arrowhead is also slightly larger and at a slightly different angle.
   The bent-arrow box scores 8.2%, but it overlaps the rectangle and the ellipse, so most of that
   number is really their fills.

5. **Freehand stroke taper.** Both draw the same wave along the same curve (1.4% of the diff, region
   IoU 48.8%). tldraw's stroke varies in width and tapers to a point at both ends (pressure
   simulation); mocanvas's is uniform width, blunt at both ends, and marginally thinner overall.

6. **Note chrome.** The note body colour and its label now match closely — 3.4% of the diff at a
   region IoU of 95.9%, on the largest single shape in the fixture. What is missing in mocanvas is
   the trim: tldraw draws a soft drop shadow below the note (fading `#c0c4c5` → `#f4f5f6` over about
   12 px) and a subtle top-to-bottom gradient on the body (`#f7dc99` → `#fce19c`). mocanvas's body
   is a flat `#fce19c` with nothing beneath it.

7. **Frame chrome.** tldraw's frame border is `#717171`; mocanvas's is a lighter, bluer `#9fa8b2`,
   one pixel lower. The "Frame A" label is lighter in mocanvas and sits a couple of pixels down and
   to the right.

8. **tldraw watermark.** tldraw paints a "Get a license for production" badge in the bottom-right
   corner; mocanvas has nothing there. 0.6% of the diff, and not a rendering difference at all.

9. **Framing.** Zoom-to-fit lands slightly differently: mocanvas's ink bounding box starts 3 px
   right and 3 px down of tldraw's and is 0.5% smaller. Every shape carries that offset, which
   widens every edge in the diff a little. Part of the size difference is tldraw's hand-drawn
   overshoot spilling past the true geometry.

**Retired from this list** — these were real in the previous run and are not differences any more:

- mocanvas rendered *nothing* from the unmodified file (it threw on `props.richText`). It now loads
  and draws all 14 shapes.
- The sticky note's "Sticky note" label was missing. It renders, at the right size and position.
- The text shape's and the freehand stroke's content were only present in the shimmed render. Both
  come from the raw file now.

Everything else lines up: the page background (`#f9fafb` on both, exactly), the note body colour,
every stroke colour, shape positions and sizes, the geo shape set, the bent arrow's binding to the
rectangle, the straight arrow, the line's spline, the frame and both of its children, and the text
shape's position.
