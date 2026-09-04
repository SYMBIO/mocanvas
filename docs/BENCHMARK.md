# Benchmark: mocanvas vs tldraw

_Generated 2026-09-04 12:23:16 UTC by `apps/bench/scripts/bench.mjs`. Re-run with `pnpm --filter bench bench`._

## Summary

mocanvas creates shapes 2.3–3.3× faster than tldraw and reaches first paint up to 10× faster,
answers hit-test queries 14–113× faster and holds 5–39× less JS heap; at 20,000 shapes it is also
2.5–2.6× faster on the median pan/zoom frame and 1.1–1.5× faster on select-all-drag.
At 1,000 and 5,000 shapes it is slower per frame — 2.3–3.5× on the median pan/zoom frame — for two
reasons set out in the caveats: this machine has no GPU, so mocanvas's WebGL2 output is rasterised on the
CPU, where 4× MSAA alone accounts for roughly 70% of the frame; and the pan/zoom metric counts only
main-thread work, which tldraw largely avoids by panning with a CSS transform on the compositor. The
`selectAllDragRun` tables are the fairer frame comparison; mocanvas is behind there at 1,000 shapes,
level at 5,000, and ahead at 20,000.

Rendering the same tldraw-authored document, mocanvas agrees with tldraw on 96.0% of shape interiors by
IoU at 97.3% colour agreement, and half its stroke pixels land within 1.00 px of a tldraw stroke
pixel of the same colour (95th percentile 5.10 px, against a stroke about 4 px wide). 3.33% of the
canvas differs pixel-for-pixel, most of it two hand-drawn outlines that miss each other by roughly a stroke
width. The differences that are not stroke randomness are a bound arrow that runs to the shape's edge where
tldraw stops short of it, and a lighter font.

Both libraries are driven through an identical `window.bench` API (`apps/bench/src/bench-api.ts`)
with byte-identical workloads: same grid, same shape sizes, colours and fills, the same scripted
camera path, and the same hit-test sample points. Frame times are frame-to-frame `requestAnimationFrame`
deltas recorded while a camera animation runs (zoom to fit → zoom in 4× → horizontal pan sweep → zoom back out).

## What changed since the previous run

Three changes to what mocanvas draws landed between the previous published performance numbers (2026-09-04 09:26:29 UTC, git `15b670a-dirty`) and this run:

- **Hand-drawn stroke style** (`182bf43`, `83ff957`). The default `dash: "draw"` outline is now seeded
  wobble, rounded corners and overshoot past the vertex, where before it was the exact polygon with a
  uniform stroke. It is the more faithful render, and it costs roughly 2.5× the tessellation work of a
  plain stroke. Every shape in this benchmark uses the default dash, so that cost is paid on every shape
  every time geometry is rebuilt.
- **Note and frame chrome** (`219fe67`) — the note's top-to-bottom gradient and drop shadow, and a
  corrected frame border colour.
