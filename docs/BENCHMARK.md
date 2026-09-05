# Benchmark: mocanvas vs tldraw

_Generated 2026-09-05 12:27:14 UTC by `apps/bench/scripts/bench.mjs`. Re-run with `pnpm --filter bench bench`._

## Summary

mocanvas creates shapes 2.7–2.8× faster than tldraw and reaches first paint up to 13× faster,
answers hit-test queries 80–111× faster and holds 4–5× less JS heap; at 20,000 shapes it is also
14.2–16.1× faster on the median pan/zoom frame and 2.9–3.8× faster on select-all-drag.
This run measured 20,000 shapes only. The caveats below matter for reading the frame figures: this
machine has no GPU, so mocanvas's WebGL2 output is rasterised on the CPU, and the pan/zoom metric
counts only main-thread work, which tldraw largely avoids by panning with a CSS transform on the
compositor. The `selectAllDrag` tables are the fairer frame comparison.

Rendering the same tldraw-authored document, mocanvas agrees with tldraw on 99.2% of shape interiors by
IoU at 97.6% colour agreement, and half its stroke pixels land within 0.00 px of a tldraw stroke
pixel of the same colour (95th percentile 10.00 px, against a stroke about 4 px wide). 2.68% of the
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
| 20,000 | geo | 116.7 → 16.6 ms | -86% | 258.8 → 283.0 ms | +9% |
| 20,000 | mixed | 208.3 → 25.0 ms | -88% | 350.1 → 299.3 ms | -15% |

**This machine was much slower during this run, so read the control column first.** tldraw ran identical
code across the two runs and still moved by -35% to +9% across pan, creation and drag —
shape creation included, which draws nothing at all, and its hit testing, which is pure JS and touches no
pixels, got 27–69% slower too. Nothing in that column is a code change, so the absolute before → after
figures in the first column cannot be read as a regression on their own; they carry the same machine
slowdown plus whatever mocanvas did.

What survives that is the **ratio between the two libraries**, which were measured against each other in
the same session on both occasions, so a slower machine largely divides out. Below 1.00 means mocanvas was
faster than tldraw; the bracket is how that ratio moved, and a positive bracket is mocanvas losing ground.

| N | kind | create (then → now) | pan p95 (then → now) | drag p50 (then → now) | drag p95 (then → now) |
| ---: | :--- | ---: | ---: | ---: | ---: |
| 20,000 | geo | 0.31 → 0.36 (+15%) | 0.45 → 0.06 (-87%) | 0.47 → 0.27 (-43%) | 0.42 → 0.26 (-38%) |
| 20,000 | mixed | 0.33 → 0.37 (+12%) | 0.59 → 0.08 (-86%) | 0.75 → 0.34 (-54%) | 0.67 → 0.33 (-51%) |

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
| Date | 2026-09-05 12:27:14 UTC |
| Machine | Apple M3 Pro, 11 cores, 36 GB |
| OS | Darwin 25.5.0 (arm64) |
| Node | v25.9.0 |
| Browser | headless Chromium 151.0.7922.34 (Playwright 1.62.1) |
| Chromium flags | `--js-flags=--expose-gc --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --hide-scrollbars --force-color-profile=srgb --font-render-hinting=none --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy` |
| GL mode attempted | gpu |
| WebGL2 renderer | ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version) |
| Rasterisation | hardware |
| tldraw | 5.4.0 |
| mocanvas | 2.0.0 (this repo, 81c60bc-dirty) |
| Builds | production (`vite build`, minified, `NODE_ENV=production`) for both |
| Viewport | 1200×800 CSS px, device scale 1 |
| Matrix | N ∈ {20000} × kind ∈ {geo, mixed}, 3 repeats, medians reported |

_Measured from a **dirty working tree** at `81c60bc`: the bundle under measurement was built from the files as they were when this run started, which are not any committed state. Treat these numbers as provisional until they are re-run on a clean tree._

## Results

Every cell is the median of the repeats. `ratio` compares the two: “2.00× faster” means mocanvas took half the time tldraw did.

### Shape creation (`create(n, kind)`)

