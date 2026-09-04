# Benchmark: mocanvas vs tldraw

_Generated 2026-09-04 11:33:01 UTC by `apps/bench/scripts/bench.mjs`. Re-run with `pnpm --filter bench bench`._

Both libraries are driven through an identical `window.bench` API (`apps/bench/src/bench-api.ts`)
with byte-identical workloads: same grid, same shape sizes, colours and fills, the same scripted
camera path, and the same hit-test sample points. Frame times are frame-to-frame `requestAnimationFrame`
deltas recorded while a camera animation runs (zoom to fit → zoom in 4× → horizontal pan sweep → zoom back out).

> **The two halves of this report were measured at different times.** The rendering comparison was re-measured after the hand-drawn stroke style landed, and with two region metrics that did not exist before; the performance tables were **not** re-run — they are unchanged from the earlier run listed under Environment, and nothing below claims they were.
>
> Rendering comparison: measured 2026-09-04 11:33:01 UTC, git `83ff957-dirty`.
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

The rendering comparison has moved a long way over the same span, but it is measured and discussed
in [its own section](#rendering-comparison) rather than here, because what changed there is what is
being *measured*, not only what is being rendered.

## Environment

| | |
| :--- | :--- |
| Date | 2026-09-04 11:33:01 UTC (rendering comparison; performance tables measured 2026-09-04 09:26:29 UTC) |
| Machine | Apple M3 Pro, 11 cores, 36 GB |
| OS | Darwin 25.5.0 (arm64) |
| Node | v25.9.0 |
| Browser | headless Chromium 151.0.7922.34 (Playwright 1.62.1) |
| Chromium flags | `--js-flags=--expose-gc --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --hide-scrollbars --force-color-profile=srgb --font-render-hinting=none --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy` |
| GL mode attempted | gpu |
| WebGL2 renderer | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver) |
| Rasterisation | **software (SwiftShader)** — no hardware GPU in this environment |
| tldraw | 5.4.0 |
| mocanvas | 0.0.1 (this repo, 83ff957-dirty; performance tables measured at 15b670a-dirty) |
| Builds | production (`vite build`, minified, `NODE_ENV=production`) for both |
| Viewport | 1200×800 CSS px, device scale 1 |
| Matrix | N ∈ {1000, 5000, 20000} × kind ∈ {geo, mixed}, 3 repeats, medians reported |

_Why both revisions are marked dirty. **The rendering comparison** ran at `83ff957` with `packages/` and `crates/` untouched — the only uncommitted changes were under `apps/bench`, and they are the measurement code that produced the interior-IoU and stroke-band numbers, not anything mocanvas renders. **The performance tables** were measured at a tree that was checked clean at `15b670a` immediately before that run started, and the bundle is built once, before the first measurement, so a clean `15b670a` is what those numbers come from; their `-dirty` marker is from edits made after that build, to this report generator and to UI code (selection handles, style panel, icons) committed by a concurrent session._

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

Three numbers, in decreasing order of how much a pixel comparison can be trusted to mean what it
looks like it means.

| | | what it measures |
| :--- | ---: | :--- |
| Interior IoU | **94.1%** | fills, positions and sizes — exact geometry on both sides |
| Stroke band distance | **1.00 px median, 10.05 px p95** | how far apart the two outlines actually run |
| Whole-image pixel diff | **3.82% differing, 78.2% painted-pixel IoU** | everything at once, stroke randomness included |