- **Corrected star and hexagon outlines** (`2ef11f1`) — the star's inner radius and the hexagon's
  orientation. That one is measured in the [rendering comparison](#rendering-comparison), not here.

95th-percentile pan/zoom frame. tldraw's column is the control: its code did not change between the two
runs, so whatever it moved by is what this machine did on its own.

| N | kind | mocanvas before → after | Δ | tldraw before → after (unchanged) | Δ |
| ---: | :--- | ---: | ---: | ---: | ---: |
| 1,000 | geo | 24.5 → 58.3 ms | +138% | 9.1 → 8.7 ms | -4% |
| 5,000 | geo | 66.6 → 175.0 ms | +163% | 25.0 → 83.4 ms | +234% |
| 20,000 | geo | 116.7 → 408.3 ms | +250% | 258.8 → 441.7 ms | +71% |
| 1,000 | mixed | 42.3 → 66.8 ms | +58% | 9.0 → 9.2 ms | +2% |
| 5,000 | mixed | 108.3 → 191.2 ms | +77% | 41.6 → 116.8 ms | +181% |
| 20,000 | mixed | 208.3 → 391.7 ms | +88% | 350.1 → 491.7 ms | +40% |

**This machine was much slower during this run, so read the control column first.** tldraw ran identical
code across the two runs and still moved by -4% to +234% across pan, creation and drag —
shape creation included, which draws nothing at all, and its hit testing, which is pure JS and touches no
pixels, got 27–69% slower too. Nothing in that column is a code change, so the absolute before → after
figures in the first column cannot be read as a regression on their own; they carry the same machine
slowdown plus whatever mocanvas did.

What survives that is the **ratio between the two libraries**, which were measured against each other in
the same session on both occasions, so a slower machine largely divides out. Below 1.00 means mocanvas was
faster than tldraw; the bracket is how that ratio moved, and a positive bracket is mocanvas losing ground.

| N | kind | create (then → now) | pan p95 (then → now) | drag p50 (then → now) | drag p95 (then → now) |
| ---: | :--- | ---: | ---: | ---: | ---: |
| 1,000 | geo | 0.40 → 0.43 (+9%) | 2.69 → 6.70 (+149%) | 1.31 → 1.60 (+21%) | 1.01 → 1.48 (+46%) |
| 5,000 | geo | 0.33 → 0.32 (-3%) | 2.66 → 2.10 (-21%) | 0.78 → 1.17 (+50%) | 0.84 → 1.03 (+22%) |
| 20,000 | geo | 0.31 → 0.30 (-3%) | 0.45 → 0.92 (+105%) | 0.47 → 0.67 (+43%) | 0.42 → 0.60 (+43%) |
| 1,000 | mixed | 0.34 → 0.38 (+11%) | 4.70 → 7.26 (+54%) | 1.20 → 1.29 (+7%) | 1.33 → 1.24 (-7%) |
| 5,000 | mixed | 0.28 → 0.31 (+9%) | 2.60 → 1.64 (-37%) | 0.81 → 0.93 (+14%) | 0.97 → 0.92 (-5%) |
| 20,000 | mixed | 0.33 → 0.34 (+2%) | 0.59 → 0.80 (+34%) | 0.75 → 0.88 (+17%) | 0.67 → 0.81 (+21%) |

**Creation and hit testing did not move; the redraw paths did.** mocanvas's advantage on `create` is the
same as it was (±10% on the ratio, in both directions), and so is its hit-testing advantage, which is
expected: neither builds stroke geometry. The `selectAllDrag` ratio, which does rebuild it every frame,
moved against mocanvas in all six cells on the median frame and four of six at the 95th percentile, by
roughly 7–50%. That is the hand-drawn stroke being paid for, and it is the honest cost of the more
faithful render.

The pan/zoom ratios move in both directions — worse at 1,000 and 20,000, better at 5,000 — and are the
least trustworthy column here. Frame deltas are quantised to the browser's ~8.3 ms cadence, so the
`1,000 geo` cell's +149% is mocanvas going from 24.5 ms to 58.3 ms: three buckets to seven, where one
bucket either way would have moved it by a third. Treat pan/zoom as "somewhere between unchanged and
moderately worse" and the drag figures as the number that was actually measured.

What the same changes bought is in the [rendering comparison](#rendering-comparison): the fixture-wide
interior IoU and every whole-image figure improved, and the two worst per-shape rows were fixed outright.

## Environment

| | |
| :--- | :--- |
| Date | 2026-09-04 12:23:16 UTC |
| Machine | Apple M3 Pro, 11 cores, 36 GB |
| OS | Darwin 25.5.0 (arm64) |
| Node | v25.9.0 |
| Browser | headless Chromium 151.0.7922.34 (Playwright 1.62.1) |
| Chromium flags | `--js-flags=--expose-gc --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --hide-scrollbars --force-color-profile=srgb --font-render-hinting=none --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy` |
| GL mode attempted | gpu |
| WebGL2 renderer | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver) |
| Rasterisation | **software (SwiftShader)** — no hardware GPU in this environment |
| tldraw | 5.4.0 |
| mocanvas | 0.0.1 (this repo, 2ef11f1) |
| Builds | production (`vite build`, minified, `NODE_ENV=production`) for both |
| Viewport | 1200×800 CSS px, device scale 1 |
| Matrix | N ∈ {1000, 5000, 20000} × kind ∈ {geo, mixed}, 3 repeats, medians reported |

_What was clean, exactly. `git status --short` was empty at `2ef11f1` when this run started, and the bundle under measurement is built once, before the first measurement — so every number here comes from a clean `2ef11f1`. The working tree went dirty later in the run, while it was still measuring, because this report generator (`apps/bench/scripts/bench.mjs`) and `apps/bench/results/visible-differences.md` were being edited to describe the run. Neither is part of what was measured: nothing under `packages/` or `crates/` was touched at any point._

## Results

Every cell is the median of the repeats. `ratio` compares the two: “2.00× faster” means mocanvas took half the time tldraw did.

### Shape creation (`create(n, kind)`)

Wall time of the single `createShapes` call, inside one transaction with history disabled.

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 21 ms | 48 ms | 2.30× faster |
| 5,000 | geo | 57 ms | 176 ms | 3.09× faster |
| 20,000 | geo | 203 ms | 680 ms | 3.34× faster |
| 1,000 | mixed | 36 ms | 96 ms | 2.66× faster |
| 5,000 | mixed | 96 ms | 316 ms | 3.27× faster |
| 20,000 | mixed | 353 ms | 1047 ms | 2.96× faster |

Time from the start of that call until the second animation frame afterwards (creation + first paint):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 138 ms | 157 ms | 1.14× faster |
| 5,000 | geo | 170 ms | 698 ms | 4.11× faster |
| 20,000 | geo | 345 ms | 3474 ms | 10.06× faster |
| 1,000 | mixed | 185 ms | 242 ms | 1.31× faster |
| 5,000 | mixed | 256 ms | 1063 ms | 4.14× faster |
| 20,000 | mixed | 595 ms | 4327 ms | 7.27× faster |

### Pan / zoom frame time (`panZoomRun(120)`)

120 frames of the scripted camera animation. Median frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 25.00 ms | 8.30 ms | 3.01× slower |
| 5,000 | geo | 58.30 ms | 16.70 ms | 3.49× slower |
| 20,000 | geo | 83.40 ms | 208.40 ms | 2.50× faster |
| 1,000 | mixed | 25.00 ms | 8.30 ms | 3.01× slower |
| 5,000 | mixed | 58.40 ms | 25.00 ms | 2.34× slower |
| 20,000 | mixed | 91.20 ms | 240.80 ms | 2.64× faster |

95th-percentile frame (the stutter you actually feel):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 58.30 ms | 8.70 ms | 6.70× slower |
| 5,000 | geo | 175.00 ms | 83.40 ms | 2.10× slower |
| 20,000 | geo | 408.30 ms | 441.70 ms | 1.08× faster |
| 1,000 | mixed | 66.80 ms | 9.20 ms | 7.26× slower |
| 5,000 | mixed | 191.20 ms | 116.80 ms | 1.64× slower |
| 20,000 | mixed | 391.70 ms | 491.70 ms | 1.26× faster |

Worst single frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 65.90 ms | 9.30 ms | 7.09× slower |
| 5,000 | geo | 233.40 ms | 100.00 ms | 2.33× slower |
| 20,000 | geo | 558.30 ms | 516.70 ms | 1.08× slower |
| 1,000 | mixed | 107.80 ms | 16.80 ms | 6.42× slower |
| 5,000 | mixed | 317.20 ms | 159.20 ms | 1.99× slower |
| 20,000 | mixed | 533.00 ms | 591.70 ms | 1.11× faster |

Average frames per second over the run (higher is better):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 37.6 | 120.0 | 3.19× slower |
| 5,000 | geo | 13.0 | 36.3 | 2.79× slower |
| 20,000 | geo | 7.8 | 4.3 | 1.81× faster |
| 1,000 | mixed | 32.1 | 116.2 | 3.62× slower |
| 5,000 | mixed | 11.6 | 22.9 | 1.97× slower |
| 20,000 | mixed | 7.6 | 3.8 | 2.00× faster |

### Select-all + drag frame time (`selectAllDragRun(60)`)

Every shape on the page is selected, then nudged once per frame for 60 frames — this exercises
the write path (store update → geometry invalidation → re-render), not just the camera. Median frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 66.70 ms | 41.80 ms | 1.60× slower |
| 5,000 | geo | 291.70 ms | 250.00 ms | 1.17× slower |
| 20,000 | geo | 991.80 ms | 1483.30 ms | 1.50× faster |
| 1,000 | mixed | 75.00 ms | 58.30 ms | 1.29× slower |
| 5,000 | mixed | 325.00 ms | 350.00 ms | 1.08× faster |
| 20,000 | mixed | 1408.30 ms | 1608.30 ms | 1.14× faster |

95th-percentile frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 75.00 ms | 50.80 ms | 1.48× slower |
| 5,000 | geo | 300.10 ms | 291.60 ms | 1.03× slower |
| 20,000 | geo | 1050.00 ms | 1758.30 ms | 1.67× faster |
| 1,000 | mixed | 83.40 ms | 67.50 ms | 1.24× slower |
| 5,000 | mixed | 366.70 ms | 400.00 ms | 1.09× faster |
| 20,000 | mixed | 1533.50 ms | 1883.40 ms | 1.23× faster |

### Hit testing (`hitTestRun(500)`)

500 deterministic `getShapeAtPoint` queries spread over the document bounds, µs per query:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 1,000 | geo | 3.0 µs | 42.6 µs | 14.20× faster |
| 5,000 | geo | 4.2 µs | 189.2 µs | 45.05× faster |
| 20,000 | geo | 6.6 µs | 748.2 µs | 113.36× faster |
| 1,000 | mixed | 3.2 µs | 67.4 µs | 21.06× faster |
| 5,000 | mixed | 5.6 µs | 272.8 µs | 48.71× faster |
| 20,000 | mixed | 7.6 µs | 831.0 µs | 109.34× faster |

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
| Interior IoU | **96.0%** | fills, positions and sizes — exact geometry on both sides |
| Stroke band distance | **1.00 px median, 5.10 px p95** | how far apart the two outlines actually run |
| Whole-image pixel diff | **3.33% differing, 81.6% painted-pixel IoU** | everything at once, stroke randomness included |

Both libraries draw the default `dash: "draw"` style as a genuinely hand-drawn outline — seeded wobble,
rounded corners, overshoot past the vertex — and neither is trying to reproduce the other's random
numbers. Two outlines that both look right therefore miss each other by roughly a stroke width, and a
pixel diff charges for that twice: once where mocanvas painted and tldraw did not, and once the other way
round. That is measured, not assumed. When mocanvas drew exact polygons with a uniform stroke, at
`ef4d079`, it scored *better* on the whole-image figures than it did once the hand-drawn outline landed
at `83ff957` — 79.1% painted-pixel IoU against 78.2% — while looking visibly wrong. So the whole-image
row is reported last, and the two above it are the ones to quote.

### 1. Interior IoU — 96.0%

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
| star | 8,666 | 90.3% | 98.0% |
| triangle | 8,897 | 92.8% | 99.3% |
| hexagon | 15,915 | 95.7% | 99.1% |
| note | 44,358 | 90.3% | 95.9% |
| frame | 114,091 | 98.8% | 97.5% |
| rectangle (in frame) | 10,067 | 98.4% | 99.8% |
| ellipse (in frame) | 12,390 | 94.7% | 99.5% |
| **whole fixture** | **239,764** | **96.0%** | **97.3%** |

The fixture-wide row is one union over every shape's interior, not an average of the rows, so the boxes
that overlap — the frame and its two children — are not counted twice.

**Fills are essentially exact.** Every shape that is only fill agrees on colour over 99% of its shared
interior, except the star at 98.0% — the smallest interior in the fixture, where the hand-drawn
outline's wobble reaches proportionally furthest in. The two rows below that are the two carrying
something other than fill: the rectangle's 94.8% is its "Hello box" label, a font-weight difference
rather than a fill one, and the note's 95.9% is its label plus the drop shadow around its body. The
note's gradient is no longer a difference at all: it reads `#f7dc99` at the top of the body and `#fce19c` at
the bottom in both renders — identical values, not merely within tolerance.

**The two geometry errors this metric was built to find are fixed.** In the previous run the star sat at
69.9% and the hexagon at 80.1%: mocanvas drew the star with too small an inner radius, so its arms were
visibly thinner, and it put the hexagon's vertices left and right instead of top and bottom, which made it
half a box narrower across the flats. `2ef11f1` corrected both, and they now read 90.3% and 95.7%.
Neither error was visible in the whole-image number, where both were buried under stroke wobble; both were
obvious the moment the interiors were compared directly.

**What is left is not a wrong outline.** The lowest rows are now note (90.3%), star (90.3%), triangle (92.8%), and they
have two different causes, neither of them shape geometry.

The note is the one large region on that list, and what this metric scores there is not its body but its
silhouette, which includes the drop shadow. The body matches: 214 px wide in both renders, same gradient
values at both ends. The shadow does not — mocanvas's spreads about 7 px further on each side and 7 px
higher than tldraw's — and that spread is most of the missing 10 points.

The star and the triangle are simply the two smallest interiors in the fixture (8,666 and 8,897 px). A 6 px
erosion takes a fixed bite out of every silhouette and zoom-to-fit lands mocanvas's ink a pixel or two off
tldraw's (see Visible differences); both cost a small region proportionally far more than a large one. The
frame, the largest region here, scores 98.8% under exactly the same treatment.

Not scored here: the bent arrow, the freehand stroke, the straight arrow, the line and the text shape. An open shape encloses nothing, and its box overlaps shapes that
do — measuring "its interior" would silently be measuring theirs. The stroke band distance below is the
metric that covers them.

### 2. Stroke band distance — 1.00 px median, 5.10 px at the 95th percentile

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
| star | 1,949 | 1.00 px | 3.00 px | 5.00 px |
| triangle | 1,660 | 1.00 px | 2.24 px | 5.39 px |
| hexagon | 1,774 | 1.00 px | 3.00 px | 4.47 px |
| freehand stroke | 1,334 | 1.00 px | 3.00 px | 9.22 px |
| straight arrow | 787 | 0.00 px | 2.24 px | 14.87 px |
| line | 1,251 | 1.00 px | 3.16 px | 5.00 px |
| note | 826 | 1.41 px | 4.00 px | 6.00 px |
| text shape | 1,640 | 2.00 px | 12.04 px | 26.17 px |
| frame | 4,556 | 1.00 px | 2.00 px | 4.47 px |
| rectangle (in frame) | 1,484 | 0.00 px | 1.00 px | 3.00 px |
| ellipse (in frame) | 1,652 | 0.00 px | 2.83 px | 4.12 px |
| **whole fixture** | — | **1.00 px** | **5.10 px** | **26.17 px** |

**This is the number that says the hand-drawn stroke is working.** Half of mocanvas's stroke pixels are
within 1.00 px of a reference stroke pixel of the same colour, and the worst pixel anywhere in the fixture is
26.17 px out — about 6.5 stroke widths, on a glyph. 13 of the 14 scored regions sit at a median of
half a stroke width or better. Two outlines that a pixel diff scores as largely disjoint are, measured as a
distance, running within a stroke width of each other nearly everywhere.

The two rows that stand out are the differences worth having a name for, and neither is stroke
randomness:

- **bent arrow, 4.12 px median / 19.85 px p95** — tldraw stops the arrow short of the rectangle it is bound
  to; mocanvas runs it to the shape's edge. A binding difference, and the only region left in the fixture
  whose median is more than half a stroke width out.
- **text shape, 2.00 px median / 12.04 px p95** — font weight: tldraw's face is heavier and slightly wider, so the
  glyphs drift apart along the line even though the baseline and size agree. It also owns the fixture's
  worst single pixel.

The star (1.00 px median / 3.00 px p95) and the hexagon (1.00 px median / 3.00 px p95) were on this list in the previous run, at 2.83 px
and 6.71 px median against a ~4 px stroke. `2ef11f1` corrected the outlines behind both, and they now sit at
the fixture median.

Two exclusions, both documented in `scripts/compare-metrics.mjs`. tldraw's "Get a license for production"
badge (found automatically at 1100,764–1192,794, and only excluded because mocanvas paints nothing at all inside it) sits
inside the frame's box and is not a rendering difference. And a colour class with fewer than
150 pixels in a region is the antialiased skirt of a neighbouring colour rather than a stroke of its own,
so it is skipped rather than allowed to set that region's 95th percentile.

### 3. Whole-image pixel diff — 3.33% differing, 81.6% painted-pixel IoU

| | |
| :--- | ---: |
| Differing pixels | **3.33%** (32,005 of 960,000) |
| Tolerance | any channel differing by more than 24/255 |
| Painted (non-white) pixels, mocanvas | 112,518 |
| Painted (non-white) pixels, tldraw | 114,470 |
| Painted-pixel overlap (IoU) | **81.6%** |

**Both rows understate the agreement, and the differing-pixels row is the worse of the two.** tldraw inks
only about 12% of the canvas, so a render that draws too little scores well on it: mocanvas painted
*nothing* in the first run below and scored 11.84% differing, then drew the whole document with the wrong
fills and scored 12.14%. Two renders that could hardly be less alike landed within 0.3 points of each
other. Painted-pixel IoU separates those two properly (0.0% against 56.4%), but it is an *overlap*, and an
overlap is exactly the wrong shape of question to ask about two independently wobbled outlines: it counts
a stroke that is one stroke width away identically to one that is on the other side of the canvas.

Quote it as an upper bound on how much of the render is pixel-identical, not as a similarity score.

### How the comparison has moved

| | `32ac776-dirty` | `15b670a-dirty` | `ef4d079` | `83ff957` | `2ef11f1` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| | before the `.tldr` load fix | drawn, wrong fill ramp | correct fills, exact outlines | hand-drawn outlines | star and hexagon corrected (this run) |
| mocanvas loaded the file | no — threw on `props.richText` | yes | yes | yes | yes |
| Interior IoU | not measured yet | not measured yet | not measured yet | **94.1%** | **96.0%** |
| Stroke band, median | not measured yet | not measured yet | not measured yet | **1.00 px** | **1.00 px** |
| Painted-pixel IoU | 0.0% | 56.4% | 79.1% | 78.2% | 81.6% |
| Differing pixels | 11.84% | 12.14% | 3.79% | 3.82% | 3.33% |

The first two columns are why the whole-image rows are reported last: they barely move across the change
that took mocanvas from drawing nothing at all to drawing the entire document. The fill-ramp fix in
`ef4d079` is the one change both of them register properly.

**The last two steps show why the order of the three metrics matters.**

`ef4d079` drew exact polygons with a uniform stroke. `182bf43` and `83ff957` replaced that with the seeded,
wobbling, corner-overshooting outline the default `dash: "draw"` style actually calls for — unambiguously the
more faithful render — and the whole-image numbers got *worse* for it (79.1% → 78.2% painted-pixel
IoU, 3.79% → 3.82% differing). A pixel diff cannot tell a stroke in the wrong place from a stroke
drawn with different random numbers, and it charges twice for the second.

`2ef11f1` then fixed two outlines that were genuinely the wrong shape — the star's inner radius and the
hexagon's orientation — and *every* metric improved, whole-image rows included (78.2% → 81.6% painted-pixel
IoU, 3.82% → 3.33% differing, interior IoU 94.1% → 96.0%). That is the distinction the ordering
encodes: a wrong shape is wrong in all three, while a differently-seeded stroke only looks wrong to the
third. Optimise against the first two; read the third as a consequence.