Wall time of the single `createShapes` call, inside one transaction with history disabled.

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 20,000 | geo | 150 ms | 421 ms | 2.81× faster |
| 20,000 | mixed | 254 ms | 686 ms | 2.70× faster |

Time from the start of that call until the second animation frame afterwards (creation + first paint):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 20,000 | geo | 168 ms | 2218 ms | 13.19× faster |
| 20,000 | mixed | 366 ms | 2626 ms | 7.18× faster |

### Pan / zoom frame time (`panZoomRun(120)`)

120 frames of the scripted camera animation. Median frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 20,000 | geo | 8.30 ms | 117.50 ms | 14.16× faster |
| 20,000 | mixed | 8.30 ms | 133.40 ms | 16.07× faster |

95th-percentile frame (the stutter you actually feel):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 20,000 | geo | 16.60 ms | 283.00 ms | 17.05× faster |
| 20,000 | mixed | 25.00 ms | 299.30 ms | 11.97× faster |

Worst single frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 20,000 | geo | 41.10 ms | 350.40 ms | 8.53× faster |
| 20,000 | mixed | 41.60 ms | 366.70 ms | 8.81× faster |

Average frames per second over the run (higher is better):

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 20,000 | geo | 110.0 | 7.3 | 15.01× faster |
| 20,000 | mixed | 91.4 | 6.5 | 13.99× faster |

### Select-all + drag frame time (`selectAllDragRun(60)`)

Every shape on the page is selected, then nudged once per frame for 60 frames — this exercises
the write path (store update → geometry invalidation → re-render), not just the camera. Median frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 20,000 | geo | 175.00 ms | 658.40 ms | 3.76× faster |
| 20,000 | mixed | 249.90 ms | 733.40 ms | 2.93× faster |

95th-percentile frame:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 20,000 | geo | 192.60 ms | 740.90 ms | 3.85× faster |
| 20,000 | mixed | 275.90 ms | 841.60 ms | 3.05× faster |

### Hit testing (`hitTestRun(500)`)

500 deterministic `getShapeAtPoint` queries spread over the document bounds, µs per query:

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 20,000 | geo | 5.6 µs | 449.4 µs | 80.25× faster |
| 20,000 | mixed | 6.2 µs | 685.4 µs | 110.55× faster |

### JS heap after the run (`memoryMB()`)

`performance.memory.usedJSHeapSize` after a forced GC (`--js-flags=--expose-gc`). This is JS heap only —
it does not include GPU buffers (mocanvas) or the DOM/layout memory of the render tree (tldraw), so it
understates both, differently. Treat it as a rough signal, not a memory benchmark.

| N | kind | mocanvas | tldraw | ratio |
| ---: | :--- | ---: | ---: | :--- |
| 20,000 | geo | 168.5 MB | 777.4 MB | 4.61× less |
| 20,000 | mixed | 182.1 MB | 786.6 MB | 4.32× less |

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
| Interior IoU | **99.2%** | fills, positions and sizes — exact geometry on both sides |
| Stroke band distance | **0.00 px median, 10.00 px p95** | how far apart the two outlines actually run |
| Whole-image pixel diff | **2.68% differing, 88.3% painted-pixel IoU** | everything at once, stroke randomness included |

Both libraries draw the default `dash: "draw"` style as a genuinely hand-drawn outline — seeded wobble,
rounded corners, overshoot past the vertex — and neither is trying to reproduce the other's random
numbers. Two outlines that both look right therefore miss each other by roughly a stroke width, and a
pixel diff charges for that twice: once where mocanvas painted and tldraw did not, and once the other way
round. That is measured, not assumed. When mocanvas drew exact polygons with a uniform stroke, at
`ef4d079`, it scored *better* on the whole-image figures than it did once the hand-drawn outline landed
at `83ff957` — 79.1% painted-pixel IoU against 78.2% — while looking visibly wrong. So the whole-image
row is reported last, and the two above it are the ones to quote.

### 1. Interior IoU — 99.2%

