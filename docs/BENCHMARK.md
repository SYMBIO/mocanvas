# Benchmark: mocanvas vs tldraw

_Generated 2026-09-04 08:30:07 UTC by `apps/bench/scripts/bench.mjs`. Re-run with `pnpm --filter bench bench`._

Both libraries are driven through an identical `window.bench` API (`apps/bench/src/bench-api.ts`)
with byte-identical workloads: same grid, same shape sizes, colours and fills, the same scripted
camera path, and the same hit-test sample points. Frame times are frame-to-frame `requestAnimationFrame`
deltas recorded while a camera animation runs (zoom to fit → zoom in 4× → horizontal pan sweep → zoom back out).

## Environment

| | |
| :--- | :--- |
| Date | 2026-09-04 08:30:07 UTC |
| Machine | Apple M3 Pro, 11 cores, 36 GB |
| OS | Darwin 25.5.0 (arm64) |
| Node | v25.9.0 |
| Browser | headless Chromium 151.0.7922.34 (Playwright 1.62.1) |
| Chromium flags | `--js-flags=--expose-gc --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --hide-scrollbars --force-color-profile=srgb --font-render-hinting=none --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy` |
| GL mode attempted | gpu |
| WebGL2 renderer | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver) |
| Rasterisation | **software (SwiftShader)** — no hardware GPU in this environment |
| tldraw | 5.4.0 |
| mocanvas | 0.0.1 (this repo, 32ac776-dirty (uncommitted work in packages/ during the run)) |
| Builds | production (`vite build`, minified, `NODE_ENV=production`) for both |
| Viewport | 1200×800 CSS px, device scale 1 |
| Matrix | N ∈ {1000, 5000, 20000} × kind ∈ {geo, mixed}, 3 repeats, medians reported |

## Results

Every cell is the median of the repeats. `ratio` compares the two: “2.00× faster” means mocanvas took half the time tldraw did.

### Shape creation (`create(n, kind)`)

Wall time of the single `createShapes` call, inside one transaction with history disabled.

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 13 ms | 39 ms | 2.97× faster |
| 5,000 | geo | 39 ms | 142 ms | 3.61× faster |
| 20,000 | geo | 138 ms | 499 ms | 3.61× faster |
| 1,000 | mixed | 21 ms | 63 ms | 2.95× faster |
| 5,000 | mixed | 59 ms | 210 ms | 3.59× faster |
| 20,000 | mixed | 217 ms | 604 ms | 2.78× faster |

Time from the start of that call until the second animation frame afterwards (creation + first paint):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 104 ms | 133 ms | 1.27× faster |
| 5,000 | geo | 216 ms | 540 ms | 2.50× faster |
| 20,000 | geo | 501 ms | 2482 ms | 4.96× faster |
| 1,000 | mixed | 110 ms | 163 ms | 1.48× faster |
| 5,000 | mixed | 273 ms | 683 ms | 2.50× faster |
| 20,000 | mixed | 737 ms | 2478 ms | 3.36× faster |

### Pan / zoom frame time (`panZoomRun(120)`)

120 frames of the scripted camera animation. Median frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 16.70 ms | 8.30 ms | 2.01× slower |
| 5,000 | geo | 25.10 ms | 8.80 ms | 2.85× slower |
| 20,000 | geo | 41.60 ms | 133.40 ms | 3.21× faster |
| 1,000 | mixed | 16.70 ms | 8.30 ms | 2.01× slower |
| 5,000 | mixed | 33.20 ms | 16.60 ms | 2.00× slower |
| 20,000 | mixed | 50.10 ms | 124.90 ms | 2.49× faster |

95th-percentile frame (the stutter you actually feel):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 41.60 ms | 9.00 ms | 4.62× slower |
| 5,000 | geo | 84.20 ms | 33.30 ms | 2.53× slower |
| 20,000 | geo | 193.10 ms | 291.20 ms | 1.51× faster |
| 1,000 | mixed | 33.30 ms | 9.20 ms | 3.62× slower |
| 5,000 | mixed | 107.60 ms | 33.40 ms | 3.22× slower |
| 20,000 | mixed | 266.10 ms | 283.30 ms | 1.06× faster |

Worst single frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 75.20 ms | 9.30 ms | 8.09× slower |
| 5,000 | geo | 241.70 ms | 42.50 ms | 5.69× slower |
| 20,000 | geo | 250.10 ms | 358.40 ms | 1.43× faster |
| 1,000 | mixed | 41.90 ms | 9.30 ms | 4.51× slower |
| 5,000 | mixed | 116.70 ms | 50.20 ms | 2.32× slower |
| 20,000 | mixed | 424.90 ms | 358.20 ms | 1.19× slower |

Average frames per second over the run (higher is better):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 50.5 | 120.0 | 2.37× slower |
| 5,000 | geo | 24.6 | 66.7 | 2.71× slower |
| 20,000 | geo | 15.4 | 6.7 | 2.30× faster |
| 1,000 | mixed | 57.1 | 120.0 | 2.10× slower |
| 5,000 | mixed | 23.0 | 60.3 | 2.62× slower |
| 20,000 | mixed | 11.7 | 7.2 | 1.62× faster |

### Select-all + drag frame time (`selectAllDragRun(60)`)

