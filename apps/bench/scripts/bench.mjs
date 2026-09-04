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
 * Why the revision below is marked dirty. Hand-written per run, like PREVIOUS —
 * check it still says something true before publishing a new report, and drop
 * it if the run was made from a clean tree.
 */
const RUN_NOTE = "The tree was checked clean at `15b670a` immediately before this run started, and the bundle is built once, before the first measurement — so a clean `15b670a` is what was measured. The `-dirty` marker comes from edits made after that build: to this report generator, and to UI code (selection handles, style panel, icons) committed by a concurrent session. Neither is in the bundle these numbers come from."

const PREVIOUS = {
  date: "2026-09-04 08:30:07 UTC",
  git: "32ac776-dirty",
  panP95: { "1000:geo": 41.6, "5000:geo": 84.2, "20000:geo": 193.1, "1000:mixed": 33.3, "5000:mixed": 107.6, "20000:mixed": 266.1 },
  tldrawPanP95: { "1000:geo": 9.0, "5000:geo": 33.3, "20000:geo": 291.2, "1000:mixed": 9.2, "5000:mixed": 33.4, "20000:mixed": 283.3 },
  compare: { loaded: false, diffPercent: 11.84, inkPixelsMocanvas: 0, inkOverlapPercent: 0 },
}

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
    await page.close()
    return { load, file }
  }

  // Pass A — both libraries get the raw, unmodified tldraw-authored file.
  for (const lib of LIBS) {
    const { load, file } = await shoot(lib, fixture, `compare-${lib}`)
    loads[lib] = load
    shots[lib] = file
  }
  const diff = await pixelDiff(shots.mocanvas, shots.tldraw, 24, "compare-diff")

  // There used to be a pass B here: mocanvas got a bench-side down-converted
  // copy of the document (richText → text, packed draw path → point array)
  // because it could not read either form itself, and the shimmed screenshot
  // was the only one that showed anything. `normalizeLoadedRecords` does both
  // conversions now, so pass A is the honest number and the shim is gone. The
  // `window.bench.downconvert` helper is still there if a future format gap
  // ever needs the same treatment.

  return { ok: true, shots, loads, diff, fixtureRecords: fixture.records.length }
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