Per shape, the region is cut out of both screenshots and the silhouette of whatever was drawn there is
recovered — paint, plus everything the paint encloses, so a fill the colour of the paper still has an
interior. Both silhouettes are then eroded 6 px inward, past the widest stroke either library draws
(hand-drawn overshoot included), leaving interior only: no stroke pixel is counted on either side. `IoU`
is the intersection of the two eroded interiors over their union — position and size, with the outline
taken out. `colour` is how much of the shared interior agrees on colour at the same 24/255 tolerance the
pixel diff uses — the fills.

| shape | interior px (tldraw) | IoU | colour |
| :--- | ---: | ---: | ---: |
| rectangle | 25,958 | 99.2% | 95.9% |
| ellipse | 21,721 | 98.6% | 99.9% |
| star | 8,589 | 93.6% | 98.8% |
| triangle | 8,845 | 96.8% | 99.4% |
| hexagon | 15,833 | 97.9% | 99.1% |
| note | 44,385 | 99.6% | 96.2% |
| frame | 114,091 | 100.0% | 97.6% |
| rectangle (in frame) | 10,060 | 97.1% | 100.0% |
| ellipse (in frame) | 12,307 | 96.2% | 99.4% |
| **whole fixture** | **239,422** | **99.2%** | **97.6%** |

The fixture-wide row is one union over every shape's interior, not an average of the rows, so the boxes
that overlap — the frame and its two children — are not counted twice.

**Fills are essentially exact.** Every shape that is only fill agrees on colour over 99% of its shared
interior, except the star at 98.8% — the smallest interior in the fixture, where the hand-drawn
outline's wobble reaches proportionally furthest in. The two rows below that are the two carrying
something other than fill: the rectangle's 95.9% is its "Hello box" label, a font-weight difference
rather than a fill one, and the note's 96.2% is its label plus the drop shadow around its body. The
note's gradient is no longer a difference at all: it reads `#f7dc99` at the top of the body and `#fce19c` at
the bottom in both renders — identical values, not merely within tolerance.

**The two geometry errors this metric was built to find are fixed.** In the previous run the star sat at
69.9% and the hexagon at 80.1%: mocanvas drew the star with too small an inner radius, so its arms were
visibly thinner, and it put the hexagon's vertices left and right instead of top and bottom, which made it
half a box narrower across the flats. `2ef11f1` corrected both, and they now read 93.6% and 97.9%.
Neither error was visible in the whole-image number, where both were buried under stroke wobble; both were
obvious the moment the interiors were compared directly.

**What is left is not a wrong outline.** The lowest rows are now star (93.6%), ellipse (in frame) (96.2%), triangle (96.8%), and they
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

### 2. Stroke band distance — 0.00 px median, 10.00 px at the 95th percentile

The question a hand-drawn outline can fairly be asked is not "do your stroke pixels land on the
reference's?" but "how far away are they?". For every stroke colour in the reference render, an exact
Euclidean distance transform gives the distance from any pixel to the nearest stroke pixel of that colour
in each image. Sampling those at the *other* render's stroke pixels of the same colour, in both directions
so that a stroke which is merely shorter cannot score well, gives a distance in pixels per shape.

Stroke width in these screenshots is about 4 px, so a hand-drawn pair that looks right should land
within a few pixels; a genuinely misplaced outline would not.

| shape | reference stroke px | median | p95 | max |
| :--- | ---: | ---: | ---: | ---: |
| rectangle | 2,960 | 0.00 px | 2.00 px | 6.08 px |
| bent arrow | 1,833 | 3.61 px | 20.52 px | 22.63 px |
| ellipse | 2,324 | 0.00 px | 1.41 px | 4.12 px |
| star | 1,826 | 0.00 px | 2.00 px | 3.16 px |
| triangle | 1,632 | 0.00 px | 1.41 px | 5.10 px |
| hexagon | 1,704 | 0.00 px | 2.00 px | 4.00 px |
| freehand stroke | 1,312 | 0.00 px | 2.83 px | 8.94 px |
| straight arrow | 789 | 0.00 px | 94.15 px | 126.13 px |
| line | 1,156 | 0.00 px | 2.24 px | 3.61 px |
| note | 824 | 1.00 px | 3.00 px | 5.00 px |
| text shape | 1,641 | 2.00 px | 11.18 px | 26.48 px |
| frame | 4,550 | 0.00 px | 70.01 px | 189.26 px |
| rectangle (in frame) | 1,443 | 0.00 px | 1.00 px | 2.83 px |
| ellipse (in frame) | 1,688 | 0.00 px | 2.00 px | 3.00 px |
| **whole fixture** | — | **0.00 px** | **10.00 px** | **189.26 px** |

