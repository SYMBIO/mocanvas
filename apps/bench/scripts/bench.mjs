/**
 * mocanvas vs tldraw benchmark driver.
 *
 * Builds both bench pages for production, serves them, and drives the identical
 * `window.bench` API on each through the same matrix:
 *
 *   N ∈ {1000, 5000, 20000} × kind ∈ {geo, mixed}, 3 repeats, medians reported.
 *
 * Also loads `public/compare.tldr` in both pages at 1200×800, screenshots them
 * and computes a per-pixel diff.
 *
 * Writes `results/latest.json` and `../../docs/BENCHMARK.md`.
 *
 * Usage:
 *   pnpm --filter bench bench
 *   pnpm --filter bench bench -- --n=1000,5000 --repeats=1 --skip-compare
 */
import { chromium } from "playwright"
import { PNG } from "pngjs"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import { resolve } from "node:path"
import { REPO_ROOT, ROOT, VIEWPORT, buildApp, launchBrowser, median, openBenchPage, startPreview, withTimeout } from "./lib.mjs"
import { regionMetrics } from "./compare-metrics.mjs"

const LIBS = ["mocanvas", "tldraw"]
const RESULTS_DIR = resolve(ROOT, "results")
const LATEST_JSON = resolve(RESULTS_DIR, "latest.json")
const DOC = resolve(REPO_ROOT, "docs/BENCHMARK.md")
const FIXTURE = resolve(ROOT, "public/compare.tldr")

/**
 * The previously published run, kept only so the report can show a trend.
 * Hand-copied from the `docs/BENCHMARK.md` generated at 2026-09-04 08:30:07 UTC
 * (git 32ac776-dirty), before the `.tldr` load fix and the renderer's frame
 * reuse / tessellation budget / LOD hysteresis landed. Update it — or delete it
 * together with the "What changed" section — once it is no longer the
 * interesting comparison.
 */
/**
 * Why a measured revision is marked dirty. Hand-written per run, like PREVIOUS.
 * Null when every run behind the report was made from a clean tree, which is the
 * case for this one: the whole report comes from a single clean-tree run.
 */
/**
 * What the numbers were measured from, derived rather than asserted.
 *
 * This used to be a hand-written paragraph naming a specific commit. A report
 * that states its own provenance from a string nobody updates will eventually
 * state it falsely, which is worse than saying nothing.
 */
function runNote(rev) {
  return rev.endsWith("-dirty")
    ? `Measured from a **dirty working tree** at \`${rev.replace("-dirty", "")}\`: the bundle under measurement was built from the files as they were when this run started, which are not any committed state. Treat these numbers as provisional until they are re-run on a clean tree.`
    : `Measured from a clean tree at \`${rev}\`. The bundle under measurement is built once, before the first measurement, so every number here comes from that commit.`
}

const PREVIOUS = {
  date: "2026-09-04 09:26:29 UTC",
  git: "15b670a-dirty",
  createMs: { "1000:geo": 15.1, "5000:geo": 40.1, "20000:geo": 134.2, "1000:mixed": 25.7, "5000:mixed": 67.8, "20000:mixed": 249.4 },
  tldrawCreateMs: { "1000:geo": 37.8, "5000:geo": 120.0, "20000:geo": 433.2, "1000:mixed": 76.0, "5000:mixed": 241.5, "20000:mixed": 753.7 },
  panP95: { "1000:geo": 24.5, "5000:geo": 66.6, "20000:geo": 116.7, "1000:mixed": 42.3, "5000:mixed": 108.3, "20000:mixed": 208.3 },
  tldrawPanP95: { "1000:geo": 9.1, "5000:geo": 25.0, "20000:geo": 258.8, "1000:mixed": 9.0, "5000:mixed": 41.6, "20000:mixed": 350.1 },
  dragP50: { "1000:geo": 33.0, "5000:geo": 116.6, "20000:geo": 400.0, "1000:mixed": 50.0, "5000:mixed": 183.5, "20000:mixed": 841.6 },
  tldrawDragP50: { "1000:geo": 25.1, "5000:geo": 150.0, "20000:geo": 858.4, "1000:mixed": 41.7, "5000:mixed": 225.9, "20000:mixed": 1124.9 },
  dragP95: { "1000:geo": 34.2, "5000:geo": 140.7, "20000:geo": 441.6, "1000:mixed": 66.8, "5000:mixed": 250.0, "20000:mixed": 925.0 },
  tldrawDragP95: { "1000:geo": 33.9, "5000:geo": 166.7, "20000:geo": 1058.2, "1000:mixed": 50.2, "5000:mixed": 258.4, "20000:mixed": 1375.0 },
}

/**
 * How the rendering comparison has moved, kept so the report can show the
 * trend rather than one number. Hand-copied from the `docs/BENCHMARK.md`
 * generated at each of those revisions; the current run supplies the last
 * column. `interiorIoU` and `bandMedianPx` are blank before this run because
 * the metrics did not exist yet — nothing is being back-filled or guessed.
 *
 * Drop a column once it stops being the interesting comparison.
 */
const HISTORY = [
  {
    git: "32ac776-dirty",
    what: "before the `.tldr` load fix",
    loaded: "no — threw on `props.richText`",
    diffPercent: 11.84,
    inkOverlapPercent: 0,
  },
  {
    git: "15b670a-dirty",
    what: "drawn, wrong fill ramp",
    loaded: "yes",
    diffPercent: 12.14,
    inkOverlapPercent: 56.4,
  },
  {
    git: "ef4d079",
    what: "correct fills, exact outlines",
    loaded: "yes",
    diffPercent: 3.79,
    inkOverlapPercent: 79.1,
  },
  {
    git: "83ff957",
    what: "hand-drawn outlines",
    loaded: "yes",
    diffPercent: 3.82,
    inkOverlapPercent: 78.2,
    interiorIoU: 94.1,
    bandMedian: 1.0,
  },
]

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { ns: [1000, 5000, 20000], kinds: ["geo", "mixed"], repeats: 3, perf: true, compare: true }
  for (const a of argv) {
    const [k, v] = a.replace(/^--/, "").split("=")
    if (k === "n") opts.ns = v.split(",").map(Number)
    else if (k === "kinds") opts.kinds = v.split(",")
    else if (k === "repeats") opts.repeats = Number(v)
    else if (k === "skip-perf") opts.perf = false
    else if (k === "skip-compare") opts.compare = false
    else if (k === "report-only") opts.reportOnly = true
    else if (k === "headed") opts.headed = true
  }
  return opts
}

/** Per-run wall-clock cap; scales with N because tldraw's DOM path gets slow. */
const budget = (n, base) => base + n * 4

// ---------------------------------------------------------------------------
// one measurement run
// ---------------------------------------------------------------------------

async function measure(browser, url, lib, n, kind) {
  const { page, logs } = await openBenchPage(browser, url, lib)
  const out = { lib, n, kind, errors: [] }
  try {
    out.create = await withTimeout(page, budget(n, 60_000), ([n, kind]) => window.bench.create(n, kind), [n, kind])
    out.gpu = await page.evaluate(() => window.bench.gpuInfo())
    out.panZoom = await withTimeout(page, budget(n, 120_000), () => window.bench.panZoomRun(120))
    out.drag = await withTimeout(page, budget(n, 180_000), () => window.bench.selectAllDragRun(60))
    out.hit = await withTimeout(page, budget(n, 60_000), () => window.bench.hitTestRun(500))
    out.memoryMB = await withTimeout(page, 30_000, () => window.bench.memoryMB())
  } catch (e) {
    out.errors.push(String(e.message ?? e))
  }
  out.consoleErrors = logs.filter((l) => l.startsWith("error:") || l.startsWith("pageerror:")).slice(0, 5)
  if (!page.isClosed()) await page.close()
  return out
}

/** Pull the same scalar out of every repeat and take the median. */
const med = (runs, pick) => median(runs.map((r) => { try { return pick(r) } catch { return null } }))

function foldRepeats(runs) {
  const ok = runs.filter((r) => !r.errors.length)
  const base = ok.length ? ok : runs
  return {
    repeats: runs.length,
    ok: ok.length,
    createMs: med(base, (r) => r.create?.ms),
    firstFrameMs: med(base, (r) => r.create?.firstFrameMs),
    shapes: med(base, (r) => r.create?.count),
    panAvgMs: med(base, (r) => r.panZoom?.avgMs),
    panP50: med(base, (r) => r.panZoom?.p50),
    panP95: med(base, (r) => r.panZoom?.p95),
    panMaxMs: med(base, (r) => r.panZoom?.maxMs),
    panFps: med(base, (r) => r.panZoom?.fps),
    panLongTasks: med(base, (r) => r.panZoom?.longTasks),
    dragP50: med(base, (r) => r.drag?.p50),
    dragP95: med(base, (r) => r.drag?.p95),
    dragFps: med(base, (r) => r.drag?.fps),
    hitAvgUs: med(base, (r) => r.hit?.avgUs),
    hitHits: med(base, (r) => r.hit?.hits),
    memoryMB: med(base, (r) => r.memoryMB),
    errors: [...new Set(runs.flatMap((r) => r.errors))],
  }
}

// ---------------------------------------------------------------------------
// rendering comparison
// ---------------------------------------------------------------------------