Every shape on the page is selected, then nudged once per frame for 60 frames — this exercises
the write path (store update → geometry invalidation → re-render), not just the camera. Median frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 33.30 ms | 33.40 ms | 1.00× faster |
| 5,000 | geo | 125.10 ms | 191.40 ms | 1.53× faster |
| 20,000 | geo | 441.60 ms | 983.20 ms | 2.23× faster |
| 1,000 | mixed | 41.60 ms | 33.40 ms | 1.25× slower |
| 5,000 | mixed | 158.40 ms | 200.00 ms | 1.26× faster |
| 20,000 | mixed | 750.30 ms | 816.70 ms | 1.09× faster |

95th-percentile frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 41.70 ms | 41.80 ms | 1.00× faster |
| 5,000 | geo | 174.50 ms | 216.80 ms | 1.24× faster |
| 20,000 | geo | 532.50 ms | 1225.00 ms | 2.30× faster |
| 1,000 | mixed | 49.90 ms | 42.00 ms | 1.19× slower |
| 5,000 | mixed | 183.10 ms | 217.20 ms | 1.19× faster |
| 20,000 | mixed | 900.20 ms | 966.70 ms | 1.07× faster |

### Hit testing (`hitTestRun(500)`)

500 deterministic `getShapeAtPoint` queries spread over the document bounds, µs per query:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 2.6 µs | 34.8 µs | 13.38× faster |
| 5,000 | geo | 3.4 µs | 128.6 µs | 37.82× faster |
| 20,000 | geo | 6.6 µs | 544.4 µs | 82.48× faster |
| 1,000 | mixed | 2.2 µs | 51.8 µs | 23.55× faster |
| 5,000 | mixed | 4.0 µs | 169.4 µs | 42.35× faster |
| 20,000 | mixed | 5.4 µs | 506.0 µs | 93.70× faster |

### JS heap after the run (`memoryMB()`)

`performance.memory.usedJSHeapSize` after a forced GC (`--js-flags=--expose-gc`). This is JS heap only —
it does not include GPU buffers (mocanvas) or the DOM/layout memory of the render tree (tldraw), so it
understates both, differently. Treat it as a rough signal, not a memory benchmark.

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 9.5 MB | 51.0 MB | 5.35× less |
| 5,000 | geo | 9.5 MB | 214.6 MB | 22.50× less |
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
| Differing pixels | **11.84%** (113,685 of 960,000) |
| Tolerance | any channel differing by more than 24/255 |
| Painted (non-white) pixels, mocanvas | 0 |
| Painted (non-white) pixels, tldraw | 114,470 |
| Painted-pixel overlap (IoU) | 0.0% |

### Load result

| | mocanvas | tldraw |
| :--- | :--- | :--- |
| Loaded without error | no — TypeError: Cannot read properties of undefined (reading 'trim') | yes |
| Shapes on the page after load | 14 | 14 |

### Second pass: with the two known format gaps shimmed

The raw comparison above is dominated by two `.tldr` format features mocanvas does not yet read
(see the warnings below). To also show how close the *rendering* gets, the bench down-converts the same
document — `props.richText` → `props.text`, encoded draw `segments[].path` → `segments[].points` — using
tldraw's own public helpers (`renderPlaintextFromRichText`, `getPointsFromDrawSegment`), and loads that
into mocanvas. tldraw still renders the untouched original. This shim lives in the bench app only; it is
**not** part of mocanvas, and the number below is what mocanvas *could* look like, not what it does today.

- `apps/bench/results/compare-mocanvas-shimmed.png`, diff `compare-diff-shimmed.png`

| | raw file | down-converted |
| :--- | ---: | ---: |
| mocanvas loaded without error | no | yes |
| Differing pixels vs tldraw | 11.84% | **12.10%** |
| Painted pixels, mocanvas | 0 | 163,726 |
| Painted-pixel overlap (IoU) | 0.0% | 56.4% |

**Read the overlap row, not the differing-pixels row.** "Differing pixels" is a poor headline here and can
move the wrong way: tldraw only paints about 12% of this canvas, so a *blank* mocanvas render already scores
a deceptively low differing-pixel percentage — it disagrees only where tldraw drew something. Once mocanvas
actually draws, it paints in nearly the same places but with different stroke, fill and font, so the union of
disagreeing pixels can get slightly *larger* even though the picture is enormously closer. The painted-pixel
overlap (intersection over union) is the metric that reflects that: it goes from 0% (nothing drawn) to
56.4% (shapes in the right places, drawn differently).

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

Two of these are not cosmetic — they are why the raw-file screenshot above is blank:

1. **`richText` is not read.** tldraw 5.x stores label text as a ProseMirror/TipTap `richText` document and
   no longer writes `props.text`. mocanvas's `GeoShapeUtil`, `TextShapeUtil` and `ArrowShapeUtil` read
   `shape.props.text` unconditionally, so loading a current tldraw file throws
   `TypeError: Cannot read properties of undefined (reading 'trim')` and the page renders nothing.
   Note that `docs/COMPAT.md` already claims *"phase 1 uses `richText` if present, else `text`"* — that is
   not what the code does today, so either the docs or the shape utils need to catch up.
2. **Encoded draw segments are not decoded.** tldraw stores freehand strokes as `segments[].path`, a
   base64-packed point buffer, rather than the older `segments[].points` array that mocanvas expects, so
   draw shapes carry no geometry.

The remaining warnings are benign: extra props mocanvas does not model
(`flipX`/`flipY`, `scaleX`/`scaleY`, `kind`, `elbowMidPoint`, `textLastEditedBy`, `frame.color`,
`binding.snap`) which are simply ignored.

### Visible differences

_Written by hand from looking at the two screenshots, and kept in
`apps/bench/results/visible-differences.md` so that re-running the bench does not overwrite it._

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