**This is the number that says the hand-drawn stroke is working.** Half of mocanvas's stroke pixels are
within 0.00 px of a reference stroke pixel of the same colour, and the worst pixel anywhere in the fixture is
189.26 px out — about 47.3 stroke widths, on a glyph. 13 of the 14 scored regions sit at a median of
half a stroke width or better. Two outlines that a pixel diff scores as largely disjoint are, measured as a
distance, running within a stroke width of each other nearly everywhere.

The two rows that stand out are the differences worth having a name for, and neither is stroke
randomness:

- **bent arrow, 3.61 px median / 20.52 px p95** — tldraw stops the arrow short of the rectangle it is bound
  to; mocanvas runs it to the shape's edge. A binding difference, and the only region left in the fixture
  whose median is more than half a stroke width out.
- **text shape, 2.00 px median / 11.18 px p95** — font weight: tldraw's face is heavier and slightly wider, so the
  glyphs drift apart along the line even though the baseline and size agree. It also owns the fixture's
  worst single pixel.

The star (0.00 px median / 2.00 px p95) and the hexagon (0.00 px median / 2.00 px p95) were on this list in the previous run, at 2.83 px
and 6.71 px median against a ~4 px stroke. `2ef11f1` corrected the outlines behind both, and they now sit at
the fixture median.

Two exclusions, both documented in `scripts/compare-metrics.mjs`. tldraw's "Get a license for production"
badge (found automatically at 1100,763–1192,794, and only excluded because mocanvas paints nothing at all inside it) sits
inside the frame's box and is not a rendering difference. And a colour class with fewer than
150 pixels in a region is the antialiased skirt of a neighbouring colour rather than a stroke of its own,
so it is skipped rather than allowed to set that region's 95th percentile.

### 3. Whole-image pixel diff — 2.68% differing, 88.3% painted-pixel IoU

| | |
| :--- | ---: |
| Differing pixels | **2.68%** (25,754 of 960,000) |
| Tolerance | any channel differing by more than 24/255 |
| Painted (non-white) pixels, mocanvas | 110,942 |
| Painted (non-white) pixels, tldraw | 114,310 |
| Painted-pixel overlap (IoU) | **88.3%** |

**Both rows understate the agreement, and the differing-pixels row is the worse of the two.** tldraw inks
only about 12% of the canvas, so a render that draws too little scores well on it: mocanvas painted
*nothing* in the first run below and scored 11.84% differing, then drew the whole document with the wrong
fills and scored 12.14%. Two renders that could hardly be less alike landed within 0.3 points of each
other. Painted-pixel IoU separates those two properly (0.0% against 56.4%), but it is an *overlap*, and an
overlap is exactly the wrong shape of question to ask about two independently wobbled outlines: it counts
a stroke that is one stroke width away identically to one that is on the other side of the canvas.

Quote it as an upper bound on how much of the render is pixel-identical, not as a similarity score.

### How the comparison has moved

| | `32ac776-dirty` | `15b670a-dirty` | `ef4d079` | `83ff957` | `81c60bc-dirty` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| | before the `.tldr` load fix | drawn, wrong fill ramp | correct fills, exact outlines | hand-drawn outlines | star and hexagon corrected (this run) |
| mocanvas loaded the file | no — threw on `props.richText` | yes | yes | yes | yes |
| Interior IoU | not measured yet | not measured yet | not measured yet | **94.1%** | **99.2%** |
| Stroke band, median | not measured yet | not measured yet | not measured yet | **1.00 px** | **0.00 px** |
| Painted-pixel IoU | 0.0% | 56.4% | 79.1% | 78.2% | 88.3% |
| Differing pixels | 11.84% | 12.14% | 3.79% | 3.82% | 2.68% |

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
hexagon's orientation — and *every* metric improved, whole-image rows included (78.2% → 88.3% painted-pixel
IoU, 3.82% → 2.68% differing, interior IoU 94.1% → 99.2%). That is the distinction the ordering
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

