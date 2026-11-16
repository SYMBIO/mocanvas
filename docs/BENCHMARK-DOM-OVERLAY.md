# Benchmark: the DOM overlay under a moving camera

_Measured 2026-11-10 by `apps/bench/scripts/dom-overlay.mjs`. Re-run with
`pnpm --filter bench dom-overlay -- --label=<name>`; raw numbers are in
`apps/bench/results/dom-overlay-*.json`._

[BENCHMARK.md](BENCHMARK.md) measures the built-in shapes, which the GPU draws.
This one measures the other half: an app's own `ShapeUtil.component` shapes,
rendered as React DOM in the overlay — which is every shape on a product board.

## Summary

- **Remounts at the viewport edge are gone.** A zoom in and back out remounted
  44–66 cards; it now remounts none. A pan out and back mounted every card
  twice; now each card mounts once (the 56–64 mounts left are cards seen for the
  first time) and none unmounts.
- **A drag no longer re-renders the dragged card's body**: 53 renders over 60
  frames → 0.
- **A camera move with grid mode off is no React commit at all** for the
  non-cullable cards (60–120 commits per gesture → 0), and 70–150 → 9–30 for
  the cullable ones, where what is left is cards entering the overlay. With grid
  mode on (mocanvas's default) the grid still re-renders once per frame; it is
  handed the camera as props.
- **Main-thread time moves less than the counts.** p95 per frame drops on every
  zoom and pan row, by 4–54% (N=200 zoom: 32.8 → 15.1 ms); p50 by up to 9 ms,
  mostly 0–2 ms. At 1,000 mounted cards the cost is not React: see
  [What is left](#what-is-left).

## Method

| | |
| :--- | :--- |
| Machine | Apple M5 Pro, 18 cores, 64 GB, Darwin 27.2.0 |
| Browser | headless Chromium 151.0.7922.34 (Playwright), hardware ANGLE Metal |
| Build | production `vite build` of `apps/bench` |
| Viewport | 1200×800 CSS px, device scale 1 |
| Baseline | `3496c64` — origin/main `3a87026` plus this benchmark, no engine change |
| After | the same plus the overlay changes in this branch |
| Repeats | 3, medians reported; fresh page per (N, kind, gesture, repeat) |

**The card** (`apps/bench/src/dom-card.tsx`) is a 280×200 `ShapeUtil.component`
of ~150 DOM nodes on a 320×240 grid. `dom` lets the renderer cull it; `dom-live`
returns `canCull() === false`, so every card on the page stays mounted.

**The gestures**, each one input per animation frame, starting from a camera set
before the shapes are created:

| gesture | input | start |
| :--- | :--- | :--- |
| zoom | 30 ctrl+wheel `deltaY −5`, then 30 × `+5`, dispatched in the page | board centre, zoom 0.5 |
| pan | 60 wheel `deltaX +20`, then 60 × `−20`, dispatched in the page | board's left edge, zoom 0.5 |
| drag | Playwright `mouse.down`, 60 × `mouse.move`, `mouse.up` | the centre card, zoom 1 |
| hover | 60 × Playwright `mouse.move` across the viewport | board centre, zoom 0.5 |

**The metrics.** *main p50/p95*: busy time of the renderer main thread per
frame — top-level `RunTask`s in a Chromium trace, summed between consecutive
`BeginMainThreadFrame`s. Not rAF deltas, which floor at the 8.3 ms cadence.
Real-mouse gestures include the CDP round trip that paces them, so their
sub-millisecond p50s are noise. *style / layout ms/step*: CDP
`Performance.getMetrics` deltas over the gesture, per input. *commits*: React
commits, counted by a stub DevTools hook. *mounts / unmounts / renders*: the
card's own counters. *LoAF*: Long Animation Frames over 50 ms.

## Before and after

Grid mode at its default (on in mocanvas). `before → after`:

| N | kind | gesture | main p50 ms | main p95 ms | style ms/step | commits | mounts | unmounts | renders |
| --: | :-- | :-- | --: | --: | --: | --: | --: | --: | --: |
| 50 | dom | zoom | 5.70 → 5.65 | 19.73 → 16.29 | 1.95 → 2.06 | 70 → 70 | 44 → 0 | 44 → 0 | 44 → 0 |
| 50 | dom | pan | 6.25 → 5.89 | 12.78 → 10.21 | 0.09 → 0.07 | 134 → 134 | 44 → 0 | 44 → 0 | 44 → 0 |
| 50 | dom | drag | 0.42 → 0.77 | 3.48 → 3.40 | 0.11 → 0.11 | 57 → 57 | 0 → 0 | 0 → 0 | 53 → 0 |
| 50 | dom | hover | 0.35 → 0.26 | 3.96 → 2.52 | 0.00 → 0.00 | 60 → 60 | 0 → 0 | 0 → 0 | 0 → 0 |
| 50 | dom-live | zoom | 11.16 → 8.07 | 21.15 → 14.12 | 5.30 → 3.65 | 60 → 60 | 0 → 0 | 0 → 0 | 0 → 0 |
| 50 | dom-live | pan | 7.89 → 5.83 | 16.49 → 9.23 | 0.05 → 0.04 | 120 → 120 | 0 → 0 | 0 → 0 | 0 → 0 |
| 50 | dom-live | drag | 0.41 → 0.45 | 5.14 → 4.60 | 0.22 → 0.17 | 57 → 57 | 0 → 0 | 0 → 0 | 53 → 0 |
| 50 | dom-live | hover | 0.32 → 1.01 | 3.12 → 2.54 | 0.00 → 0.00 | 60 → 60 | 0 → 0 | 0 → 0 | 0 → 0 |
| 200 | dom | zoom | 7.47 → 5.67 | 32.84 → 15.13 | 2.76 → 2.10 | 69 → 69 | 66 → 0 | 66 → 0 | 66 → 0 |
| 200 | dom | pan | 13.55 → 11.38 | 24.53 → 19.60 | 0.20 → 0.21 | 148 → 148 | 112 → 56 | 112 → 0 | 112 → 56 |
| 200 | dom | drag | 0.42 → 0.87 | 4.69 → 4.45 | 0.11 → 0.10 | 57 → 57 | 0 → 0 | 0 → 0 | 53 → 0 |
| 200 | dom | hover | 0.30 → 0.32 | 4.58 → 3.89 | 0.00 → 0.00 | 60 → 60 | 0 → 0 | 0 → 0 | 0 → 0 |
| 200 | dom-live | zoom | 31.07 → 22.83 | 49.23 → 30.97 | 18.85 → 13.87 | 60 → 60 | 0 → 0 | 0 → 0 | 0 → 0 |
| 200 | dom-live | pan | 16.72 → 14.88 | 19.74 → 17.69 | 0.06 → 0.05 | 120 → 120 | 0 → 0 | 0 → 0 | 0 → 0 |
| 200 | dom-live | drag | 0.47 → 0.46 | 9.25 → 9.07 | 0.55 → 0.55 | 57 → 57 | 0 → 0 | 0 → 0 | 53 → 0 |
| 200 | dom-live | hover | 0.29 → 0.27 | 6.76 → 6.38 | 0.00 → 0.00 | 60 → 60 | 0 → 0 | 0 → 0 | 0 → 0 |
| 1000 | dom | zoom | 5.80 → 5.45 | 22.79 → 18.35 | 2.19 → 2.03 | 70 → 70 | 60 → 0 | 60 → 0 | 60 → 0 |
| 1000 | dom | pan | 13.35 → 11.64 | 24.08 → 19.91 | 0.20 → 0.24 | 150 → 150 | 120 → 64 | 120 → 0 | 120 → 64 |
| 1000 | dom | drag | 0.46 → 0.42 | 25.09 → 24.54 | 0.11 → 0.11 | 57 → 57 | 0 → 0 | 0 → 0 | 53 → 0 |
| 1000 | dom | hover | 0.90 → 0.40 | 18.71 → 17.63 | 0.00 → 0.00 | 60 → 60 | 0 → 0 | 0 → 0 | 0 → 0 |
| 1000 | dom-live | zoom | 111.76 → 102.61 | 160.21 → 138.06 | 71.12 → 67.42 | 60 → 60 | 0 → 0 | 0 → 0 | 0 → 0 |
| 1000 | dom-live | pan | 43.78 → 41.80 | 49.38 → 47.53 | 0.17 → 0.10 | 120 → 120 | 0 → 0 | 0 → 0 | 0 → 0 |
| 1000 | dom-live | drag | 0.50 → 0.45 | 53.41 → 51.57 | 2.72 → 2.62 | 57 → 57 | 0 → 0 | 0 → 0 | 53 → 0 |
| 1000 | dom-live | hover | 0.78 → 0.44 | 39.48 → 38.36 | 0.00 → 0.00 | 60 → 60 | 0 → 0 | 0 → 0 | 0 → 0 |

Grid mode off (`--grid=off`), zoom and pan only:

| N | kind | gesture | main p50 ms | main p95 ms | style ms/step | commits | mounts | unmounts | renders |
| --: | :-- | :-- | --: | --: | --: | --: | --: | --: | --: |
| 200 | dom | zoom | 5.02 → 5.33 | 18.94 → 16.22 | 2.11 → 2.17 | 69 → 9 | 66 → 0 | 66 → 0 | 66 → 0 |
| 200 | dom | pan | 11.30 → 11.89 | 20.99 → 20.18 | 0.17 → 0.22 | 148 → 28 | 112 → 56 | 112 → 0 | 112 → 56 |
| 200 | dom-live | zoom | 29.09 → 27.68 | 52.34 → 48.11 | 17.59 → 18.88 | 60 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| 200 | dom-live | pan | 17.09 → 14.51 | 22.69 → 17.91 | 0.06 → 0.04 | 120 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| 1000 | dom | zoom | 5.89 → 4.88 | 28.32 → 18.59 | 2.27 → 2.05 | 70 → 10 | 60 → 0 | 60 → 0 | 60 → 0 |
| 1000 | dom | pan | 13.47 → 11.37 | 24.45 → 19.62 | 0.21 → 0.23 | 150 → 30 | 120 → 64 | 120 → 0 | 120 → 64 |
| 1000 | dom-live | zoom | 123.79 → 98.71 | 260.10 → 136.40 | 86.53 → 66.03 | 60 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| 1000 | dom-live | pan | 45.88 → 39.60 | 81.93 → 44.29 | 0.18 → 0.08 | 120 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |

The baseline for the grid-off table ran the same bundle as the main baseline;
the tree is marked dirty only because the driver script gained the `--grid`
flag.

## Baseline, with tldraw 5.4 for reference

tldraw is driven through the same page API with the same card. Its wheel zoom
step differs from mocanvas's, so its zoom rows are not the same gesture.

| lib | N | kind | gesture | main p50 ms | main p95 ms | style ms/step | layout ms/step | commits | mounts | unmounts | renders | LoAF |
| :-- | --: | :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| mocanvas | 50 | dom | zoom | 5.70 | 19.73 | 1.95 | 0.44 | 70 | 44 | 44 | 44 | 0 |
| mocanvas | 50 | dom | pan | 6.25 | 12.78 | 0.09 | 0.22 | 134 | 44 | 44 | 44 | 0 |
| mocanvas | 50 | dom | drag | 0.42 | 3.48 | 0.11 | 0.00 | 57 | 0 | 0 | 53 | 0 |
| mocanvas | 50 | dom | hover | 0.35 | 3.96 | 0.00 | 0.00 | 60 | 0 | 0 | 0 | 0 |
| mocanvas | 50 | dom-live | zoom | 11.16 | 21.15 | 5.30 | 0.04 | 60 | 0 | 0 | 0 | 1 |
| mocanvas | 50 | dom-live | pan | 7.89 | 16.49 | 0.05 | 0.00 | 120 | 0 | 0 | 0 | 0 |
| mocanvas | 50 | dom-live | drag | 0.41 | 5.14 | 0.22 | 0.00 | 57 | 0 | 0 | 53 | 0 |
| mocanvas | 50 | dom-live | hover | 0.32 | 3.12 | 0.00 | 0.00 | 60 | 0 | 0 | 0 | 0 |
| mocanvas | 200 | dom | zoom | 7.47 | 32.84 | 2.76 | 1.05 | 69 | 66 | 66 | 66 | 0 |
| mocanvas | 200 | dom | pan | 13.55 | 24.53 | 0.20 | 0.72 | 148 | 112 | 112 | 112 | 1 |
| mocanvas | 200 | dom | drag | 0.42 | 4.69 | 0.11 | 0.00 | 57 | 0 | 0 | 53 | 0 |
| mocanvas | 200 | dom | hover | 0.30 | 4.58 | 0.00 | 0.00 | 60 | 0 | 0 | 0 | 1 |
| mocanvas | 200 | dom-live | zoom | 31.07 | 49.23 | 18.85 | 0.05 | 60 | 0 | 0 | 0 | 1 |
| mocanvas | 200 | dom-live | pan | 16.72 | 19.74 | 0.06 | 0.00 | 120 | 0 | 0 | 0 | 0 |
| mocanvas | 200 | dom-live | drag | 0.47 | 9.25 | 0.55 | 0.00 | 57 | 0 | 0 | 53 | 0 |
| mocanvas | 200 | dom-live | hover | 0.29 | 6.76 | 0.00 | 0.00 | 60 | 0 | 0 | 0 | 0 |
| mocanvas | 1000 | dom | zoom | 5.80 | 22.79 | 2.19 | 0.60 | 70 | 60 | 60 | 60 | 0 |
| mocanvas | 1000 | dom | pan | 13.35 | 24.08 | 0.20 | 0.65 | 150 | 120 | 120 | 120 | 0 |
| mocanvas | 1000 | dom | drag | 0.46 | 25.09 | 0.11 | 0.00 | 57 | 0 | 0 | 53 | 0 |
| mocanvas | 1000 | dom | hover | 0.90 | 18.71 | 0.00 | 0.00 | 60 | 0 | 0 | 0 | 0 |
| mocanvas | 1000 | dom-live | zoom | 111.76 | 160.21 | 71.12 | 0.12 | 60 | 0 | 0 | 0 | 59 |
| mocanvas | 1000 | dom-live | pan | 43.78 | 49.38 | 0.17 | 0.00 | 120 | 0 | 0 | 0 | 0 |
| mocanvas | 1000 | dom-live | drag | 0.50 | 53.41 | 2.72 | 0.00 | 57 | 0 | 0 | 53 | 3 |
| mocanvas | 1000 | dom-live | hover | 0.78 | 39.48 | 0.00 | 0.00 | 60 | 0 | 0 | 0 | 1 |
| tldraw | 50 | dom | zoom | 4.46 | 13.15 | 2.27 | 0.41 | 2 | 0 | 0 | 0 | 0 |
| tldraw | 50 | dom | pan | 4.33 | 8.30 | 0.15 | 0.22 | 2 | 0 | 0 | 0 | 0 |
| tldraw | 50 | dom | drag | 0.72 | 2.60 | 0.28 | 0.00 | 60 | 0 | 0 | 0 | 0 |
| tldraw | 50 | dom | hover | 0.44 | 2.26 | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 0 |
| tldraw | 50 | dom-live | zoom | 7.66 | 14.26 | 4.16 | 0.01 | 2 | 0 | 0 | 0 | 0 |
| tldraw | 50 | dom-live | pan | 5.07 | 10.01 | 0.05 | 0.00 | 2 | 0 | 0 | 0 | 0 |
| tldraw | 50 | dom-live | drag | 0.50 | 3.01 | 0.58 | 0.00 | 60 | 0 | 0 | 0 | 0 |
| tldraw | 50 | dom-live | hover | 0.34 | 2.47 | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 1 |
| tldraw | 200 | dom | zoom | 7.34 | 21.51 | 3.68 | 0.77 | 4 | 0 | 0 | 0 | 2 |
| tldraw | 200 | dom | pan | 10.72 | 21.59 | 0.44 | 0.87 | 2 | 0 | 0 | 0 | 1 |
| tldraw | 200 | dom | drag | 0.54 | 5.75 | 0.81 | 0.00 | 60 | 0 | 0 | 0 | 0 |
| tldraw | 200 | dom | hover | 0.46 | 3.39 | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 0 |
| tldraw | 200 | dom-live | zoom | 20.89 | 29.44 | 15.79 | 0.02 | 2 | 0 | 0 | 0 | 0 |
| tldraw | 200 | dom-live | pan | 10.21 | 13.02 | 0.07 | 0.01 | 2 | 0 | 0 | 0 | 0 |
| tldraw | 200 | dom-live | drag | 0.51 | 5.36 | 1.87 | 0.00 | 60 | 0 | 0 | 0 | 2 |
| tldraw | 200 | dom-live | hover | 0.36 | 7.14 | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 0 |
| tldraw | 1000 | dom | zoom | 4.97 | 46.85 | 3.03 | 1.33 | 6 | 0 | 0 | 0 | 3 |
| tldraw | 1000 | dom | pan | 9.46 | 16.55 | 0.45 | 0.71 | 2 | 0 | 0 | 0 | 0 |
| tldraw | 1000 | dom | drag | 0.56 | 4.62 | 0.34 | 0.00 | 60 | 0 | 0 | 0 | 0 |
| tldraw | 1000 | dom | hover | 0.40 | 2.81 | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 0 |
| tldraw | 1000 | dom-live | zoom | 108.88 | 140.81 | 75.90 | 2.59 | 60 | 0 | 0 | 0 | 60 |
| tldraw | 1000 | dom-live | pan | 22.71 | 26.66 | 0.21 | 0.04 | 2 | 0 | 0 | 0 | 0 |
| tldraw | 1000 | dom-live | drag | 0.52 | 13.29 | 8.56 | 0.00 | 60 | 0 | 0 | 0 | 3 |
| tldraw | 1000 | dom-live | hover | 0.28 | 23.09 | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 0 |

## What is left

**The zoom custom properties dominated a zoom over many mounted shapes** until
4.15.0, and the section below is kept as the measurement that led to the fix.
The canvas publishes `--mocanvas-zoom` and `--mocanvas-scale` on its container,
and a changed inherited custom property restyles every descendant. The overlay
now declares the two itself, so the walk stops there; a shape whose util says
`usesCameraCssVars()` gets the live values on its own wrapper. Re-measured on an
M5 Pro, `--n=200,1000 --kinds=dom-live --gestures=zoom --repeats=2 --grid=off`:

| N | style ms/step before | after | every card opted in |
| --: | --: | --: | --: |
| 200 | 8.61 | 0.07 | 9.04 |
| 1,000 | 40.92 | 0.09 | 43.74 |

Main-thread p50 at 1,000 goes 64.5 → 24.3 ms and the 57 long animation frames
go to none. The third column is the cost of the hook: a board where every card
asks for the variables pays what it paid before, so it is worth naming only the
shapes that truly counter-scale. Registering the two with `@property`
(`syntax: "<number>"`) was measured first and changed nothing (41.79 ms/step). An experiment
with the two writes disabled (not shipped, one repeat, grid off):

| N | kind | zoom: main p50 | style ms/step |
| --: | :-- | --: | --: |
| 200 | dom-live | 27.7 → 8.6 ms | 18.9 → 0.04 |
| 1,000 | dom-live | 98.7 → 31.4 ms | 66.0 → 0.07 |
| 1,000 | dom | 4.9 → 3.7 ms | 2.1 → 0.1 |

tldraw pays the same (76 ms/step at 1,000 `dom-live` cards) for its own
`--tl-zoom`. The variables are public API — `@mocanvas/compat` maps `--tl-scale`
onto them and apps counter-scale labels with them — so removing them is not an
option; publishing them debounced, or only to shapes that ask, would be. Cullable
cards barely pay it: retained ones sit under `content-visibility: hidden`, which
skips their style.

**Panning 1,000 mounted cards costs ~40 ms a frame**, against ~22 ms for tldraw,
with no React work and no style recalc on either side. That is the browser
compositing and painting a 150,000-node layer; it is a candidate for
`content-visibility: auto` on off-screen kept shapes, not measured here.

**Hit-testing on hover (H5)** was measured wrong here: p50 is floored by the idle
frames of a real-mouse gesture. It was the hover cost — see
[Drag and hover](#drag-and-hover).

## Drag and hover

_Measured 2026-11-13, interleaved: `--builds=main=<4.16.0 build>,branch=.`,
5 repeats per configuration (pan/zoom: 3), alternating page by page. Raw:
`results/dom-overlay-drag-hover-interleaved.json`,
`results/dom-overlay-panzoom-interleaved.json`, noise floor
`results/dom-overlay-noise-floor.json`._

**Noise floor.** The same build under two names, interleaved: medians differ by
0.0–0.9 ms per step and 0.0–0.6 ms of p95. Every change below is larger than
that, and no before/after range overlaps.

**Causes, from a CPU profile of a drag step on 1,000 cards and the `--why`
attribution:**

- `getCurrentPageShapesSorted()` sorted each parent's children by filtering
  every shape on the page — N² — and ran three times per step: the pointer hit
  test, the drop-target search, and the overlay's kept set. ~10 ms of the
  ~11 ms of script per step at 1,000 shapes.
- H5: the `hitInside` hit test the canvas runs on every pointer move scanned the
  whole page (4.0 ms per call at 1,000 against 0.003 ms for the engine query),
  and over empty canvas ran twice.
- Hover commits: the idle select tool wrote a new cursor object on every move,
  and the current page id was read off the instance record, so every reader of
  the page — the overlay layer, the indicators — re-rendered per move.
- H4 refuted for the body (already 0 renders since #20); confirmed for the
  layer: reading every shape record made the overlay layer re-render, and walk
  every mounted shape, on each drag step, plus the dragged shape's wrapper.

`main → branch`, median [min–max]; main ms/step is main-thread busy time per
input:

| N | kind | gesture | main ms/step | main p95 ms | commits |
| --: | :-- | :-- | --: | --: | --: |
| 200 | dom | drag | 4.28 [3.99–4.70] → 3.11 [3.04–3.36] | 4.02 → 2.75 | 63 → 2 |
| 200 | dom | hover | 3.82 [3.74–3.83] → 2.41 [2.38–2.50] | 3.80 → 2.44 | 60 → 0 |
| 200 | dom-live | drag | 11.25 [11.04–11.44] → 9.81 [9.69–9.83] | 8.99 → 7.71 | 63 → 2 |
| 200 | dom-live | hover | 6.69 [6.37–6.88] → 5.01 [4.73–5.31] | 7.14 → 5.09 | 60 → 0 |
| 1000 | dom | drag | 12.55 [12.21–13.11] → 3.45 [3.32–3.54] | 24.13 → 3.14 | 63 → 2 |
| 1000 | dom | hover | 11.53 [10.02–11.64] → 2.09 [1.97–2.17] | 17.60 → 2.11 | 60 → 0 |
| 1000 | dom-live | drag | 46.31 [43.77–54.56] → 36.15 [35.30–36.73] | 51.84 → 28.95 | 63 → 2 |
| 1000 | dom-live | hover | 26.59 [23.73–30.11] → 17.73 [16.91–21.97] | 29.92 → 17.52 | 60 → 0 |

The two drag commits left are the press and the release changing the
selection. Pan and zoom are unchanged within the noise at both N. tldraw 5.4 in
the noise-floor run, for reference: drag 3.84 ms/step (`dom`) and 19.48
(`dom-live`) at 1,000; hover 2.78 and 14.88.

**What is left.** A drag over 1,000 *mounted* cards still costs ~36 ms a step,
of which ~1 ms is script: the rest is the browser restyling, laying out and
painting a 150,000-node layer, as on a pan. That is the same paint cost listed
above, not fixed here.