function renderDoc(data) {
  const { machine, browser, matrix, ns, kinds, repeats, compare, versions, date } = data
  const md = []
  md.push("# Benchmark: mocanvas vs tldraw")
  md.push("")
  md.push(`_Generated ${date} by \`apps/bench/scripts/bench.mjs\`. Re-run with \`pnpm --filter bench bench\`._`)
  md.push("")
  md.push("Both libraries are driven through an identical `window.bench` API (`apps/bench/src/bench-api.ts`)")
  md.push("with byte-identical workloads: same grid, same shape sizes, colours and fills, the same scripted")
  md.push("camera path, and the same hit-test sample points. Frame times are frame-to-frame `requestAnimationFrame`")
  md.push("deltas recorded while a camera animation runs (zoom to fit → zoom in 4× → horizontal pan sweep → zoom back out).")
  md.push("")

  if (matrix?.mocanvas) {
    md.push("## What changed since the previous run")
    md.push("")
    md.push(`Two changes landed between the previous published numbers (${PREVIOUS.date}, git \`${PREVIOUS.git}\`) and this run:`)
    md.push("")
    md.push("- **`.tldr` loading was fixed.** `normalizeLoadedRecords` (`packages/editor/src/records/normalize.ts`)")
    md.push("  now maps `props.richText` onto `props.text` and decodes packed freehand `segments[].path` into")
    md.push("  `segments[].points` while records are loaded. The previous run could not open the tldraw-authored")
    md.push("  fixture at all — it threw and left a blank canvas — so the rendering comparison below was measured")
    md.push("  against nothing. mocanvas now loads and draws the unmodified file.")
    md.push("- **Renderer.** A per-frame tessellation budget (256 shapes), frame reuse keyed on scene epoch + zoom")
    md.push("  bucket + viewport containment, and LOD hysteresis. All three target the same thing: the long frames")
    md.push("  where the camera moves but the scene did not.")
    md.push("")
    md.push("95th-percentile pan/zoom frame — the metric those renderer changes target. tldraw's column is the")
    md.push("control: its code did not change between the two runs, so whatever it moved by is what this environment")
    md.push("does on its own.")
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
        const moWas = PREVIOUS.panP95[key]
        const tlWas = PREVIOUS.tldrawPanP95[key]
        md.push(`| ${int(n)} | ${kind} | ${fmt(moWas, 1)} → ${fmt(mo, 1)} ms | ${pct(moWas, mo)} | ${fmt(tlWas, 1)} → ${fmt(tl, 1)} ms | ${pct(tlWas, tl)} |`)
      }
    }
    md.push("")
    md.push("**Read the control column before reading the first one.** tldraw ran the same code in both runs and still")
    md.push("moved by -25% to +42%: this environment was faster on `geo` and slower on `mixed` than it was two hours")
    md.push("earlier. mocanvas's column has the same shape — large gains on `geo` and at 20,000 `mixed`, nothing or a")
    md.push("small loss on the two small `mixed` cases — so a fair reading is that the renderer changes helped where")
    md.push("there is real work to skip, and that everything else here is the machine, not the code. Frame deltas are")
    md.push("also quantised to the browser's frame cadence (most values land on multiples of ~8.3 ms), which turns a")
    md.push("small real change into a whole bucket or into nothing at all.")
    md.push("")
    md.push("The clean measurement of those renderer changes is not this table but the interleaved A/B in")
    md.push("`apps/bench/results/panzoom-after.json`, which toggles frame reuse and the tessellation budget off and on")
    md.push("within a single browser session: it puts the p95 improvement at 16–31% between 5,000 and 20,000 shapes.")
    md.push("")
    if (compare?.ok && !compare.diff?.error) {
      const before = PREVIOUS.compare
      md.push("Rendering comparison against the same `.tldr` fixture:")
      md.push("")
      md.push("| | before | after |")
      md.push("| :--- | :--- | :--- |")
      md.push(`| mocanvas loaded the file | ${before.loaded ? "yes" : "no — threw on `props.richText`"} | ${compare.loads.mocanvas.ok ? "yes" : `no — ${compare.loads.mocanvas.error}`} |`)
      md.push(`| Painted pixels, mocanvas | ${int(before.inkPixelsMocanvas)} | ${int(compare.diff.inkPixelsMocanvas)} |`)
      md.push(`| Painted-pixel overlap (IoU) | ${fmt(before.inkOverlapPercent, 1)}% | **${fmt(compare.diff.inkOverlapPercent, 1)}%** |`)
      md.push(`| Differing pixels | ${fmt(before.diffPercent, 2)}% | ${fmt(compare.diff.diffPercent, 2)}% |`)
      md.push("")
      md.push("The differing-pixel row is the one that reads backwards, and it is worth understanding before")
      md.push("quoting either number — see [the note under the comparison](#rendering-comparison).")
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
  if (String(versions.git).endsWith("-dirty") && RUN_NOTE) {
    md.push(`_${RUN_NOTE}_`)
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
      md.push("| | |")
      md.push("| :--- | ---: |")
      md.push(`| Differing pixels | **${compare.diff.diffPercent.toFixed(2)}%** (${int(compare.diff.differentPixels)} of ${int(compare.diff.totalPixels)}) |`)
      md.push(`| Tolerance | any channel differing by more than ${compare.diff.tolerance}/255 |`)
      md.push(`| Painted (non-white) pixels, mocanvas | ${int(compare.diff.inkPixelsMocanvas)} |`)
      md.push(`| Painted (non-white) pixels, tldraw | ${int(compare.diff.inkPixelsTldraw)} |`)
      md.push(`| Painted-pixel overlap (IoU) | **${compare.diff.inkOverlapPercent.toFixed(1)}%** |`)
      md.push("")
      md.push("**Read the overlap row, not the differing-pixels row.** \"Differing pixels\" is a poor headline for this")
      md.push("comparison and moves in misleading ways: tldraw inks only about 12% of the canvas, so a render that draws")
      md.push("too little scores well on it. The previous run is the proof — mocanvas painted *nothing* there and still")
      md.push(`scored 11.84% differing pixels, against ${compare.diff.diffPercent.toFixed(2)}% for the render that now draws the whole document — because a blank canvas`)
      md.push("disagrees only where tldraw drew something. mocanvas now paints in nearly the same places but with a")
      md.push("different stroke, fill and font, so the union of disagreeing pixels stays about as large while the picture")
      md.push("is enormously closer. The painted-pixel overlap (intersection over union) is the metric that reflects")
      md.push(`that: of every pixel either side inked, ${compare.diff.inkOverlapPercent.toFixed(1)}% were inked by both.`)
      md.push("")
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
      md.push("2. **`draw: segment has no \"points\" array (encoded \"path\" is not decoded)`.** tldraw stores freehand")
      md.push("   strokes as `segments[].path`, a base64-packed point buffer, rather than the older `segments[].points`")
      md.push("   array. The same normalisation pass decodes it, which is why the freehand wave renders above — the")
      md.push("   parenthetical in that message describes the old behaviour and is simply wrong now. The check has been")
      md.push("   reworded in the bench page since this run; the line above is the wording that was recorded during it.")
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
  }
  if (matrix?.tldraw && PREVIOUS?.tldrawPanP95) {
    md.push("- **Run-to-run spread is wide here, so do not read small differences.** tldraw's code did not change")
    md.push("  between this run and the previous one, and its 95th-percentile pan/zoom frame still moved by -25% to")
    md.push("  +42% across the matrix (see \"What changed since the previous run\"). Anything smaller than that on a")
    md.push("  single metric is this machine, not either library. Comparisons made inside one browser session — the")
    md.push("  mocanvas/tldraw pairs here, or the A/B in `panzoom-after.json` — are the ones worth quoting.")
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
  md.push("- **The pan/zoom numbers do not measure the same work in both libraries, and this favours tldraw.** A")
  md.push("  `requestAnimationFrame` delta captures main-thread time. tldraw moves the camera by setting a CSS transform")
  md.push("  on a container, so the pan/zoom sweep costs it almost no main-thread work — the compositor does the moving,")
  md.push("  off-thread and unmeasured. mocanvas redraws the scene through WebGL2 on the main thread every frame, so its")
  md.push("  number includes the entire render. Read the pan/zoom tables as \"main-thread cost per frame\", not as \"which")
  md.push("  library draws faster\": a low tldraw number there partly means the work moved somewhere this benchmark")
  md.push("  cannot see. The `selectAllDragRun` numbers are the fairer frame-time comparison, because mutating shapes")
  md.push("  forces both libraries to actually re-render.")
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

  const launched = await launchBrowser({ chromium }, server.url)
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