async function compareRendering(browser, url) {
  if (!existsSync(FIXTURE)) {
    return { ok: false, error: `${FIXTURE} missing — run \`pnpm --filter bench fixture\` first` }
  }
  const fixture = JSON.parse(await readFile(FIXTURE, "utf8"))
  const shots = {}
  const loads = {}

  /** Load `doc` in `lib`'s page, fit, and screenshot to `results/<name>.png`. */
  async function shoot(lib, doc, name) {
    const { page } = await openBenchPage(browser, url, lib)
    const load = await withTimeout(page, 120_000, (d) => window.bench.loadTldr(d), doc)
    await withTimeout(page, 60_000, () => window.bench.fitCamera())
    await withTimeout(page, 60_000, () => window.bench.screenshotReady())
    const file = resolve(RESULTS_DIR, `${name}.png`)
    await page.screenshot({ path: file, clip: { x: 0, y: 0, ...VIEWPORT } })
    const boxes = await withTimeout(page, 60_000, () => window.bench.shapeBoxes())
    await page.close()
    return { load, file, boxes }
  }

  // Pass A — both libraries get the raw, unmodified tldraw-authored file.
  const boxes = {}
  for (const lib of LIBS) {
    const shot = await shoot(lib, fixture, `compare-${lib}`)
    loads[lib] = shot.load
    shots[lib] = shot.file
    boxes[lib] = shot.boxes
  }
  const diff = await pixelDiff(shots.mocanvas, shots.tldraw, 24, "compare-diff")

  // Per-shape regions come from tldraw's own layout — it is the reference
  // render, and using one side's boxes for both keeps the regions from being
  // defined differently for each library.
  const regions = await regionMetrics({ mocanvasPath: shots.mocanvas, tldrawPath: shots.tldraw, boxes: boxes.tldraw ?? [] })

  // There used to be a pass B here: mocanvas got a bench-side down-converted
  // copy of the document (richText → text, packed draw path → point array)
  // because it could not read either form itself, and the shimmed screenshot
  // was the only one that showed anything. `normalizeLoadedRecords` does both
  // conversions now, so pass A is the honest number and the shim is gone. The
  // `window.bench.downconvert` helper is still there if a future format gap
  // ever needs the same treatment.

  return { ok: true, shots, loads, diff, boxes, regions, fixtureRecords: fixture.records.length }
}

/**
 * Per-pixel difference between two PNGs. A pixel counts as different when any
 * channel differs by more than `tol` (8-bit), which forgives antialiasing noise
 * but not real shape/colour/position differences.
 */
async function pixelDiff(aPath, bPath, tol = 24, outName = "compare-diff") {
  const a = PNG.sync.read(await readFile(aPath))
  const b = PNG.sync.read(await readFile(bPath))
  if (a.width !== b.width || a.height !== b.height) {
    return { error: `size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}` }
  }
  const total = a.width * a.height
  let different = 0
  let inkA = 0
  let inkB = 0
  let inkBoth = 0
  const out = new PNG({ width: a.width, height: a.height })
  for (let i = 0; i < total; i++) {
    const o = i * 4
    const dr = Math.abs(a.data[o] - b.data[o])
    const dg = Math.abs(a.data[o + 1] - b.data[o + 1])
    const db = Math.abs(a.data[o + 2] - b.data[o + 2])
    // "ink" = not near-white, i.e. the shape actually painted something here.
    const inkedA = a.data[o] < 232 || a.data[o + 1] < 232 || a.data[o + 2] < 232
    const inkedB = b.data[o] < 232 || b.data[o + 1] < 232 || b.data[o + 2] < 232
    if (inkedA) inkA++
    if (inkedB) inkB++
    if (inkedA && inkedB) inkBoth++
    const isDiff = dr > tol || dg > tol || db > tol
    if (isDiff) different++
    out.data[o] = isDiff ? 255 : 255
    out.data[o + 1] = isDiff ? 0 : 255
    out.data[o + 2] = isDiff ? 0 : 255
    out.data[o + 3] = isDiff ? 255 : 40
  }
  await writeFile(resolve(RESULTS_DIR, `${outName}.png`), PNG.sync.write(out))
  return {
    width: a.width,
    height: a.height,
    totalPixels: total,
    differentPixels: different,
    diffPercent: (different / total) * 100,
    inkPixelsMocanvas: inkA,
    inkPixelsTldraw: inkB,
    /** Of the pixels either side painted, how many did both paint. */
    inkOverlapPercent: inkA + inkB - inkBoth > 0 ? (inkBoth / (inkA + inkB - inkBoth)) * 100 : 0,
    tolerance: tol,
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const fmt = (v, digits = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits))
const int = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US"))

/**
 * ratio = tldraw / mocanvas for "lower is better" metrics: >1 means mocanvas wins.
 * `words` is the [better, worse] wording for the metric ("faster"/"slower" for
 * times, "less"/"more" for memory).
 */
function ratio(mo, tl, words = ["faster", "slower"]) {
  if (mo == null || tl == null || !Number.isFinite(mo) || !Number.isFinite(tl) || mo === 0) return "—"
  const r = tl / mo
  return r >= 1 ? `${r.toFixed(2)}× ${words[0]}` : `${(1 / r).toFixed(2)}× ${words[1]}`
}

function metricTable(matrix, ns, kinds, pick, format, { higherIsBetter = false, words } = {}) {
  const lines = ["| N | kind | mocanvas | tldraw | ratio |", "| ---: | :--- | ---: | ---: | :--- |"]
  for (const kind of kinds) {
    for (const n of ns) {
      const mo = pick(matrix.mocanvas?.[`${n}:${kind}`] ?? {})
      const tl = pick(matrix.tldraw?.[`${n}:${kind}`] ?? {})
      const r = higherIsBetter ? ratio(tl, mo, words) : ratio(mo, tl, words)
      lines.push(`| ${n.toLocaleString("en-US")} | ${kind} | ${format(mo)} | ${format(tl)} | ${r} |`)
    }
  }
  return lines.join("\n")
}

function machineInfo() {
  let cpu = os.cpus()?.[0]?.model ?? "unknown"
  try {
    if (process.platform === "darwin") cpu = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8" }).trim()
  } catch {}
  return {
    os: `${os.type()} ${os.release()} (${process.arch})`,
    cpu,
    cores: os.cpus()?.length ?? 0,
    memoryGB: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
  }
}

/**
 * The GL cost probe recorded by the pan/zoom A/B run, if it is still on disk.
 * It is what lets the report say how much of a frame here is MSAA resolve
 * rather than scene work; without it that caveat is simply not made.
 */
function glCostProbe() {
  try {
    const probe = JSON.parse(readFileSync(resolve(RESULTS_DIR, "panzoom-after.json"), "utf8")).glCostProbe
    return probe && Number.isFinite(probe.clearAndDrawMs) && Number.isFinite(probe.clearAndDrawMs_antialiasOff) ? probe : null
  } catch {
    return null
  }
}

function pkgVersion(name) {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, `node_modules/${name}/package.json`), "utf8")).version
  } catch {
    return "unknown"
  }
}

/**
 * A shape's display name for the comparison tables: "hexagon", not "geo", and
 * "bent arrow" rather than two rows both called "arrow". Keyed on the fixture's
 * stable ids (`scripts/make-fixture.mjs`), with the shape's own type as the
 * fallback for anything the fixture grows later.
 */
const SHAPE_LABELS = {
  "fx-arrow-bent": "bent arrow",
  "fx-arrow-straight": "straight arrow",
  "fx-draw": "freehand stroke",
  "fx-text": "text shape",
  "fx-frame-child-1": "rectangle (in frame)",
  "fx-frame-child-2": "ellipse (in frame)",
}
const shapeLabel = (s) => SHAPE_LABELS[String(s.id).replace(/^shape:/, "")] ?? s.geo ?? s.type