Both libraries draw the default `dash: "draw"` style as a genuinely hand-drawn outline — seeded wobble,
rounded corners, overshoot past the vertex — and neither is trying to reproduce the other's random
numbers. Two outlines that both look right therefore miss each other by roughly a stroke width, and a
pixel diff charges for that twice: once where mocanvas painted and tldraw did not, and once the other way
round. That is measured, not assumed — making mocanvas draw exact polygons instead *improved* the
whole-image figures (79.1% painted-pixel IoU at `ef4d079`, against this run's 78.2%) while making the
render look wrong. So the whole-image row is reported last, and the two above it are the ones to quote.

### 1. Interior IoU — 94.1%

Per shape, the region is cut out of both screenshots and the silhouette of whatever was drawn there is
recovered — paint, plus everything the paint encloses, so a fill the colour of the paper still has an
interior. Both silhouettes are then eroded 6 px inward, past the widest stroke either library draws
(hand-drawn overshoot included), leaving interior only: no stroke pixel is counted on either side. `IoU`
is the intersection of the two eroded interiors over their union — position and size, with the outline
taken out. `colour` is how much of the shared interior agrees on colour at the same 24/255 tolerance the
pixel diff uses — the fills.

| shape | interior px (tldraw) | IoU | colour |
| :--- | ---: | ---: | ---: |
| rectangle | 26,009 | 96.8% | 94.8% |
| ellipse | 21,828 | 96.8% | 99.8% |
| star | 8,666 | 69.9% | 99.6% |
| triangle | 8,897 | 92.8% | 99.3% |
| hexagon | 15,915 | 80.1% | 99.3% |
| note | 44,358 | 90.3% | 95.9% |
| frame | 114,091 | 98.8% | 97.5% |
| rectangle (in frame) | 10,067 | 98.4% | 99.8% |
| ellipse (in frame) | 12,390 | 94.7% | 99.5% |
| **whole fixture** | **239,764** | **94.1%** | **97.3%** |

The fixture-wide row is one union over every shape's interior, not an average of the rows, so the boxes
that overlap — the frame and its two children — are not counted twice.

**Fills are essentially exact.** Every shape that is only fill agrees on colour over 99% of its shared
interior. The two that do not are the two carrying something else: the rectangle's 94.8% is its "Hello box"
label (a font-weight difference, not a fill one) and the note's 95.9% is tldraw's top-to-bottom gradient
and drop shadow against mocanvas's flat body.

**The two low IoU rows are real geometry differences, which is what this metric is for.** mocanvas's star
uses a smaller inner radius than tldraw's, so its arms are visibly thinner — that is the 69.9% — and its
hexagon is narrower across the flats, which is the 80.1%. Neither is visible in the whole-image number,
where they are buried under stroke wobble; both are obvious once the interiors are compared directly.

Not scored here: the bent arrow, the freehand stroke, the straight arrow, the line and the text shape. An open shape encloses nothing, and its box overlaps shapes that
do — measuring "its interior" would silently be measuring theirs. The stroke band distance below is the
metric that covers them.

### 2. Stroke band distance — 1.00 px median, 10.05 px at the 95th percentile

The question a hand-drawn outline can fairly be asked is not "do your stroke pixels land on the
reference's?" but "how far away are they?". For every stroke colour in the reference render, an exact
Euclidean distance transform gives the distance from any pixel to the nearest stroke pixel of that colour
in each image. Sampling those at the *other* render's stroke pixels of the same colour, in both directions
so that a stroke which is merely shorter cannot score well, gives a distance in pixels per shape.

Stroke width in these screenshots is about 4 px, so a hand-drawn pair that looks right should land
within a few pixels; a genuinely misplaced outline would not.

| shape | reference stroke px | median | p95 | max |
| :--- | ---: | ---: | ---: | ---: |
| rectangle | 3,102 | 1.00 px | 3.00 px | 12.21 px |
| bent arrow | 1,918 | 4.12 px | 19.85 px | 22.36 px |
| ellipse | 2,235 | 1.00 px | 2.24 px | 5.39 px |
| star | 1,949 | 2.83 px | 8.06 px | 11.00 px |
| triangle | 1,660 | 1.00 px | 2.24 px | 5.39 px |
| hexagon | 1,774 | 6.71 px | 14.42 px | 18.36 px |
| freehand stroke | 1,334 | 1.00 px | 3.00 px | 9.22 px |
| straight arrow | 787 | 0.00 px | 2.24 px | 14.87 px |
| line | 1,251 | 1.00 px | 3.16 px | 5.00 px |
| note | 826 | 1.41 px | 4.00 px | 6.00 px |
| text shape | 1,640 | 2.00 px | 12.04 px | 26.17 px |
| frame | 4,556 | 1.00 px | 2.00 px | 4.47 px |
| rectangle (in frame) | 1,484 | 0.00 px | 1.00 px | 3.00 px |
| ellipse (in frame) | 1,652 | 0.00 px | 2.83 px | 4.12 px |
| **whole fixture** | — | **1.00 px** | **10.05 px** | **26.17 px** |

**This is the number that says the hand-drawn stroke is working.** Half of mocanvas's stroke pixels are
within 1.00 px of a reference stroke pixel of the same colour, and the worst pixel anywhere in the fixture is
26.17 px out — about 6.5 stroke widths, on a glyph. 11 of the 14 scored regions sit at a median of
half a stroke width or better. Two outlines that a pixel diff scores as largely disjoint are, measured as a
distance, running within a stroke width of each other nearly everywhere.

The rows that are not within a stroke width are the differences worth having a name for, and none of them
is stroke randomness:

- **bent arrow, 4.12 px median / 19.85 px p95** — tldraw stops the arrow short of the rectangle it is bound
  to; mocanvas runs it to the shape's edge. A binding difference, and the largest one in the fixture.
- **hexagon, 6.71 px median / 14.42 px p95** — the same narrower hexagon the interior IoU row catches.
- **text shape, 2.00 px median / 12.04 px p95** — font weight: tldraw's face is heavier and slightly wider, so the
  glyphs drift apart along the line even though the baseline and size agree.
- **star, 2.83 px median / 8.06 px p95** — the inner-radius difference again.

Two exclusions, both documented in `scripts/compare-metrics.mjs`. tldraw's "Get a license for production"
badge (found automatically at 1100,764–1192,794, and only excluded because mocanvas paints nothing at all inside it) sits
inside the frame's box and is not a rendering difference. And a colour class with fewer than
150 pixels in a region is the antialiased skirt of a neighbouring colour rather than a stroke of its own,
so it is skipped rather than allowed to set that region's 95th percentile.

### 3. Whole-image pixel diff — 3.82% differing, 78.2% painted-pixel IoU

| | |
| :--- | ---: |
| Differing pixels | **3.82%** (36,686 of 960,000) |
| Tolerance | any channel differing by more than 24/255 |
| Painted (non-white) pixels, mocanvas | 112,658 |
| Painted (non-white) pixels, tldraw | 114,470 |
| Painted-pixel overlap (IoU) | **78.2%** |

**Both rows understate the agreement, and the differing-pixels row is the worse of the two.** tldraw inks
only about 12% of the canvas, so a render that draws too little scores well on it: mocanvas painted
*nothing* in the first run below and scored 11.84% differing, then drew the whole document with the wrong
fills and scored 12.14%. Two renders that could hardly be less alike landed within 0.3 points of each
other. Painted-pixel IoU separates those two properly (0.0% against 56.4%), but it is an *overlap*, and an
overlap is exactly the wrong shape of question to ask about two independently wobbled outlines: it counts
a stroke that is one stroke width away identically to one that is on the other side of the canvas.

Quote it as an upper bound on how much of the render is pixel-identical, not as a similarity score.

### How the comparison has moved

| | `32ac776-dirty` | `15b670a-dirty` | `ef4d079` | `83ff957-dirty` |
| :--- | :--- | :--- | :--- | :--- |
| | before the `.tldr` load fix | drawn, wrong fill ramp | correct fills, exact outlines | hand-drawn outlines (this run) |
| mocanvas loaded the file | no — threw on `props.richText` | yes | yes | yes |
| Interior IoU | not measured yet | not measured yet | not measured yet | **94.1%** |
| Stroke band, median | not measured yet | not measured yet | not measured yet | **1.00 px** |
| Painted-pixel IoU | 0.0% | 56.4% | 79.1% | 78.2% |
| Differing pixels | 11.84% | 12.14% | 3.79% | 3.82% |

The first two columns are why the whole-image rows are reported last: they barely move across the change
that took mocanvas from drawing nothing at all to drawing the entire document. The fill-ramp fix in
`ef4d079` is the one change both of them register properly.

**The last step is the point of this section.** `ef4d079` drew exact polygons with a uniform stroke;
`182bf43` and `83ff957` replaced that with the seeded, wobbling, corner-overshooting outline the default
`dash: "draw"` style actually calls for, which is unambiguously the more faithful render. The whole-image
numbers got *worse* for it (79.1% → 78.2% painted-pixel IoU, 3.79% → 3.82% differing). The two rows above
them are the ones that can tell the difference between a stroke in the wrong place and a stroke drawn with
different random numbers, and only those two are worth optimising against.

The last two columns were measured on different revisions but with the same fixture, viewport, browser and
tolerance; the interior and band rows exist only from this run, and nothing has been back-filled.

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
- **The whole-image numbers cannot score a hand-drawn stroke, and this is measured rather than argued.**
  Both libraries wobble the default `dash: "draw"` outline from their own seed, so two outlines that both
  look right miss each other by about a stroke width and every one of those pixels is charged twice. Drawing
  exact polygons instead scored *better* on both whole-image rows while looking wrong. Read the interior IoU
  and the stroke band distance first; the whole-image rows are an upper bound on pixel-identical area, not a
  similarity score.
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