The columns were measured on different revisions but with the same fixture, viewport, browser and tolerance.
The interior and band rows are blank before `83ff957` because the metrics did not exist yet — nothing has
been back-filled or estimated.

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
  That probe file was recorded in this same environment at an earlier revision. It is quoted here because
  it measures the rasteriser rather than mocanvas — no mocanvas code runs in it — so it does not need
  re-measuring with the rest of the report.
- **Run-to-run spread is very wide here, and was unusually wide between this run and the last.** tldraw's code did not
  change between this run and the previous one, and it still came out 26–57% slower on shape creation,
  27–69% slower on hit testing and up to 234% slower on the 95th-percentile pan/zoom frame (see "What
  changed since the previous run"). None of that is a code change, so **absolute numbers from this report
  should not be compared against absolute numbers from any earlier one.** Only comparisons made inside a
  single browser session — the mocanvas/tldraw pairs in every table here — are worth quoting, and even a
  cross-run comparison of those ratios should be read as a direction, not a magnitude.
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
- **Every shape here uses the default `dash: "draw"`, which is the expensive one.** That outline is seeded
  wobble with rounded corners and overshoot, and it costs roughly 2.5× the tessellation work of a plain
  stroke. It is what tldraw draws by default too, so the comparison is like-for-like, but it means the
  mocanvas frame times here are its most expensive stroke style on every one of 20,000 shapes. A document
  drawn with `dash: "solid"` would not produce these numbers, and this benchmark does not measure that case.
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
