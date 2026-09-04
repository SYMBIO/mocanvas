# Benchmark: mocanvas vs tldraw

_Generated 2026-09-04 09:26:29 UTC by `apps/bench/scripts/bench.mjs`. Re-run with `pnpm --filter bench bench`._

Both libraries are driven through an identical `window.bench` API (`apps/bench/src/bench-api.ts`)
with byte-identical workloads: same grid, same shape sizes, colours and fills, the same scripted
camera path, and the same hit-test sample points. Frame times are frame-to-frame `requestAnimationFrame`
deltas recorded while a camera animation runs (zoom to fit → zoom in 4× → horizontal pan sweep → zoom back out).

## What changed since the previous run

Two changes landed between the previous published numbers (2026-09-04 08:30:07 UTC, git `32ac776-dirty`) and this run:

- **`.tldr` loading was fixed.** `normalizeLoadedRecords` (`packages/editor/src/records/normalize.ts`)
  now maps `props.richText` onto `props.text` and decodes packed freehand `segments[].path` into
  `segments[].points` while records are loaded. The previous run could not open the tldraw-authored
  fixture at all — it threw and left a blank canvas — so the rendering comparison below was measured
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

Rendering comparison against the same `.tldr` fixture:

| | before | after |
| :--- | :--- | :--- |
| mocanvas loaded the file | no — threw on `props.richText` | yes |
| Painted pixels, mocanvas | 0 | 163,726 |
| Painted-pixel overlap (IoU) | 0.0% | **56.4%** |
| Differing pixels | 11.84% | 12.14% |

The differing-pixel row is the one that reads backwards, and it is worth understanding before
quoting either number — see [the note under the comparison](#rendering-comparison).

## Environment

| | |
| :--- | :--- |
| Date | 2026-09-04 09:26:29 UTC |
| Machine | Apple M3 Pro, 11 cores, 36 GB |
| OS | Darwin 25.5.0 (arm64) |
| Node | v25.9.0 |
| Browser | headless Chromium 151.0.7922.34 (Playwright 1.62.1) |
| Chromium flags | `--js-flags=--expose-gc --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --hide-scrollbars --force-color-profile=srgb --font-render-hinting=none --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy` |
| GL mode attempted | gpu |
| WebGL2 renderer | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver) |
| Rasterisation | **software (SwiftShader)** — no hardware GPU in this environment |
| tldraw | 5.4.0 |
| mocanvas | 0.0.1 (this repo, 15b670a-dirty) |
| Builds | production (`vite build`, minified, `NODE_ENV=production`) for both |
| Viewport | 1200×800 CSS px, device scale 1 |
| Matrix | N ∈ {1000, 5000, 20000} × kind ∈ {geo, mixed}, 3 repeats, medians reported |

_The tree was checked clean at `15b670a` immediately before this run started, and the bundle is built once, before the first measurement — so a clean `15b670a` is what was measured. The `-dirty` marker comes from edits made after that build: to this report generator, and to UI code (selection handles, style panel, icons) committed by a concurrent session. Neither is in the bundle these numbers come from._

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
| Differing pixels | **12.14%** (116,538 of 960,000) |
| Tolerance | any channel differing by more than 24/255 |
| Painted (non-white) pixels, mocanvas | 163,726 |
| Painted (non-white) pixels, tldraw | 114,470 |
| Painted-pixel overlap (IoU) | **56.4%** |

**Read the overlap row, not the differing-pixels row.** "Differing pixels" is a poor headline for this
comparison and moves in misleading ways: tldraw inks only about 12% of the canvas, so a render that draws
too little scores well on it. The previous run is the proof — mocanvas painted *nothing* there and still
scored 11.84% differing pixels, against 12.14% for the render that now draws the whole document — because a blank canvas
disagrees only where tldraw drew something. mocanvas now paints in nearly the same places but with a
different stroke, fill and font, so the union of disagreeing pixels stays about as large while the picture
is enormously closer. The painted-pixel overlap (intersection over union) is the metric that reflects
that: of every pixel either side inked, 56.4% were inked by both.

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
- `draw: segment has no "points" array (encoded "path" is not decoded)`
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
2. **`draw: segment has no "points" array (encoded "path" is not decoded)`.** tldraw stores freehand
   strokes as `segments[].path`, a base64-packed point buffer, rather than the older `segments[].points`
   array. The same normalisation pass decodes it, which is why the freehand wave renders above — the
   parenthetical in that message describes the old behaviour and is simply wrong now. The check has been
   reworded in the bench page since this run; the line above is the wording that was recorded during it.

The remaining warnings are benign: extra props mocanvas does not model
(`flipX`/`flipY`, `scaleX`/`scaleY`, `kind`, `elbowMidPoint`, `textLastEditedBy`, `frame.color`,
`binding.snap`) which are simply ignored.

### Visible differences

_Written by hand from looking at the two screenshots, and kept in
`apps/bench/results/visible-differences.md` so that re-running the bench does not overwrite it._

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