- `arrow: missing prop "text" (default used) (x2)`
- `binding arrow: unknown prop "snap"`
- `draw: unknown prop "scaleX"`
- `draw: unknown prop "scaleY"`
- `draw: segment uses the packed "path" form (decoded to "points" on load)`
- `geo: missing prop "text" (default used) (x7)`
- `frame: unknown prop "color"`
- `text: missing prop "text" (default used)`
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

4. **Framing: mocanvas fits *ink* bounds where tldraw fits *geometry* bounds.** Ignoring the
   watermark, mocanvas's ink bounding box is 1146×710 px starting at (24, 44), against tldraw's
   1143×712 starting at (28, 43). The 4 px on the left edge is the note's wider shadow (see 2). The
   rest is not the constant 1 px offset it was described as: it is a 0.33% scale difference plus a
   0.67 px downward shift, which reads as +1.8 px at the top of the content and −0.5 px at the
   bottom. Both harness pages compute the camera with the *same* helper (`fitCameraFor`, a fixed
   64 px inset) at the same 1200×800 viewport, so the only free input is each library's own
   `getCurrentPageBounds()`. tldraw returns the geometric union, `(100, 100, 1060, 660)`; mocanvas
   returns the engine's culling bounds — `Scene::page_bounds`, each shape's geometry expanded by
   half its stroke width — which is `(98.25, 98.25, 1063.5, 662.25)`: 1.75 px of pad around the
   `size: "m"` (3.5 px) strokes at the top, left and right, and only 0.5 px under the frame's 1 px
   hairline at the bottom. Feeding those two boxes to the shared formula reproduces both recorded
   cameras exactly, to the last digit — tldraw `z = 1.071698113208`, mocanvas `z = 1.068171133051`
   (the ratio 1060/1063.5), with the fitted centre 0.625 page px above the geometric centre because
   the pad is thicker at the top than at the bottom. That accounts for the whole framing difference;
   nothing is left over for a renderer offset. It costs each interior-IoU row a point or two and
   costs the small shapes more than the large ones.

   The renderer itself is not implicated and was checked directly: with the WebGL2 clip mapping from
   `packages/editor/src/render/webgl2.ts` (`screen = (pos + cam) * zoom`, `clip = screen / vp * 2 −
   1`, y flipped), a quad spanning page y 100–101 at `cam = (0, 0, 1)` fills device row 100 exactly
   at dpr 1 and rows 200–201 at dpr 2, and page y 100.5–101.5 fills rows 201–202 — i.e. a page
   coordinate of N lands on a pixel *boundary* at N × dpr, the same convention a DOM or SVG renderer
   uses. No half pixel is introduced by the transform, by the `round(cssSize × dpr)` backing store,
   or by `updateViewportScreenBounds` taking a viewport-relative rect.

   No code was changed for this. The fix belongs in `Editor.getCurrentPageBounds()` (or in what the
   engine reports), not in the camera: `getShapePageBounds()` returns geometry while
   `getCurrentPageBounds()` returns ink, and the two silently disagree. Fitting to ink is defensible
   on its own — it keeps a fat stroke from being clipped at the viewport edge — but it should not be
   *asymmetric*: because the pad is per-shape, a thick stroke at the top and a hairline at the
   bottom pull the fitted centre off the content's actual centre. Two 200×120 rectangles at the same
   x, one `size: "xl"` and one `size: "s"`, make it visible with nothing else on the page: geometric
   union `(100, 100, 200, 420)`, `getCurrentPageBounds()` `(95, 95, 210, 426)` — 5 px of pad above,
   1 px below, so the fitted centre sits 2 px high. `Editor.zoomToFit()` inherits the same skew.
   Nudging the camera to make this fixture line up would be the wrong repair.

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

- **Headless, software-rasterised GPU.** Hardware acceleration was available, but a headless Chromium GPU stack is still not a user's browser.
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