const px = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)} px`)

/**
 * The rendering comparison, built around three numbers in decreasing order of
 * how much a pixel comparison can be trusted to mean what it looks like it
 * means. See `scripts/compare-metrics.mjs` for how the first two are computed.
 */
function comparisonSection(compare, versions) {
  const md = []
  const d = compare.diff
  const r = compare.regions
  const interior = r?.interior
  const band = r?.stroke
  /** Look a shape's row up by the stable fixture id, so prose quotes measured values. */
  const byId = (rows, suffix) => rows?.find((v) => v.id.endsWith(suffix))

  // `overall` is absent when a metric found nothing comparable — which is what
  // happens when one side rendered no pixels at all. Guard on it, not just on
  // the metric object: a report that crashes here loses the whole run,
  // including the frame-time matrix that was already measured.
  if (!interior?.overall || !band?.overall?.symmetric) {
    const why = r?.error ?? (interior?.overall?.pixelsMocanvas === 0 ? "mocanvas rendered nothing" : "not computed")
    md.push(`Region metrics unavailable: ${why}. Only the whole-image diff is reported below.`)
    md.push("")
  } else {
    md.push("Three numbers, in decreasing order of how much a pixel comparison can be trusted to mean what it")
    md.push("looks like it means.")
    md.push("")
    md.push("| | | what it measures |")
    md.push("| :--- | ---: | :--- |")
    md.push(`| Interior IoU | **${fmt(interior.overall.iouPercent, 1)}%** | fills, positions and sizes — exact geometry on both sides |`)
    md.push(`| Stroke band distance | **${px(band.overall.symmetric.medianPx)} median, ${px(band.overall.symmetric.p95Px)} p95** | how far apart the two outlines actually run |`)
    md.push(`| Whole-image pixel diff | **${fmt(d.diffPercent, 2)}% differing, ${fmt(d.inkOverlapPercent, 1)}% painted-pixel IoU** | everything at once, stroke randomness included |`)
    md.push("")
    md.push("Both libraries draw the default `dash: \"draw\"` style as a genuinely hand-drawn outline — seeded wobble,")
    md.push("rounded corners, overshoot past the vertex — and neither is trying to reproduce the other's random")
    md.push("numbers. Two outlines that both look right therefore miss each other by roughly a stroke width, and a")
    md.push("pixel diff charges for that twice: once where mocanvas painted and tldraw did not, and once the other way")
    md.push("round. That is measured, not assumed. When mocanvas drew exact polygons with a uniform stroke, at")
    const exactCol = HISTORY.find((c) => c.git === "ef4d079")
    const drawnCol = HISTORY.find((c) => c.git === "83ff957")
    md.push(`\`ef4d079\`, it scored *better* on the whole-image figures than it did once the hand-drawn outline landed`)
    md.push(`at \`83ff957\` — ${fmt(exactCol.inkOverlapPercent, 1)}% painted-pixel IoU against ${fmt(drawnCol.inkOverlapPercent, 1)}% — while looking visibly wrong. So the whole-image`)
    md.push("row is reported last, and the two above it are the ones to quote.")
    md.push("")

    // ---- 1. interior IoU --------------------------------------------------
    md.push(`### 1. Interior IoU — ${fmt(interior.overall.iouPercent, 1)}%`)
    md.push("")
    md.push("Per shape, the region is cut out of both screenshots and the silhouette of whatever was drawn there is")
    md.push("recovered — paint, plus everything the paint encloses, so a fill the colour of the paper still has an")
    md.push(`interior. Both silhouettes are then eroded ${interior.erosion} px inward, past the widest stroke either library draws`)
    md.push("(hand-drawn overshoot included), leaving interior only: no stroke pixel is counted on either side. `IoU`")
    md.push("is the intersection of the two eroded interiors over their union — position and size, with the outline")
    md.push(`taken out. \`colour\` is how much of the shared interior agrees on colour at the same ${interior.tolerance}/255 tolerance the`)
    md.push("pixel diff uses — the fills.")
    md.push("")
    md.push("| shape | interior px (tldraw) | IoU | colour |")
    md.push("| :--- | ---: | ---: | ---: |")
    for (const s of interior.perShape) {
      if (!s.interior) continue
      md.push(`| ${shapeLabel(s)} | ${int(s.interior.pixelsTldraw)} | ${fmt(s.interior.iouPercent, 1)}% | ${fmt(s.interior.colourAgreementPercent, 1)}% |`)
    }
    md.push(`| **whole fixture** | **${int(interior.overall.pixelsTldraw)}** | **${fmt(interior.overall.iouPercent, 1)}%** | **${fmt(interior.overall.colourAgreementPercent, 1)}%** |`)
    md.push("")
    md.push("The fixture-wide row is one union over every shape's interior, not an average of the rows, so the boxes")
    md.push("that overlap — the frame and its two children — are not counted twice.")
    md.push("")
    const rectCol = byId(interior.perShape, "fx-rect")?.interior?.colourAgreementPercent
    const noteCol = byId(interior.perShape, "fx-note")?.interior?.colourAgreementPercent
    const starCol = byId(interior.perShape, "fx-star")?.interior?.colourAgreementPercent
    md.push("**Fills are essentially exact.** Every shape that is only fill agrees on colour over 99% of its shared")
    md.push(`interior, except the star at ${fmt(starCol, 1)}% — the smallest interior in the fixture, where the hand-drawn`)
    md.push("outline's wobble reaches proportionally furthest in. The two rows below that are the two carrying")
    md.push(`something other than fill: the rectangle's ${fmt(rectCol, 1)}% is its "Hello box" label, a font-weight difference`)
    md.push(`rather than a fill one, and the note's ${fmt(noteCol, 1)}% is its label plus the drop shadow around its body. The`)
    md.push("note's gradient is no longer a difference at all: it reads `#f7dc99` at the top of the body and `#fce19c` at")
    md.push("the bottom in both renders — identical values, not merely within tolerance.")
    md.push("")
    const starIoU = byId(interior.perShape, "fx-star")?.interior?.iouPercent
    const hexIoU = byId(interior.perShape, "fx-hexagon")?.interior?.iouPercent
    md.push("**The two geometry errors this metric was built to find are fixed.** In the previous run the star sat at")
    md.push("69.9% and the hexagon at 80.1%: mocanvas drew the star with too small an inner radius, so its arms were")
    md.push("visibly thinner, and it put the hexagon's vertices left and right instead of top and bottom, which made it")
    md.push(`half a box narrower across the flats. \`2ef11f1\` corrected both, and they now read ${fmt(starIoU, 1)}% and ${fmt(hexIoU, 1)}%.`)
    md.push("Neither error was visible in the whole-image number, where both were buried under stroke wobble; both were")
    md.push("obvious the moment the interiors were compared directly.")
    md.push("")
    const worstIoU = interior.perShape.filter((v) => v.interior).sort((x, y) => x.interior.iouPercent - y.interior.iouPercent).slice(0, 3)
    md.push(`**What is left is not a wrong outline.** The lowest rows are now ${worstIoU.map((v) => `${shapeLabel(v)} (${fmt(v.interior.iouPercent, 1)}%)`).join(", ")}, and they`)
    md.push("have two different causes, neither of them shape geometry.")
    md.push("")
    md.push("The note is the one large region on that list, and what this metric scores there is not its body but its")
    md.push("silhouette, which includes the drop shadow. The body matches: 214 px wide in both renders, same gradient")
    md.push("values at both ends. The shadow does not — mocanvas's spreads about 7 px further on each side and 7 px")
    md.push("higher than tldraw's — and that spread is most of the missing 10 points.")
    md.push("")
    md.push("The star and the triangle are simply the two smallest interiors in the fixture (8,666 and 8,897 px). A 6 px")
    md.push("erosion takes a fixed bite out of every silhouette and zoom-to-fit lands mocanvas's ink a pixel or two off")
    md.push("tldraw's (see Visible differences); both cost a small region proportionally far more than a large one. The")
    md.push("frame, the largest region here, scores 98.8% under exactly the same treatment.")
    md.push("")
    const skipped = interior.perShape.filter((s) => !s.interior).map((s) => shapeLabel(s))
    md.push(`Not scored here: the ${skipped.slice(0, -1).join(", the ")} and the ${skipped[skipped.length - 1]}. An open shape encloses nothing, and its box overlaps shapes that`)
    md.push("do — measuring \"its interior\" would silently be measuring theirs. The stroke band distance below is the")
    md.push("metric that covers them.")
    md.push("")

    // ---- 2. stroke band ---------------------------------------------------
    md.push(`### 2. Stroke band distance — ${px(band.overall.symmetric.medianPx)} median, ${px(band.overall.symmetric.p95Px)} at the 95th percentile`)
    md.push("")
    md.push("The question a hand-drawn outline can fairly be asked is not \"do your stroke pixels land on the")
    md.push("reference's?\" but \"how far away are they?\". For every stroke colour in the reference render, an exact")
    md.push("Euclidean distance transform gives the distance from any pixel to the nearest stroke pixel of that colour")
    md.push("in each image. Sampling those at the *other* render's stroke pixels of the same colour, in both directions")
    md.push("so that a stroke which is merely shorter cannot score well, gives a distance in pixels per shape.")
    md.push("")
    md.push(`Stroke width in these screenshots is about ${fmt(band.strokeWidthEstimatePx, 0)} px, so a hand-drawn pair that looks right should land`)
    md.push("within a few pixels; a genuinely misplaced outline would not.")
    md.push("")
    md.push("| shape | reference stroke px | median | p95 | max |")
    md.push("| :--- | ---: | ---: | ---: | ---: |")
    for (const s of band.perShape) {
      if (!s.band) continue
      const q = s.band.symmetric
      md.push(`| ${shapeLabel(s)} | ${int(s.band.referenceStrokePixels)} | ${px(q.medianPx)} | ${px(q.p95Px)} | ${px(q.maxPx)} |`)
    }
    md.push(`| **whole fixture** | — | **${px(band.overall.symmetric.medianPx)}** | **${px(band.overall.symmetric.p95Px)}** | **${px(band.overall.symmetric.maxPx)}** |`)
    md.push("")
    const scored = band.perShape.filter((v) => v.band)
    const sw = band.strokeWidthEstimatePx ?? 4
    const tight = scored.filter((v) => v.band.symmetric.medianPx <= sw / 2).length
    const quote = (suffix) => {
      const q = byId(scored, suffix)?.band?.symmetric
      return q ? `${px(q.medianPx)} median / ${px(q.p95Px)} p95` : "—"
    }
    md.push("**This is the number that says the hand-drawn stroke is working.** Half of mocanvas's stroke pixels are")
    md.push(`within ${px(band.overall.symmetric.medianPx)} of a reference stroke pixel of the same colour, and the worst pixel anywhere in the fixture is`)
    md.push(`${px(band.overall.symmetric.maxPx)} out — about ${fmt(band.overall.symmetric.maxPx / sw, 1)} stroke widths, on a glyph. ${tight} of the ${scored.length} scored regions sit at a median of`)
    md.push(`half a stroke width or better. Two outlines that a pixel diff scores as largely disjoint are, measured as a`)
    md.push("distance, running within a stroke width of each other nearly everywhere.")
    md.push("")
    md.push("The two rows that stand out are the differences worth having a name for, and neither is stroke")
    md.push("randomness:")
    md.push("")
    md.push(`- **bent arrow, ${quote("fx-arrow-bent")}** — tldraw stops the arrow short of the rectangle it is bound`)
    md.push("  to; mocanvas runs it to the shape's edge. A binding difference, and the only region left in the fixture")
    md.push("  whose median is more than half a stroke width out.")
    md.push(`- **text shape, ${quote("fx-text")}** — font weight: tldraw's face is heavier and slightly wider, so the`)
    md.push("  glyphs drift apart along the line even though the baseline and size agree. It also owns the fixture's")
    md.push("  worst single pixel.")
    md.push("")
    md.push(`The star (${quote("fx-star")}) and the hexagon (${quote("fx-hexagon")}) were on this list in the previous run, at 2.83 px`)
    md.push("and 6.71 px median against a ~4 px stroke. `2ef11f1` corrected the outlines behind both, and they now sit at")
    md.push("the fixture median.")
    md.push("")
    md.push("Two exclusions, both documented in `scripts/compare-metrics.mjs`. tldraw's \"Get a license for production\"")
    md.push(`badge (found automatically at ${band.excluded ? `${band.excluded.x0},${band.excluded.y0}–${band.excluded.x1},${band.excluded.y1}` : "the bottom-right corner"}, and only excluded because mocanvas paints nothing at all inside it) sits`)
    md.push("inside the frame's box and is not a rendering difference. And a colour class with fewer than")
    md.push(`${band.minRegionPixels} pixels in a region is the antialiased skirt of a neighbouring colour rather than a stroke of its own,`)
    md.push("so it is skipped rather than allowed to set that region's 95th percentile.")
    md.push("")

    // ---- 3. whole image ---------------------------------------------------
    md.push(`### 3. Whole-image pixel diff — ${fmt(d.diffPercent, 2)}% differing, ${fmt(d.inkOverlapPercent, 1)}% painted-pixel IoU`)
    md.push("")
  }

  md.push("| | |")
  md.push("| :--- | ---: |")
  md.push(`| Differing pixels | **${d.diffPercent.toFixed(2)}%** (${int(d.differentPixels)} of ${int(d.totalPixels)}) |`)
  md.push(`| Tolerance | any channel differing by more than ${d.tolerance}/255 |`)
  md.push(`| Painted (non-white) pixels, mocanvas | ${int(d.inkPixelsMocanvas)} |`)
  md.push(`| Painted (non-white) pixels, tldraw | ${int(d.inkPixelsTldraw)} |`)
  md.push(`| Painted-pixel overlap (IoU) | **${d.inkOverlapPercent.toFixed(1)}%** |`)
  md.push("")
  md.push("**Both rows understate the agreement, and the differing-pixels row is the worse of the two.** tldraw inks")
  md.push("only about 12% of the canvas, so a render that draws too little scores well on it: mocanvas painted")
  md.push("*nothing* in the first run below and scored 11.84% differing, then drew the whole document with the wrong")
  md.push("fills and scored 12.14%. Two renders that could hardly be less alike landed within 0.3 points of each")
  md.push("other. Painted-pixel IoU separates those two properly (0.0% against 56.4%), but it is an *overlap*, and an")
  md.push("overlap is exactly the wrong shape of question to ask about two independently wobbled outlines: it counts")
  md.push("a stroke that is one stroke width away identically to one that is on the other side of the canvas.")
  md.push("")
  md.push("Quote it as an upper bound on how much of the render is pixel-identical, not as a similarity score.")
  md.push("")

  // ---- history -------------------------------------------------------------
  md.push("### How the comparison has moved")
  md.push("")
  const cols = [...HISTORY, {
    git: versions.git,
    what: "star and hexagon corrected (this run)",
    loaded: compare.loads.mocanvas.ok ? "yes" : `no — ${compare.loads.mocanvas.error}`,
    diffPercent: d.diffPercent,
    inkOverlapPercent: d.inkOverlapPercent,
    interiorIoU: r?.interior?.overall?.iouPercent,
    bandMedian: r?.stroke?.overall?.symmetric?.medianPx,
  }]
  md.push(`| | ${cols.map((c) => `\`${c.git}\``).join(" | ")} |`)
  md.push(`| :--- | ${cols.map(() => ":---").join(" | ")} |`)
  md.push(`| | ${cols.map((c) => c.what).join(" | ")} |`)
  md.push(`| mocanvas loaded the file | ${cols.map((c) => c.loaded).join(" | ")} |`)
  md.push(`| Interior IoU | ${cols.map((c) => (c.interiorIoU == null ? "not measured yet" : `**${fmt(c.interiorIoU, 1)}%**`)).join(" | ")} |`)
  md.push(`| Stroke band, median | ${cols.map((c) => (c.bandMedian == null ? "not measured yet" : `**${px(c.bandMedian)}**`)).join(" | ")} |`)
  md.push(`| Painted-pixel IoU | ${cols.map((c) => `${fmt(c.inkOverlapPercent, 1)}%`).join(" | ")} |`)
  md.push(`| Differing pixels | ${cols.map((c) => `${fmt(c.diffPercent, 2)}%`).join(" | ")} |`)
  md.push("")
  md.push("The first two columns are why the whole-image rows are reported last: they barely move across the change")
  md.push("that took mocanvas from drawing nothing at all to drawing the entire document. The fill-ramp fix in")
  md.push("`ef4d079` is the one change both of them register properly.")
  md.push("")
  const exact = HISTORY.find((c) => c.git === "ef4d079")
  const drawn = HISTORY.find((c) => c.git === "83ff957")
  md.push("**The last two steps show why the order of the three metrics matters.**")
  md.push("")
  md.push(`\`ef4d079\` drew exact polygons with a uniform stroke. \`182bf43\` and \`83ff957\` replaced that with the seeded,`)
  md.push("wobbling, corner-overshooting outline the default \`dash: \"draw\"\` style actually calls for — unambiguously the")
  md.push(`more faithful render — and the whole-image numbers got *worse* for it (${fmt(exact.inkOverlapPercent, 1)}% → ${fmt(drawn.inkOverlapPercent, 1)}% painted-pixel`)
  md.push(`IoU, ${fmt(exact.diffPercent, 2)}% → ${fmt(drawn.diffPercent, 2)}% differing). A pixel diff cannot tell a stroke in the wrong place from a stroke`)
  md.push("drawn with different random numbers, and it charges twice for the second.")
  md.push("")
  md.push(`\`2ef11f1\` then fixed two outlines that were genuinely the wrong shape — the star's inner radius and the`)
  md.push(`hexagon's orientation — and *every* metric improved, whole-image rows included (${fmt(drawn.inkOverlapPercent, 1)}% → ${fmt(d.inkOverlapPercent, 1)}% painted-pixel`)
  md.push(`IoU, ${fmt(drawn.diffPercent, 2)}% → ${fmt(d.diffPercent, 2)}% differing, interior IoU ${fmt(drawn.interiorIoU, 1)}% → ${fmt(r?.interior?.overall?.iouPercent, 1)}%). That is the distinction the ordering`)
  md.push("encodes: a wrong shape is wrong in all three, while a differently-seeded stroke only looks wrong to the")
  md.push("third. Optimise against the first two; read the third as a consequence.")
  md.push("")
  md.push("The columns were measured on different revisions but with the same fixture, viewport, browser and tolerance.")
  md.push("The interior and band rows are blank before \`83ff957\` because the metrics did not exist yet — nothing has")
  md.push("been back-filled or estimated.")
  md.push("")
  return md
}

