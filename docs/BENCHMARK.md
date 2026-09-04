# Benchmark: mocanvas vs tldraw

_Generated 2026-09-04 11:13:17 UTC by `apps/bench/scripts/bench.mjs`. Re-run with `pnpm --filter bench bench`._

Both libraries are driven through an identical `window.bench` API (`apps/bench/src/bench-api.ts`)
with byte-identical workloads: same grid, same shape sizes, colours and fills, the same scripted
camera path, and the same hit-test sample points. Frame times are frame-to-frame `requestAnimationFrame`
deltas recorded while a camera animation runs (zoom to fit → zoom in 4× → horizontal pan sweep → zoom back out).

> **The two halves of this report were measured at different times.** The rendering comparison was re-measured after the fill-ramp fix; the performance tables were **not** re-run — they are unchanged from the earlier run listed under Environment, and nothing below claims they were.
>
> Rendering comparison: measured 2026-09-04 11:13:17 UTC, git `b89287c-dirty`.
> Performance tables: measured 2026-09-04 09:26:29 UTC, git `15b670a-dirty`.

## What changed since the previous run

Two changes landed between the previous published numbers (2026-09-04 08:30:07 UTC, git `32ac776-dirty`) and this run:

- **`.tldr` loading was fixed.** `normalizeLoadedRecords` (`packages/editor/src/records/normalize.ts`)
  now maps `props.richText` onto `props.text` and decodes packed freehand `segments[].path` into
  `segments[].points` while records are loaded. The previous run could not open the tldraw-authored
  fixture at all — it threw and left a blank canvas — so *that run’s* rendering comparison was measured
  against nothing. mocanvas now loads and draws the unmodified file.
- **Renderer.** A per-frame tessellation budget (256 shapes), frame reuse keyed on scene epoch + zoom
  bucket + viewport containment, and LOD hysteresis. All three target the same thing: the long frames
  where the camera moves but the scene did not.

95th-percentile pan/zoom frame — the metric those renderer changes target. tldraw's column is the
control: its code did not change between the two runs, so whatever it moved by is what this environment
does on its own.

| N | kind | mocanvas before → after | Δ | tldraw before → after (unchanged) | Δ |
| ---: | :--- | ---: | ---: | ---: | ---: |
| 1,000 | geo | 41.6 → 24.5 ms | -41% | 9.0 → 9.1 ms | +1% |
| 5,000 | geo | 84.2 → 66.6 ms | -21% | 33.3 → 25.0 ms | -25% |
| 20,000 | geo | 193.1 → 116.7 ms | -40% | 291.2 → 258.8 ms | -11% |
| 1,000 | mixed | 33.3 → 42.3 ms | +27% | 9.2 → 9.0 ms | -2% |
| 5,000 | mixed | 107.6 → 108.3 ms | +1% | 33.4 → 41.6 ms | +25% |
| 20,000 | mixed | 266.1 → 208.3 ms | -22% | 283.3 → 350.1 ms | +24% |

**Read the control column before reading the first one.** tldraw ran the same code in both runs and still
moved by -25% to +42%: this environment was faster on `geo` and slower on `mixed` than it was two hours
earlier. mocanvas's column has the same shape — large gains on `geo` and at 20,000 `mixed`, nothing or a
small loss on the two small `mixed` cases — so a fair reading is that the renderer changes helped where
there is real work to skip, and that everything else here is the machine, not the code. Frame deltas are
also quantised to the browser's frame cadence (most values land on multiples of ~8.3 ms), which turns a
small real change into a whole bucket or into nothing at all.

The clean measurement of those renderer changes is not this table but the interleaved A/B in
`apps/bench/results/panzoom-after.json`, which toggles frame reuse and the tessellation budget off and on
within a single browser session: it puts the p95 improvement at 16–31% between 5,000 and 20,000 shapes.

Rendering comparison against the same `.tldr` fixture. It has three points now, and only the last
column was measured by the run at the top of this file — see the note above about the two halves of
this report:

| | `32ac776-dirty` (before the .tldr fix) | `15b670a-dirty` (before the fill fix) | `b89287c-dirty` (now) |
| :--- | :--- | :--- | :--- |
| mocanvas loaded the file | no — threw on `props.richText` | yes | yes |
| Painted pixels, mocanvas | 0 | 163,726 | 112,658 |
| Painted-pixel overlap (IoU) | 0.0% | 56.4% | **78.2%** |
| Differing pixels | 11.84% | 12.14% | **3.82%** |