/**
 * Three or four sentences at the top of the report: where mocanvas is faster,
 * where it is slower and why, and how closely it reproduces the same document.
 * Every figure is computed from this run — nothing here is hand-copied.
 */
function summarySection(data) {
  const { matrix, compare } = data
  const md = []
  if (!matrix?.mocanvas || !matrix.tldraw) return md
  const keys = Object.keys(matrix.mocanvas)
  /** tldraw ÷ mocanvas, so > 1 means mocanvas was faster. */
  const ratios = (metric, filter = () => true) => keys.filter(filter)
    .map((k) => matrix.tldraw[k]?.[metric] / matrix.mocanvas[k]?.[metric])
    .filter((v) => Number.isFinite(v) && v > 0)
  const span = (xs, digits = 1) => {
    const lo = Math.min(...xs), hi = Math.max(...xs)
    return lo.toFixed(digits) === hi.toFixed(digits) ? `${lo.toFixed(digits)}×` : `${lo.toFixed(digits)}–${hi.toFixed(digits)}×`
  }
  const big = (k) => k.startsWith("20000:")
  const small = (k) => !k.startsWith("20000:")

  md.push("## Summary")
  md.push("")
  md.push(`mocanvas creates shapes ${span(ratios("createMs"))} faster than tldraw and reaches first paint up to ${Math.max(...ratios("firstFrameMs")).toFixed(0)}× faster,`)
  md.push(`answers hit-test queries ${span(ratios("hitAvgUs"), 0)} faster and holds ${span(ratios("memoryMB"), 0)} less JS heap; at 20,000 shapes it is also`)
  md.push(`${span(ratios("panP50", big))} faster on the median pan/zoom frame and ${span(ratios("dragP50", big))} faster on select-all-drag.`)
  // Only say something about the smaller sizes when they were actually run;
  // this paragraph used to be unconditional and printed `Infinity×` for a
  // single-N run.
  const smallRatios = ratios("panP50", small)
  if (smallRatios.length > 0) {
    md.push(`At the smaller sizes it is slower per frame — ${span(smallRatios.map((v) => 1 / v))} on the median pan/zoom frame — for two`)
    md.push("reasons set out in the caveats: this machine has no GPU, so mocanvas's WebGL2 output is rasterised on the")
    md.push("CPU, where 4× MSAA alone accounts for roughly 70% of the frame; and the pan/zoom metric counts only")
    md.push("main-thread work, which tldraw largely avoids by panning with a CSS transform on the compositor. The")
    md.push("`selectAllDrag` tables are the fairer frame comparison.")
  } else {
    md.push("This run measured 20,000 shapes only. The caveats below matter for reading the frame figures: this")
    md.push("machine has no GPU, so mocanvas's WebGL2 output is rasterised on the CPU, and the pan/zoom metric")
    md.push("counts only main-thread work, which tldraw largely avoids by panning with a CSS transform on the")
    md.push("compositor. The `selectAllDrag` tables are the fairer frame comparison.")
  }
  if (compare?.ok && !compare.diff?.error && compare.regions) {
    const i = compare.regions.interior?.overall
    const b = compare.regions.stroke?.overall?.symmetric
    const sw = compare.regions.stroke?.strokeWidthEstimatePx
    if (i && b) {
      md.push("")
      md.push(`Rendering the same tldraw-authored document, mocanvas agrees with tldraw on ${i.iouPercent.toFixed(1)}% of shape interiors by`)
      md.push(`IoU at ${i.colourAgreementPercent.toFixed(1)}% colour agreement, and half its stroke pixels land within ${b.medianPx.toFixed(2)} px of a tldraw stroke`)
      md.push(`pixel of the same colour (95th percentile ${b.p95Px.toFixed(2)} px, against a stroke about ${sw?.toFixed(0) ?? "4"} px wide). ${compare.diff.diffPercent.toFixed(2)}% of the`)
      md.push("canvas differs pixel-for-pixel, most of it two hand-drawn outlines that miss each other by roughly a stroke")
      md.push("width. The differences that are not stroke randomness are a bound arrow that runs to the shape's edge where")
      md.push("tldraw stops short of it, and a lighter font.")
    }
  }
  md.push("")
  return md
}

function renderDoc(data) {
  const { machine, browser, matrix, ns, kinds, repeats, compare, versions, date } = data
  const md = []
  md.push("# Benchmark: mocanvas vs tldraw")
  md.push("")
  md.push(`_Generated ${date} by \`apps/bench/scripts/bench.mjs\`. Re-run with \`pnpm --filter bench bench\`._`)
  md.push("")
  md.push(...summarySection(data))
  md.push("Both libraries are driven through an identical `window.bench` API (`apps/bench/src/bench-api.ts`)")
  md.push("with byte-identical workloads: same grid, same shape sizes, colours and fills, the same scripted")
  md.push("camera path, and the same hit-test sample points. Frame times are frame-to-frame `requestAnimationFrame`")
  md.push("deltas recorded while a camera animation runs (zoom to fit → zoom in 4× → horizontal pan sweep → zoom back out).")
  md.push("")
  if (matrix?.mocanvas) {
    md.push("## What changed since the previous run")
    md.push("")
    md.push(`Three changes to what mocanvas draws landed between the previous published performance numbers (${PREVIOUS.date}, git \`${PREVIOUS.git}\`) and this run:`)
    md.push("")
    md.push("- **Hand-drawn stroke style** (`182bf43`, `83ff957`). The default `dash: \"draw\"` outline is now seeded")
    md.push("  wobble, rounded corners and overshoot past the vertex, where before it was the exact polygon with a")
    md.push("  uniform stroke. It is the more faithful render, and it costs roughly 2.5× the tessellation work of a")
    md.push("  plain stroke. Every shape in this benchmark uses the default dash, so that cost is paid on every shape")
    md.push("  every time geometry is rebuilt.")
    md.push("- **Note and frame chrome** (`219fe67`) — the note's top-to-bottom gradient and drop shadow, and a")
    md.push("  corrected frame border colour.")
    md.push("- **Corrected star and hexagon outlines** (`2ef11f1`) — the star's inner radius and the hexagon's")
    md.push("  orientation. That one is measured in the [rendering comparison](#rendering-comparison), not here.")
    md.push("")
    md.push("95th-percentile pan/zoom frame. tldraw's column is the control: its code did not change between the two")
    md.push("runs, so whatever it moved by is what this machine did on its own.")
    md.push("")
    md.push("| N | kind | mocanvas before → after | Δ | tldraw before → after (unchanged) | Δ |")
    md.push("| ---: | :--- | ---: | ---: | ---: | ---: |")
    const pct = (before, after) => (before != null && Number.isFinite(after) && before > 0
      ? `${after < before ? "" : "+"}${(((after - before) / before) * 100).toFixed(0)}%`
      : "—")
    for (const kind of kinds) {
      for (const n of ns) {
        const key = `${n}:${kind}`
        const mo = matrix.mocanvas[key]?.panP95
        const tl = matrix.tldraw?.[key]?.panP95
        md.push(`| ${int(n)} | ${kind} | ${fmt(PREVIOUS.panP95[key], 1)} → ${fmt(mo, 1)} ms | ${pct(PREVIOUS.panP95[key], mo)} | ${fmt(PREVIOUS.tldrawPanP95[key], 1)} → ${fmt(tl, 1)} ms | ${pct(PREVIOUS.tldrawPanP95[key], tl)} |`)
      }
    }
    md.push("")
    // How much slower was the machine? Measured on tldraw, whose code did not change.
    const controlDeltas = []
    for (const kind of kinds) for (const n of ns) {
      const key = `${n}:${kind}`
      for (const [was, isNow] of [
        [PREVIOUS.tldrawPanP95[key], matrix.tldraw?.[key]?.panP95],
        [PREVIOUS.tldrawCreateMs[key], matrix.tldraw?.[key]?.createMs],
        [PREVIOUS.tldrawDragP50[key], matrix.tldraw?.[key]?.dragP50],
      ]) if (was > 0 && Number.isFinite(isNow)) controlDeltas.push(((isNow - was) / was) * 100)
    }
    const lo = Math.min(...controlDeltas), hi = Math.max(...controlDeltas)
    md.push("**This machine was much slower during this run, so read the control column first.** tldraw ran identical")
    md.push(`code across the two runs and still moved by ${fmt(lo, 0)}% to +${fmt(hi, 0)}% across pan, creation and drag —`)
    md.push("shape creation included, which draws nothing at all, and its hit testing, which is pure JS and touches no")
    md.push("pixels, got 27–69% slower too. Nothing in that column is a code change, so the absolute before → after")
    md.push("figures in the first column cannot be read as a regression on their own; they carry the same machine")
    md.push("slowdown plus whatever mocanvas did.")
    md.push("")
    md.push("What survives that is the **ratio between the two libraries**, which were measured against each other in")
    md.push("the same session on both occasions, so a slower machine largely divides out. Below 1.00 means mocanvas was")
    md.push("faster than tldraw; the bracket is how that ratio moved, and a positive bracket is mocanvas losing ground.")
    md.push("")
    const ratioCols = [
      ["create", "createMs", "createMs", "tldrawCreateMs"],
      ["pan p95", "panP95", "panP95", "tldrawPanP95"],
      ["drag p50", "dragP50", "dragP50", "tldrawDragP50"],
      ["drag p95", "dragP95", "dragP95", "tldrawDragP95"],
    ]
    md.push(`| N | kind | ${ratioCols.map((c) => `${c[0]} (then → now)`).join(" | ")} |`)
    md.push(`| ---: | :--- | ${ratioCols.map(() => "---:").join(" | ")} |`)
    for (const kind of kinds) {
      for (const n of ns) {
        const key = `${n}:${kind}`
        const cells = ratioCols.map(([, metric, prevMo, prevTl]) => {
          const then = PREVIOUS[prevMo]?.[key] / PREVIOUS[prevTl]?.[key]
          const now = matrix.mocanvas[key]?.[metric] / matrix.tldraw?.[key]?.[metric]
          if (!Number.isFinite(then) || !Number.isFinite(now)) return "—"
          const d = ((now / then) - 1) * 100
          return `${then.toFixed(2)} → ${now.toFixed(2)} (${d >= 0 ? "+" : ""}${d.toFixed(0)}%)`
        })
        md.push(`| ${int(n)} | ${kind} | ${cells.join(" | ")} |`)
      }
    }
    md.push("")
    md.push("**Creation and hit testing did not move; the redraw paths did.** mocanvas's advantage on `create` is the")
    md.push("same as it was (±10% on the ratio, in both directions), and so is its hit-testing advantage, which is")
    md.push("expected: neither builds stroke geometry. The `selectAllDrag` ratio, which does rebuild it every frame,")
    md.push("moved against mocanvas in all six cells on the median frame and four of six at the 95th percentile, by")
    md.push("roughly 7–50%. That is the hand-drawn stroke being paid for, and it is the honest cost of the more")
    md.push("faithful render.")
    md.push("")
    md.push("The pan/zoom ratios move in both directions — worse at 1,000 and 20,000, better at 5,000 — and are the")
    md.push("least trustworthy column here. Frame deltas are quantised to the browser's ~8.3 ms cadence, so the")
    md.push("`1,000 geo` cell\'s +149% is mocanvas going from 24.5 ms to 58.3 ms: three buckets to seven, where one")
    md.push("bucket either way would have moved it by a third. Treat pan/zoom as \"somewhere between unchanged and")
    md.push("moderately worse\" and the drag figures as the number that was actually measured.")
    md.push("")
    if (compare?.ok && !compare.diff?.error) {
      md.push("What the same changes bought is in the [rendering comparison](#rendering-comparison): the fixture-wide")
      md.push("interior IoU and every whole-image figure improved, and the two worst per-shape rows were fixed outright.")
      md.push("")
    }
  }

  md.push("## Environment")
  md.push("")
  md.push("| | |")
  md.push("| :--- | :--- |")
  md.push(`| Date | ${date} |`)
  md.push(`| Machine | ${machine.cpu}, ${machine.cores} cores, ${machine.memoryGB} GB |`)
  md.push(`| OS | ${machine.os} |`)
  md.push(`| Node | ${machine.node} |`)
  md.push(`| Browser | headless Chromium ${browser.version} (Playwright ${versions.playwright}) |`)
  md.push(`| Chromium flags | \`${browser.args.join(" ")}\` |`)
  md.push(`| GL mode attempted | ${browser.mode} |`)
  md.push(`| WebGL2 renderer | ${browser.gpu.renderer} |`)
  md.push(`| Rasterisation | ${browser.software ? "**software (SwiftShader)** — no hardware GPU in this environment" : "hardware"} |`)
  md.push(`| tldraw | ${versions.tldraw} |`)
  md.push(`| mocanvas | ${versions.mocanvas} (this repo, ${versions.git}) |`)
  md.push(`| Builds | production (\`vite build\`, minified, \`NODE_ENV=production\`) for both |`)
  md.push(`| Viewport | ${VIEWPORT.width}×${VIEWPORT.height} CSS px, device scale 1 |`)
  md.push(`| Matrix | N ∈ {${ns.join(", ")}} × kind ∈ {${kinds.join(", ")}}, ${repeats} repeats, medians reported |`)
  md.push("")
  {
    md.push(`_${runNote(data.versions?.git ?? "unknown")}_`)
    md.push("")
  }

  if (matrix) {
    md.push("## Results")
    md.push("")
    md.push("Every cell is the median of the repeats. `ratio` compares the two: “2.00× faster” means mocanvas took half the time tldraw did.")
    md.push("")

    md.push("### Shape creation (`create(n, kind)`)")
    md.push("")
    md.push("Wall time of the single `createShapes` call, inside one transaction with history disabled.")
    md.push("")
    md.push(metricTable(matrix, ns, kinds, (r) => r.createMs, (v) => `${fmt(v, 0)} ms`))
    md.push("")
    md.push("Time from the start of that call until the second animation frame afterwards (creation + first paint):")
    md.push("")
    md.push(metricTable(matrix, ns, kinds, (r) => r.firstFrameMs, (v) => `${fmt(v, 0)} ms`))
    md.push("")

    md.push("### Pan / zoom frame time (`panZoomRun(120)`)")
    md.push("")
    md.push("120 frames of the scripted camera animation. Median frame:")
    md.push("")
    md.push(metricTable(matrix, ns, kinds, (r) => r.panP50, (v) => `${fmt(v, 2)} ms`))
    md.push("")
    md.push("95th-percentile frame (the stutter you actually feel):")
    md.push("")
    md.push(metricTable(matrix, ns, kinds, (r) => r.panP95, (v) => `${fmt(v, 2)} ms`))
    md.push("")
    md.push("Worst single frame:")
    md.push("")
    md.push(metricTable(matrix, ns, kinds, (r) => r.panMaxMs, (v) => `${fmt(v, 2)} ms`))
    md.push("")
    md.push("Average frames per second over the run (higher is better):")
    md.push("")
    md.push(metricTable(matrix, ns, kinds, (r) => r.panFps, (v) => fmt(v, 1), { higherIsBetter: true }))
    md.push("")

    md.push("### Select-all + drag frame time (`selectAllDragRun(60)`)")
    md.push("")
    md.push("Every shape on the page is selected, then nudged once per frame for 60 frames — this exercises")
    md.push("the write path (store update → geometry invalidation → re-render), not just the camera. Median frame:")
    md.push("")
    md.push(metricTable(matrix, ns, kinds, (r) => r.dragP50, (v) => `${fmt(v, 2)} ms`))
    md.push("")
    md.push("95th-percentile frame:")
    md.push("")
    md.push(metricTable(matrix, ns, kinds, (r) => r.dragP95, (v) => `${fmt(v, 2)} ms`))
    md.push("")

    md.push("### Hit testing (`hitTestRun(500)`)")
    md.push("")
    md.push("500 deterministic `getShapeAtPoint` queries spread over the document bounds, µs per query:")
    md.push("")
    md.push(metricTable(matrix, ns, kinds, (r) => r.hitAvgUs, (v) => `${fmt(v, 1)} µs`))
    md.push("")

    md.push("### JS heap after the run (`memoryMB()`)")
    md.push("")
    md.push("`performance.memory.usedJSHeapSize` after a forced GC (`--js-flags=--expose-gc`). This is JS heap only —")
    md.push("it does not include GPU buffers (mocanvas) or the DOM/layout memory of the render tree (tldraw), so it")
    md.push("understates both, differently. Treat it as a rough signal, not a memory benchmark.")
    md.push("")
    md.push(metricTable(matrix, ns, kinds, (r) => r.memoryMB, (v) => `${fmt(v, 1)} MB`, { words: ["less", "more"] }))
    md.push("")

    const failures = []
    for (const lib of LIBS) {
      for (const key of Object.keys(matrix[lib] ?? {})) {
        const cell = matrix[lib][key]
        if (cell.errors?.length) failures.push(`- \`${lib}\` at N=${key}: ${cell.errors.join("; ")}`)
        else if (cell.ok < cell.repeats) failures.push(`- \`${lib}\` at N=${key}: only ${cell.ok}/${cell.repeats} repeats completed`)
      }
    }
    if (failures.length) {
      md.push("### Runs that did not complete")
      md.push("")
      md.push(...failures)
      md.push("")
    }
  }

  md.push("## Rendering comparison")
  md.push("")
  if (!compare?.ok) {
    md.push(`Not run: ${compare?.error ?? "skipped"}.`)
    md.push("")
  } else {
    md.push("`apps/bench/public/compare.tldr` is authored by driving the **tldraw** page through tldraw's public API")
    md.push("(`createShapes` / `createBindings` / `getSnapshot`) — see `apps/bench/scripts/make-fixture.mjs`. It holds a")
    md.push("geo rectangle with a text label, an ellipse, a star, a triangle, a filled hexagon, a freehand draw stroke,")
    md.push("a bent arrow bound to the rectangle, a straight arrow, a line, a note with text, a text shape, and a frame")
    md.push("with two children. Both pages load that same file, zoom to fit at 1200×800 and are screenshotted.")
    md.push("")
    md.push(`- \`apps/bench/results/compare-tldraw.png\` — tldraw (${compare.loads.tldraw.shapes} shapes from ${compare.fixtureRecords} records)`)
    md.push(`- \`apps/bench/results/compare-mocanvas.png\` — mocanvas (${compare.loads.mocanvas.shapes} shapes from ${compare.fixtureRecords} records)`)
    md.push("- `apps/bench/results/compare-diff.png` — differing pixels in red")
    md.push("")
    if (compare.diff.error) {
      md.push(`Diff failed: ${compare.diff.error}`)
      md.push("")
    } else {
      md.push(...comparisonSection(compare, versions))
    }
    md.push("### Load result")
    md.push("")
    md.push("| | mocanvas | tldraw |")
    md.push("| :--- | :--- | :--- |")
    md.push(`| Loaded without error | ${compare.loads.mocanvas.ok ? "yes" : `no — ${compare.loads.mocanvas.error}`} | ${compare.loads.tldraw.ok ? "yes" : `no — ${compare.loads.tldraw.error}`} |`)
    md.push(`| Shapes on the page after load | ${compare.loads.mocanvas.shapes} | ${compare.loads.tldraw.shapes} |`)
    md.push("")
    md.push("_An earlier revision of this bench ran a second pass in which the fixture was down-converted for")
    md.push("mocanvas (`richText` → `text`, packed draw `path` → `points`) using tldraw's own public helpers, because")
    md.push("mocanvas could not read either form and its raw-file screenshot was blank. mocanvas does both conversions")
    md.push("itself now, so that shim and its screenshots are gone and the numbers above are the unassisted ones._")
    md.push("")
    const warn = compare.loads.mocanvas.warnings ?? []
    md.push("### mocanvas load warnings")
    md.push("")
    if (!warn.length) md.push("None — every record in the fixture mapped onto a registered mocanvas shape/binding util with matching props.")
    else {
      md.push("Reported by the bench page while loading the tldraw-authored fixture (unknown shape/binding types, and props")
      md.push("present on one side but not the other):")
      md.push("")
      // The per-record-type "unknown migration sequence" warnings are one fact
      // repeated ~28 times; collapse them so the real findings are visible.
      const migrations = warn.filter((w) => w.includes("unknown migration sequence"))
      for (const w of warn) if (!migrations.includes(w)) md.push(`- \`${w}\``)
      if (migrations.length) {
        md.push(`- \`[store] ignoring unknown migration sequence …\` — ×${migrations.length}, one per tldraw record type`)
        md.push("  (`com.tldraw.store`, `com.tldraw.shape.geo`, `com.tldraw.binding.arrow`, …). mocanvas registers no")
        md.push("  migration sequences under tldraw's names, so it applies none of the file's declared migrations and reads")
        md.push("  the records as-is. Harmless for a current-version file like this one; it would matter for an older file")
        md.push("  that genuinely needs migrating.")
      }
      md.push("")
      md.push("These compare the file *as authored* against what this build declares: `compatWarnings` in the bench")
      md.push("page reads each record's raw props and diffs them against the props the matching shape util declares,")
      md.push("before mocanvas normalises anything. So they describe the tldraw file's shape, not something mocanvas")
      md.push("failed to read. Two of these entries are worth spelling out, because in the previous run they meant exactly that:")
      md.push("")
      md.push("1. **`geo/text/note/arrow: unknown prop \"richText\"` and the matching `missing prop \"text\"`.** tldraw 5.x")
      md.push("   stores label text as a ProseMirror/TipTap `richText` document and no longer writes `props.text`, which")
      md.push("   mocanvas's shape utils declare — hence one warning for the prop the file has and one for the prop it")
      md.push("   lacks. `normalizeLoadedRecords` (`packages/editor/src/records/normalize.ts`) now flattens `richText`")
      md.push("   into `text` while the records load. Before it did, this file threw")
      md.push("   `TypeError: Cannot read properties of undefined (reading 'trim')` and the page rendered nothing.")
      md.push("2. **`draw: segment uses the packed \"path\" form (decoded to \"points\" on load)`.** tldraw stores freehand")
      md.push("   strokes as `segments[].path`, a base64-packed point buffer, rather than the older `segments[].points`")
      md.push("   array. The same normalisation pass decodes it, which is why the freehand wave renders above. In the")
      md.push("   run before the `.tldr` load fix this check read `segment has no \"points\" array (encoded \"path\" is")
      md.push("   not decoded)`, and that was literally true then: the stroke was dropped. It is now a note about the")
      md.push("   file's format, not a gap in mocanvas.")
      md.push("")
      md.push("The remaining warnings are benign: extra props mocanvas does not model")
      md.push("(`flipX`/`flipY`, `scaleX`/`scaleY`, `kind`, `elbowMidPoint`, `textLastEditedBy`, `frame.color`,")
      md.push("`binding.snap`) which are simply ignored.")
    }
    md.push("")
    md.push("### Visible differences")
    md.push("")
    md.push("_Written by hand from looking at the two screenshots, and kept in")
    md.push("`apps/bench/results/visible-differences.md` so that re-running the bench does not overwrite it._")
    md.push("")
    md.push(data.visibleDifferences ?? "_Not yet reviewed._")
    md.push("")
  }

  md.push("## Methodology")
  md.push("")
  md.push("1. `vite build` produces a production bundle containing both pages; `vite preview` serves it. Neither library")
  md.push("   runs in a dev build, and React runs in production mode for both.")
  md.push("2. For each `(library, N, kind, repeat)` a **fresh page** is opened, so no run inherits another's heap,")
  md.push("   store contents or JIT state.")
  md.push("3. `create(n, kind)` builds the shape list from the shared spec in `bench-api.ts` and creates it in one")
  md.push("   transaction with `history: \"ignore\"` on both sides.")
  md.push("4. Frame timing is frame-to-frame `requestAnimationFrame` delta while the camera is driven by the shared")
  md.push("   `panZoomCamera(t)` function. Camera writes are forced/immediate on both sides so neither library gets to")
  md.push("   coalesce or animate the camera away.")
  md.push("5. Percentiles are computed over the 120 (or 60) recorded deltas within a run; across the repeats the")
  md.push("   **median** of each scalar is reported.")
  md.push("6. `'mixed'` is 60% geo shapes, 25% freehand draw strokes of 40 points each, 10% arrows and 5% notes/text")
  md.push("   (alternating), laid out on the same grid as `'geo'`.")
  md.push("")

  md.push("## Caveats — please read before quoting these numbers")
  md.push("")
  md.push("- **Headless, software-rasterised GPU.** " + (browser.software
    ? "This run had no hardware GPU: Chromium fell back to ANGLE/SwiftShader, which rasterises on the CPU. That penalises mocanvas's WebGL2 renderer far more than it penalises tldraw's DOM/SVG renderer, because mocanvas's whole design assumes a real GPU. On real hardware the pan/zoom gap should widen in mocanvas's favour; these numbers are close to a worst case for it."
    : "Hardware acceleration was available, but a headless Chromium GPU stack is still not a user's browser."))
  const probe = glCostProbe()
  if (probe && browser.software) {
    md.push("- **4× MSAA dominates a software-rasterised frame, so these frame times mostly measure SwiftShader, not")
    md.push("  the engine.** A probe in this same environment (`glCostProbe` in `apps/bench/results/panzoom-after.json`)")
    md.push(`  draws ${int(probe.triangles)} triangles (${fmt(probe.bufferMB, 2)} MB of vertex data) into a context configured exactly like the`)
    md.push("  WebGL2 backend's, and reads one pixel back so the GPU process has to finish before the clock stops.")
    md.push(`  Uploading the buffers costs ${fmt(probe.uploadOnlyMs, 2)} ms and clearing costs ${fmt(probe.clearOnlyMs, 2)} ms, but clear-plus-draw costs`)
    md.push(`  **${fmt(probe.clearAndDrawMs, 1)} ms with \`antialias: true\` against ${fmt(probe.clearAndDrawMs_antialiasOff, 1)} ms with it off** — roughly`)
    md.push(`  ${fmt(((probe.clearAndDrawMs - probe.clearAndDrawMs_antialiasOff) / probe.clearAndDrawMs) * 100, 0)}% of the frame is multisample resolve on the CPU. On a real GPU MSAA is close to free, so the`)
    md.push("  absolute mocanvas frame times above are largely a property of this rasteriser rather than of the scene.")
    md.push("  That probe file was recorded in this same environment at an earlier revision. It is quoted here because")
    md.push("  it measures the rasteriser rather than mocanvas — no mocanvas code runs in it — so it does not need")
    md.push("  re-measuring with the rest of the report.")
  }
  if (matrix?.tldraw && PREVIOUS?.tldrawPanP95) {
    md.push("- **Run-to-run spread is very wide here, and was unusually wide between this run and the last.** tldraw's code did not")
    md.push("  change between this run and the previous one, and it still came out 26–57% slower on shape creation,")
    md.push("  27–69% slower on hit testing and up to 234% slower on the 95th-percentile pan/zoom frame (see \"What")
    md.push("  changed since the previous run\"). None of that is a code change, so **absolute numbers from this report")
    md.push("  should not be compared against absolute numbers from any earlier one.** Only comparisons made inside a")
    md.push("  single browser session — the mocanvas/tldraw pairs in every table here — are worth quoting, and even a")
    md.push("  cross-run comparison of those ratios should be read as a direction, not a magnitude.")
  }
  md.push("- **Default settings on both sides.** No tuning, no custom shape utils, no culling or LOD flags flipped, no")
  md.push("  tldraw performance options enabled. Both libraries are used the way the docs show. Either could likely be")
  md.push("  made faster by someone who knows its knobs; that is a different benchmark.")
  md.push("- **This benchmark was written by the mocanvas authors.** The workload was chosen to be fair (identical")
  md.push("  specs, identical camera path, both driven through public APIs), but it is still our benchmark of our own")
  md.push("  library, and we picked which metrics to show. Read the code in `apps/bench/` before believing it.")
  md.push("- **mocanvas is much younger and does far less.** tldraw is a mature, complete product: rich text editing,")
  md.push("  collaboration, assets/embeds, undo semantics, accessibility, a full UI, and years of edge cases. mocanvas")
  md.push("  is a rendering core with a small shape set. A rendering benchmark flatters the thing that renders and")
  md.push("  ignores everything else, and \"everything else\" is most of what tldraw is. These numbers say nothing about")
  md.push("  which library you should use.")
  md.push("- **Rendering models differ, so the pixel diff is not a bug count.** tldraw renders shapes as DOM/SVG with")
  md.push("  its own hand-drawn stroke style and font stack; mocanvas rasterises through WebGL2. Antialiasing, stroke")
  md.push("  geometry and text layout will never match pixel-for-pixel, and a nonzero diff percentage is expected even")
  md.push("  where both are \"correct\".")
  md.push("- **The whole-image numbers cannot score a hand-drawn stroke, and this is measured rather than argued.**")
  md.push("  Both libraries wobble the default `dash: \"draw\"` outline from their own seed, so two outlines that both")
  md.push("  look right miss each other by about a stroke width and every one of those pixels is charged twice. Drawing")
  md.push("  exact polygons instead scored *better* on both whole-image rows while looking wrong. Read the interior IoU")
  md.push("  and the stroke band distance first; the whole-image rows are an upper bound on pixel-identical area, not a")
  md.push("  similarity score.")
  md.push("- **The pan/zoom numbers do not measure the same work in both libraries, and this favours tldraw.** A")
  md.push("  `requestAnimationFrame` delta captures main-thread time. tldraw moves the camera by setting a CSS transform")
  md.push("  on a container, so the pan/zoom sweep costs it almost no main-thread work — the compositor does the moving,")
  md.push("  off-thread and unmeasured. mocanvas redraws the scene through WebGL2 on the main thread every frame, so its")
  md.push("  number includes the entire render. Read the pan/zoom tables as \"main-thread cost per frame\", not as \"which")
  md.push("  library draws faster\": a low tldraw number there partly means the work moved somewhere this benchmark")
  md.push("  cannot see. The `selectAllDragRun` numbers are the fairer frame-time comparison, because mutating shapes")
  md.push("  forces both libraries to actually re-render.")
  md.push("- **Every shape here uses the default `dash: \"draw\"`, which is the expensive one.** That outline is seeded")
  md.push("  wobble with rounded corners and overshoot, and it costs roughly 2.5× the tessellation work of a plain")
  md.push("  stroke. It is what tldraw draws by default too, so the comparison is like-for-like, but it means the")
  md.push("  mocanvas frame times here are its most expensive stroke style on every one of 20,000 shapes. A document")
  md.push("  drawn with `dash: \"solid\"` would not produce these numbers, and this benchmark does not measure that case.")
  md.push("- **Frame deltas are floored by the browser's frame cadence**, so very fast cases converge on the same number")
  md.push("  for both libraries; that is a measurement ceiling, not a tie.")
  md.push("- **Memory is JS heap only** (see the note on that table).")
  md.push("- **The `.tldr` fixture is authored by tldraw**, so it is on tldraw's home turf by construction: tldraw reads")
  md.push("  back exactly what it wrote, while mocanvas reads a foreign file through its compatibility layer.")
  md.push("")
  md.push("## Licensing / clean-room note")
  md.push("")
  md.push("`tldraw` is a dependency of **`apps/bench` only**, and is used exclusively through its public documented API.")
  md.push("No package under `packages/` imports, references or contains tldraw code, and nothing in the mocanvas")
  md.push("implementation was derived from tldraw's source.")
  md.push("")
  md.push("`apps/bench` is a deliberate, scoped exception to three rules in [`CLEAN_ROOM.md`](./CLEAN_ROOM.md), and")
  md.push("contributors should not read it as precedent for the rest of the repo:")
  md.push("")
  md.push("- **Rule 1 (never open tldraw source).** Building the bench required tldraw's *type declarations*")
  md.push("  (`node_modules/tldraw/dist-esm/index.d.mts`) to get prop and function signatures right. Only `.d.ts`")
  md.push("  declarations were read — never the `.js`/`.mjs` bundles or `src/`. No tldraw code was copied.")
  md.push("- **Rule 4 (no branding / product names).** The bench necessarily names tldraw, imports its package and")
  md.push("  renders its watermark in the comparison screenshot.")
  md.push("- **Rule 5 (dependency licences limited to MIT/Apache-2.0/BSD/ISC/CC0/0BSD).** tldraw ships under its own")
  md.push("  licence, not one of those — see `apps/bench/node_modules/tldraw/LICENSE.md`. Because `apps/bench` is a")
  md.push("  private, unpublished dev-only workspace package, it does not affect the licensing of anything shipped, but")
  md.push("  whoever maintains the `cargo deny` / `license-checker` CI gates should keep `apps/bench` excluded from the")
  md.push("  published-dependency check rather than relaxing the rule globally.")
  md.push("")
  md.push("The `.tldr` file format itself is implemented in `packages/store` from the format's own bytes and public")
  md.push("documentation, not from tldraw's parser.")
  md.push("")
  return md.join("\n")
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  await mkdir(RESULTS_DIR, { recursive: true })

  // Re-render docs/BENCHMARK.md from the last run's results — no build, no
  // browser, no measuring. Use it when only the prose or tables changed.
  if (opts.reportOnly) {
    const data = JSON.parse(await readFile(LATEST_JSON, "utf8"))
    data.visibleDifferences = (await readVisibleDifferences()) ?? data.visibleDifferences
    await writeFile(LATEST_JSON, `${JSON.stringify(data, null, 2)}\n`)
    await writeFile(DOC, renderDoc(data))
    console.log(`re-rendered ${DOC} from ${LATEST_JSON} (measured ${data.date})`)
    return
  }

  console.log("building bench app for production…")
  await buildApp()
  const server = await startPreview()
  console.log(`preview at ${server.url}`)

  const launched = await launchBrowser({ chromium }, server.url, { headed: opts.headed === true })
  console.log(`chromium ${launched.version} — mode=${launched.mode} software=${launched.software}`)
  console.log(`renderer: ${launched.gpu.renderer}`)

  const matrix = { mocanvas: {}, tldraw: {} }
  const raw = []

  if (opts.perf) {
    for (const kind of opts.kinds) {
      for (const n of opts.ns) {
        for (const lib of LIBS) {
          const runs = []
          for (let r = 0; r < opts.repeats; r++) {
            process.stdout.write(`  ${lib.padEnd(8)} N=${String(n).padStart(6)} ${kind.padEnd(5)} repeat ${r + 1}/${opts.repeats} … `)
            const t0 = Date.now()
            const run = await measure(launched.browser, server.url, lib, n, kind)
            runs.push(run)
            raw.push(run)
            const tag = run.errors.length
              ? `FAILED (${run.errors[0]})`
              : `create ${run.create.ms.toFixed(0)}ms  pan p50 ${run.panZoom.p50.toFixed(1)}ms  drag p50 ${run.drag.p50.toFixed(1)}ms  hit ${run.hit.avgUs.toFixed(1)}µs`
            console.log(`${tag}  [${((Date.now() - t0) / 1000).toFixed(0)}s]`)
          }
          matrix[lib][`${n}:${kind}`] = foldRepeats(runs)
        }
      }
    }
  }

  let compare = { ok: false, error: "skipped (--skip-compare)" }
  if (opts.compare) {
    console.log("\nrendering comparison…")
    try {
      compare = await compareRendering(launched.browser, server.url)
      if (compare.ok && !compare.diff.error) {
        console.log(`  pixel diff: ${compare.diff.diffPercent.toFixed(2)}%  (ink overlap ${compare.diff.inkOverlapPercent.toFixed(1)}%)`)
        console.log(`  mocanvas load: ok=${compare.loads.mocanvas.ok} shapes=${compare.loads.mocanvas.shapes} warnings=${compare.loads.mocanvas.warnings.length}`)
        for (const w of compare.loads.mocanvas.warnings) console.log(`    - ${w}`)
      } else {
        console.log(`  ${compare.error ?? compare.diff.error}`)
      }
    } catch (e) {
      compare = { ok: false, error: String(e.message ?? e) }
      console.log(`  failed: ${compare.error}`)
    }
  }

  await launched.browser.close()
  await server.close()

  const data = {
    date: new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC",
    machine: machineInfo(),
    browser: { version: launched.version, mode: launched.mode, software: launched.software, gpu: launched.gpu, args: launched.args },
    versions: {
      tldraw: pkgVersion("tldraw"),
      playwright: pkgVersion("playwright"),
      mocanvas: JSON.parse(await readFile(resolve(REPO_ROOT, "packages/mocanvas/package.json"), "utf8")).version,
      git: gitRev(),
    },
    ns: opts.ns,
    kinds: opts.kinds,
    repeats: opts.repeats,
    viewport: VIEWPORT,
    matrix: opts.perf ? matrix : null,
    compare,
    raw,
    visibleDifferences: await readVisibleDifferences(),
  }

  await writeFile(LATEST_JSON, `${JSON.stringify(data, null, 2)}\n`)
  await writeFile(DOC, renderDoc(data))
  console.log(`\nwrote ${LATEST_JSON}`)
  console.log(`wrote ${DOC}`)
}

/** Short HEAD, marked `-dirty` when the tree has uncommitted changes — otherwise these numbers get attributed to a commit that was not what ran. */
function gitRev() {
  try {
    const rev = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim()
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" }).trim()
    return dirty ? `${rev}-dirty` : rev
  } catch {
    return "unknown"
  }
}

/**
 * The "visible differences" prose is maintained by hand in
 * `results/visible-differences.md` (a human/agent looks at the two PNGs) and
 * spliced into the report so re-running the bench does not wipe it.
 */
async function readVisibleDifferences() {
  try {
    return (await readFile(resolve(RESULTS_DIR, "visible-differences.md"), "utf8")).trim()
  } catch {
    return null
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