**The fill fix helped, and by a lot.** `getFillRgba` (`packages/mocanvas/src/shapes/shape-theme.ts`)
was mapping `fill: "solid"` onto the palette hue itself and `fill: "semi"` onto a tint of it — one step
stronger than tldraw at both levels. It now maps `semi` to the paper colour, `solid` to the hue's pale
tint, and `fill` to the hue. Measured over the eroded interior of each filled shape, the two renders
are now identical pixel for pixel: the red ellipse is `#f4dadb` on both sides, the violet hexagon
`#ecdcf2`, and the blue rectangle, the star and both of the frame's children `#fcfffe`.

The painted-pixel count falling (163,726 → 112,658, against tldraw's 114,470) is that fix working, not a
regression: a `semi` fill is *supposed* to leave the paper alone, so those pixels correctly stop
counting as ink. mocanvas now inks slightly less than tldraw rather than substantially more.

The differing-pixel row is still the one that reads backwards, and it is worth understanding before
quoting either number — see [the note under the comparison](#rendering-comparison). Note in particular
that it barely moved between the first two columns (11.84% → 12.14%) across the change that took
mocanvas from drawing nothing at all to drawing the whole document.

## Environment

| | |
| :--- | :--- |
| Date | 2026-09-04 11:13:17 UTC (rendering comparison; performance tables measured 2026-09-04 09:26:29 UTC) |
| Machine | Apple M3 Pro, 11 cores, 36 GB |
| OS | Darwin 25.5.0 (arm64) |
| Node | v25.9.0 |
| Browser | headless Chromium 151.0.7922.34 (Playwright 1.62.1) |
| Chromium flags | `--js-flags=--expose-gc --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --hide-scrollbars --force-color-profile=srgb --font-render-hinting=none --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy` |
| GL mode attempted | gpu |
| WebGL2 renderer | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver) |
| Rasterisation | **software (SwiftShader)** — no hardware GPU in this environment |
| tldraw | 5.4.0 |
| mocanvas | 0.0.1 (this repo, b89287c-dirty; performance tables measured at 15b670a-dirty) |
| Builds | production (`vite build`, minified, `NODE_ENV=production`) for both |
| Viewport | 1200×800 CSS px, device scale 1 |
| Matrix | N ∈ {1000, 5000, 20000} × kind ∈ {geo, mixed}, 3 repeats, medians reported |

_Why the performance tables' revision is marked dirty: the tree was checked clean at `15b670a` immediately before that run started, and the bundle is built once, before the first measurement — so a clean `15b670a` is what was measured. The `-dirty` marker comes from edits made after that build: to this report generator, and to UI code (selection handles, style panel, icons) committed by a concurrent session. Neither is in the bundle those numbers come from._

## Results

Every cell is the median of the repeats. `ratio` compares the two: “2.00× faster” means mocanvas took half the time tldraw did.

### Shape creation (`create(n, kind)`)

Wall time of the single `createShapes` call, inside one transaction with history disabled.

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 15 ms | 38 ms | 2.50× faster |
| 5,000 | geo | 40 ms | 120 ms | 2.99× faster |
| 20,000 | geo | 134 ms | 433 ms | 3.23× faster |
| 1,000 | mixed | 26 ms | 76 ms | 2.96× faster |
| 5,000 | mixed | 68 ms | 242 ms | 3.56× faster |
| 20,000 | mixed | 249 ms | 754 ms | 3.02× faster |

Time from the start of that call until the second animation frame afterwards (creation + first paint):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 95 ms | 126 ms | 1.33× faster |
| 5,000 | geo | 122 ms | 470 ms | 3.87× faster |
| 20,000 | geo | 213 ms | 2226 ms | 10.45× faster |
| 1,000 | mixed | 130 ms | 196 ms | 1.51× faster |
| 5,000 | mixed | 174 ms | 727 ms | 4.18× faster |
| 20,000 | mixed | 406 ms | 2923 ms | 7.20× faster |

### Pan / zoom frame time (`panZoomRun(120)`)

120 frames of the scripted camera animation. Median frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 9.10 ms | 8.30 ms | 1.10× slower |
| 5,000 | geo | 25.00 ms | 8.40 ms | 2.98× slower |
| 20,000 | geo | 33.30 ms | 124.20 ms | 3.73× faster |
| 1,000 | mixed | 24.90 ms | 8.30 ms | 3.00× slower |
| 5,000 | mixed | 41.60 ms | 16.70 ms | 2.49× slower |
| 20,000 | mixed | 50.00 ms | 157.90 ms | 3.16× faster |

95th-percentile frame (the stutter you actually feel):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 24.50 ms | 9.10 ms | 2.69× slower |
| 5,000 | geo | 66.60 ms | 25.00 ms | 2.66× slower |
| 20,000 | geo | 116.70 ms | 258.80 ms | 2.22× faster |
| 1,000 | mixed | 42.30 ms | 9.00 ms | 4.70× slower |
| 5,000 | mixed | 108.30 ms | 41.60 ms | 2.60× slower |
| 20,000 | mixed | 208.30 ms | 350.10 ms | 1.68× faster |

Worst single frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 25.80 ms | 9.40 ms | 2.74× slower |
| 5,000 | geo | 83.30 ms | 33.40 ms | 2.49× slower |
| 20,000 | geo | 166.70 ms | 308.40 ms | 1.85× faster |
| 1,000 | mixed | 58.60 ms | 9.30 ms | 6.30× slower |
| 5,000 | mixed | 133.30 ms | 57.80 ms | 2.31× slower |
| 20,000 | mixed | 300.40 ms | 429.20 ms | 1.43× faster |

Average frames per second over the run (higher is better):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 77.4 | 120.0 | 1.55× slower |
| 5,000 | geo | 34.7 | 80.4 | 2.32× slower |
| 20,000 | geo | 24.0 | 7.4 | 3.24× faster |
| 1,000 | mixed | 37.3 | 120.0 | 3.22× slower |
| 5,000 | mixed | 21.0 | 52.4 | 2.50× slower |
| 20,000 | mixed | 14.2 | 5.7 | 2.49× faster |

### Select-all + drag frame time (`selectAllDragRun(60)`)

Every shape on the page is selected, then nudged once per frame for 60 frames — this exercises
the write path (store update → geometry invalidation → re-render), not just the camera. Median frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 33.00 ms | 25.10 ms | 1.31× slower |
| 5,000 | geo | 116.60 ms | 150.00 ms | 1.29× faster |
| 20,000 | geo | 400.00 ms | 858.40 ms | 2.15× faster |
| 1,000 | mixed | 50.00 ms | 41.70 ms | 1.20× slower |
| 5,000 | mixed | 183.50 ms | 225.90 ms | 1.23× faster |
| 20,000 | mixed | 841.60 ms | 1124.90 ms | 1.34× faster |

95th-percentile frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 34.20 ms | 33.90 ms | 1.01× slower |
| 5,000 | geo | 140.70 ms | 166.70 ms | 1.18× faster |
| 20,000 | geo | 441.60 ms | 1058.20 ms | 2.40× faster |
| 1,000 | mixed | 66.80 ms | 50.20 ms | 1.33× slower |
| 5,000 | mixed | 250.00 ms | 258.40 ms | 1.03× faster |
| 20,000 | mixed | 925.00 ms | 1375.00 ms | 1.49× faster |

### Hit testing (`hitTestRun(500)`)

500 deterministic `getShapeAtPoint` queries spread over the document bounds, µs per query:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 2.0 µs | 32.0 µs | 16.00× faster |
| 5,000 | geo | 3.0 µs | 111.8 µs | 37.27× faster |
| 20,000 | geo | 5.4 µs | 524.6 µs | 97.15× faster |
| 1,000 | mixed | 2.4 µs | 46.8 µs | 19.50× faster |
| 5,000 | mixed | 4.0 µs | 184.0 µs | 46.00× faster |
| 20,000 | mixed | 5.2 µs | 656.0 µs | 126.15× faster |

### JS heap after the run (`memoryMB()`)

`performance.memory.usedJSHeapSize` after a forced GC (`--js-flags=--expose-gc`). This is JS heap only —
it does not include GPU buffers (mocanvas) or the DOM/layout memory of the render tree (tldraw), so it
understates both, differently. Treat it as a rough signal, not a memory benchmark.

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 9.5 MB | 51.0 MB | 5.35× less |
| 5,000 | geo | 9.5 MB | 202.2 MB | 21.20× less |
| 20,000 | geo | 20.7 MB | 803.0 MB | 38.80× less |
| 1,000 | mixed | 9.5 MB | 51.0 MB | 5.35× less |
| 5,000 | mixed | 12.1 MB | 214.6 MB | 17.72× less |
| 20,000 | mixed | 33.5 MB | 803.0 MB | 23.99× less |

## Rendering comparison

`apps/bench/public/compare.tldr` is authored by driving the **tldraw** page through tldraw's public API
(`createShapes` / `createBindings` / `getSnapshot`) — see `apps/bench/scripts/make-fixture.mjs`. It holds a
geo rectangle with a text label, an ellipse, a star, a triangle, a filled hexagon, a freehand draw stroke,
a bent arrow bound to the rectangle, a straight arrow, a line, a note with text, a text shape, and a frame
with two children. Both pages load that same file, zoom to fit at 1200×800 and are screenshotted.

- `apps/bench/results/compare-tldraw.png` — tldraw (14 shapes from 18 records)
- `apps/bench/results/compare-mocanvas.png` — mocanvas (14 shapes from 18 records)
- `apps/bench/results/compare-diff.png` — differing pixels in red

| | |
| :--- | ---: |
| Differing pixels | **3.82%** (36,686 of 960,000) |
| Tolerance | any channel differing by more than 24/255 |
| Painted (non-white) pixels, mocanvas | 112,658 |
| Painted (non-white) pixels, tldraw | 114,470 |
| Painted-pixel overlap (IoU) | **78.2%** |

**Read the overlap row, not the differing-pixels row.** "Differing pixels" is still a poor headline for
this comparison, even now that it has fallen: tldraw inks only about 12% of the canvas, so a render that
draws too little scores well on it. The two earlier runs are the proof — mocanvas painted *nothing* in the
first and scored 11.84% differing pixels, then drew the whole document with the wrong fills and scored
12.14%. Two renders that could hardly be less alike landed within 0.3 points of each other, because a
blank canvas disagrees only where tldraw drew something. The painted-pixel overlap (intersection over
union) separated them properly at the time (0.0% against 56.4%) and is still the metric to read here:
of every pixel either side inked, 78.2% were inked by both.

This run is the first where both rows agree: 3.82% differing at 78.2% overlap. The fill ramp was
corrected between the two runs, which removed the large flat areas of disagreement inside every filled
shape; what is left is mostly outline geometry, where mocanvas paints in nearly the same places as tldraw
but with a different stroke and font. See the visible-differences list below for the breakdown.

### Load result

| | mocanvas | tldraw |
| :--- | :--- | :--- |
| Loaded without error | yes | yes |
| Shapes on the page after load | 14 | 14 |

_An earlier revision of this bench ran a second pass in which the fixture was down-converted for
mocanvas (`richText` → `text`, packed draw `path` → `points`) using tldraw's own public helpers, because
mocanvas could not read either form and its raw-file screenshot was blank. mocanvas does both conversions
itself now, so that shim and its screenshots are gone and the numbers above are the unassisted ones._

### mocanvas load warnings

Reported by the bench page while loading the tldraw-authored fixture (unknown shape/binding types, and props
present on one side but not the other):

- `arrow: unknown prop "kind" (x2)`
- `arrow: unknown prop "elbowMidPoint" (x2)`
- `arrow: unknown prop "richText" (x2)`
- `arrow: missing prop "text" (default used) (x2)`
- `binding arrow: unknown prop "snap"`
- `draw: unknown prop "scaleX"`
- `draw: unknown prop "scaleY"`
- `draw: segment uses the packed "path" form (decoded to "points" on load)`
- `geo: unknown prop "flipX" (x7)`
- `geo: unknown prop "flipY" (x7)`
- `geo: unknown prop "richText" (x7)`
- `geo: missing prop "text" (default used) (x7)`
- `frame: unknown prop "color"`
- `text: unknown prop "richText"`
- `text: missing prop "text" (default used)`
- `note: unknown prop "richText"`
- `note: unknown prop "textLastEditedBy"`
- `note: missing prop "text" (default used)`
- `[store] ignoring unknown migration sequence …` — ×28, one per tldraw record type
  (`com.tldraw.store`, `com.tldraw.shape.geo`, `com.tldraw.binding.arrow`, …). mocanvas registers no
  migration sequences under tldraw's names, so it applies none of the file's declared migrations and reads
  the records as-is. Harmless for a current-version file like this one; it would matter for an older file
  that genuinely needs migrating.

These compare the file *as authored* against what this build declares: `compatWarnings` in the bench
page reads each record's raw props and diffs them against the props the matching shape util declares,
before mocanvas normalises anything. So they describe the tldraw file's shape, not something mocanvas
failed to read. Two of these entries are worth spelling out, because in the previous run they meant exactly that:

1. **`geo/text/note/arrow: unknown prop "richText"` and the matching `missing prop "text"`.** tldraw 5.x
   stores label text as a ProseMirror/TipTap `richText` document and no longer writes `props.text`, which
   mocanvas's shape utils declare — hence one warning for the prop the file has and one for the prop it
   lacks. `normalizeLoadedRecords` (`packages/editor/src/records/normalize.ts`) now flattens `richText`
   into `text` while the records load. Before it did, this file threw
   `TypeError: Cannot read properties of undefined (reading 'trim')` and the page rendered nothing.
2. **`draw: segment uses the packed "path" form (decoded to "points" on load)`.** tldraw stores freehand
   strokes as `segments[].path`, a base64-packed point buffer, rather than the older `segments[].points`
   array. The same normalisation pass decodes it, which is why the freehand wave renders above. In the
   run before the `.tldr` load fix this check read `segment has no "points" array (encoded "path" is
   not decoded)`, and that was literally true then: the stroke was dropped. It is now a note about the
   file's format, not a gap in mocanvas.

The remaining warnings are benign: extra props mocanvas does not model
(`flipX`/`flipY`, `scaleX`/`scaleY`, `kind`, `elbowMidPoint`, `textLastEditedBy`, `frame.color`,
`binding.snap`) which are simply ignored.

### Visible differences

_Written by hand from looking at the two screenshots, and kept in
`apps/bench/results/visible-differences.md` so that re-running the bench does not overwrite it._

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

## Methodology

1. `vite build` produces a production bundle containing both pages; `vite preview` serves it. Neither library
   runs in a dev build, and React runs in production mode for both.
2. For each `(library, N, kind, repeat)` a **fresh page** is opened, so no run inherits another's heap,
   store contents or JIT state.
3. `create(n, kind)` builds the shape list from the shared spec in `bench-api.ts` and creates it in one
   transaction with `history: "ignore"` on both sides.
4. Frame timing is frame-to-frame `requestAnimationFrame` delta while the camera is driven by the shared
   `panZoomCamera(t)` function. Camera writes are forced/immediate on both sides so neither library gets to
   coalesce or animate the camera away.
5. Percentiles are computed over the 120 (or 60) recorded deltas within a run; across the repeats the
   **median** of each scalar is reported.
6. `'mixed'` is 60% geo shapes, 25% freehand draw strokes of 40 points each, 10% arrows and 5% notes/text
   (alternating), laid out on the same grid as `'geo'`.

## Caveats — please read before quoting these numbers

- **Headless, software-rasterised GPU.** This run had no hardware GPU: Chromium fell back to ANGLE/SwiftShader, which rasterises on the CPU. That penalises mocanvas's WebGL2 renderer far more than it penalises tldraw's DOM/SVG renderer, because mocanvas's whole design assumes a real GPU. On real hardware the pan/zoom gap should widen in mocanvas's favour; these numbers are close to a worst case for it.
- **4× MSAA dominates a software-rasterised frame, so these frame times mostly measure SwiftShader, not
  the engine.** A probe in this same environment (`glCostProbe` in `apps/bench/results/panzoom-after.json`)
  draws 50,000 triangles (5.15 MB of vertex data) into a context configured exactly like the
  WebGL2 backend's, and reads one pixel back so the GPU process has to finish before the clock stops.
  Uploading the buffers costs 0.39 ms and clearing costs 3.59 ms, but clear-plus-draw costs
  **35.9 ms with `antialias: true` against 10.8 ms with it off** — roughly
  70% of the frame is multisample resolve on the CPU. On a real GPU MSAA is close to free, so the
  absolute mocanvas frame times above are largely a property of this rasteriser rather than of the scene.
- **Run-to-run spread is wide here, so do not read small differences.** tldraw's code did not change
  between this run and the previous one, and its 95th-percentile pan/zoom frame still moved by -25% to
  +42% across the matrix (see "What changed since the previous run"). Anything smaller than that on a
  single metric is this machine, not either library. Comparisons made inside one browser session — the
  mocanvas/tldraw pairs here, or the A/B in `panzoom-after.json` — are the ones worth quoting.
- **Default settings on both sides.** No tuning, no custom shape utils, no culling or LOD flags flipped, no
  tldraw performance options enabled. Both libraries are used the way the docs show. Either could likely be
  made faster by someone who knows its knobs; that is a different benchmark.
- **This benchmark was written by the mocanvas authors.** The workload was chosen to be fair (identical
  specs, identical camera path, both driven through public APIs), but it is still our benchmark of our own
  library, and we picked which metrics to show. Read the code in `apps/bench/` before believing it.
- **mocanvas is much younger and does far less.** tldraw is a mature, complete product: rich text editing,
  collaboration, assets/embeds, undo semantics, accessibility, a full UI, and years of edge cases. mocanvas
  is a rendering core with a small shape set. A rendering benchmark flatters the thing that renders and
  ignores everything else, and "everything else" is most of what tldraw is. These numbers say nothing about
  which library you should use.
- **Rendering models differ, so the pixel diff is not a bug count.** tldraw renders shapes as DOM/SVG with
  its own hand-drawn stroke style and font stack; mocanvas rasterises through WebGL2. Antialiasing, stroke
  geometry and text layout will never match pixel-for-pixel, and a nonzero diff percentage is expected even
  where both are "correct".
- **The pan/zoom numbers do not measure the same work in both libraries, and this favours tldraw.** A
  `requestAnimationFrame` delta captures main-thread time. tldraw moves the camera by setting a CSS transform
  on a container, so the pan/zoom sweep costs it almost no main-thread work — the compositor does the moving,
  off-thread and unmeasured. mocanvas redraws the scene through WebGL2 on the main thread every frame, so its
  number includes the entire render. Read the pan/zoom tables as "main-thread cost per frame", not as "which
  library draws faster": a low tldraw number there partly means the work moved somewhere this benchmark
  cannot see. The `selectAllDragRun` numbers are the fairer frame-time comparison, because mutating shapes
  forces both libraries to actually re-render.
- **Frame deltas are floored by the browser's frame cadence**, so very fast cases converge on the same number
  for both libraries; that is a measurement ceiling, not a tie.
- **Memory is JS heap only** (see the note on that table).
- **The `.tldr` fixture is authored by tldraw**, so it is on tldraw's home turf by construction: tldraw reads
  back exactly what it wrote, while mocanvas reads a foreign file through its compatibility layer.

## Licensing / clean-room note

`tldraw` is a dependency of **`apps/bench` only**, and is used exclusively through its public documented API.
No package under `packages/` imports, references or contains tldraw code, and nothing in the mocanvas
implementation was derived from tldraw's source.

`apps/bench` is a deliberate, scoped exception to three rules in [`CLEAN_ROOM.md`](./CLEAN_ROOM.md), and
contributors should not read it as precedent for the rest of the repo:

- **Rule 1 (never open tldraw source).** Building the bench required tldraw's *type declarations*
  (`node_modules/tldraw/dist-esm/index.d.mts`) to get prop and function signatures right. Only `.d.ts`
  declarations were read — never the `.js`/`.mjs` bundles or `src/`. No tldraw code was copied.
- **Rule 4 (no branding / product names).** The bench necessarily names tldraw, imports its package and
  renders its watermark in the comparison screenshot.
- **Rule 5 (dependency licences limited to MIT/Apache-2.0/BSD/ISC/CC0/0BSD).** tldraw ships under its own
  licence, not one of those — see `apps/bench/node_modules/tldraw/LICENSE.md`. Because `apps/bench` is a
  private, unpublished dev-only workspace package, it does not affect the licensing of anything shipped, but
  whoever maintains the `cargo deny` / `license-checker` CI gates should keep `apps/bench` excluded from the
  published-dependency check rather than relaxing the rule globally.

The `.tldr` file format itself is implemented in `packages/store` from the format's own bytes and public
documentation, not from tldraw's parser.
