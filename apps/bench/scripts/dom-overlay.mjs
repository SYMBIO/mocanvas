/**
 * DOM-overlay benchmark: what an app's own React shapes cost while the camera moves.
 *
 * `bench.mjs` measures the built-in shapes, which the GPU draws; the DOM overlay
 * there is a handful of labels, and its pan/zoom numbers sit at the frame cadence.
 * This driver measures the other half — `ShapeUtil.component` cards of ~150 nodes
 * each (`src/dom-card.tsx`), cullable (`dom`) and not (`dom-live`) — through four
 * gestures, each paced one input per animation frame:
 *
 *   zoom   ctrl+wheel events dispatched inside the page, 30 in then 30 out, about
 *          the viewport centre, from zoom 0.5
 *   pan    wheel events (deltaX 20 px), 60 right then 60 back, from the board's
 *          left edge at zoom 0.5 — cards cross the viewport edge both ways
 *   drag   one card dragged 60 × 6 px with Playwright's real mouse, at zoom 1
 *   hover  Playwright's real mouse swept across the viewport in 60 moves, zoom 0.5
 *
 * Per gesture it records, inside a window marked with `console.timeStamp`:
 *
 *   - main-thread busy ms per frame, p50 / p95: the renderer main thread's
 *     top-level tasks from a Chromium trace, summed per `BeginMainThreadFrame`
 *     interval — not rAF deltas, which floor at the cadence;
 *   - style recalc and layout ms per input step (CDP `Performance.getMetrics`);
 *   - React commits (a stub DevTools hook counts `onCommitFiberRoot`);
 *   - card mounts / unmounts / renders (the card counts its own);
 *   - Long Animation Frames (> 50 ms), count and total blocking ms.
 *
 * Every (lib, N, kind, gesture, repeat) gets a fresh page, and shapes are created
 * with the camera already at the gesture's start, so nothing is mounted that the
 * gesture would not mount.
 *
 * Usage:
 *   pnpm --filter bench dom-overlay -- --label=baseline
 *   pnpm --filter bench dom-overlay -- --n=50,200 --repeats=1 --gestures=pan --label=quick
 *   pnpm --filter bench dom-overlay -- --grid=off --label=nogrid   (mocanvas starts in grid mode)
 *   node scripts/dom-overlay.mjs --compare=results/dom-overlay-baseline.json,results/dom-overlay-after.json
 */
import { chromium } from "playwright"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import { resolve } from "node:path"
import { REPO_ROOT, ROOT, VIEWPORT, buildApp, launchBrowser, median, startPreview } from "./lib.mjs"

const RESULTS_DIR = resolve(ROOT, "results")
const GESTURES = ["zoom", "pan", "drag", "hover"]
const KINDS = ["dom", "dom-live"]
/** Must match `DOM_CELL` / `DOM_CARD` in `src/bench-api.ts`. */
const CELL = { x: 320, y: 240 }
const CARD = { w: 280, h: 200 }

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "toplevel",
  "blink.console",
]

/**
 * A stand-in for the React DevTools hook, installed before React loads. React's
 * production build reports every commit to it, which is a commit counter that
 * needs no profiling build.
 */
const REACT_HOOK = `(() => {
  const counts = (window.__reactCommits = { commits: 0 })
  let id = 0
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(renderer) { id++; this.renderers.set(id, renderer); return id },
    onCommitFiberRoot() { counts.commits++ },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    checkDCE() {},
  }
})()`

function parseArgs(argv) {
  const opts = { n: [50, 200, 1000], kinds: KINDS, gestures: GESTURES, libs: ["mocanvas"], repeats: 3, grid: "default", label: "run", build: true, gl: process.platform === "darwin" ? "hardware" : "auto", compare: null }
  for (const a of argv) {
    const [k, v] = a.replace(/^--/, "").split("=")
    if (k === "n") opts.n = v.split(",").map(Number)
    else if (k === "kinds") opts.kinds = v.split(",")
    else if (k === "gestures") opts.gestures = v.split(",")
    else if (k === "libs") opts.libs = v.split(",")
    else if (k === "repeats") opts.repeats = Number(v)
    else if (k === "label") opts.label = v
    else if (k === "no-build") opts.build = false
    else if (k === "gl") opts.gl = v
    else if (k === "compare") opts.compare = v.split(",")
    else if (k === "grid") opts.grid = v
  }
  return opts
}

function boardSize(n) {
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  return { w: (cols - 1) * CELL.x + CARD.w, h: (rows - 1) * CELL.y + CARD.h, cols, rows }
}

/** `screen = (page + cam) * z`, so the camera that puts `p` at the viewport centre. */
function cameraAt(p, z) {
  return { x: -p.x + VIEWPORT.width / (2 * z), y: -p.y + VIEWPORT.height / (2 * z), z }
}

/** The camera each gesture starts from. */
function startCamera(gesture, n) {
  const b = boardSize(n)
  const centre = { x: b.w / 2, y: b.h / 2 }
  switch (gesture) {
    case "zoom":
    case "hover":
      return cameraAt(centre, 0.5)
    case "pan":
      // Board's left edge at the viewport's left edge, vertically centred.
      return { x: 0, y: -centre.y + VIEWPORT.height, z: 0.5 }
    case "drag":
      return cameraAt(dragCard(n).centre, 1)
  }
  throw new Error(`unknown gesture ${gesture}`)
}

/** The card the drag picks up: the one nearest the board's centre. */
function dragCard(n) {
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const col = Math.floor((cols - 1) / 2)
  const row = Math.floor((rows - 1) / 2)
  return { centre: { x: col * CELL.x + CARD.w / 2, y: row * CELL.y + CARD.h / 2 } }
}

const raf = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())))

async function settle(page, frames = 10) {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r()))
  }, frames)
}

/** In-page wheel stream: one event per frame at the viewport centre. */
async function wheelStream(page, events) {
  await page.evaluate(async (list) => {
    const cx = innerWidth / 2
    const cy = innerHeight / 2
    for (const ev of list) {
      // Re-resolved every step: the element under the pointer can be a card the
      // last frame unmounted, and an event on a detached node reaches nobody.
      const target = document.elementFromPoint(cx, cy) ?? document.body
      target.dispatchEvent(new WheelEvent("wheel", { ...ev, clientX: cx, clientY: cy, bubbles: true, cancelable: true, composed: true }))
      await new Promise((r) => requestAnimationFrame(() => r()))
    }
  }, events)
  return events.length
}

async function runGesture(page, gesture) {
  switch (gesture) {
    case "zoom": {
      const events = []
      for (let i = 0; i < 60; i++) events.push({ deltaY: i < 30 ? -5 : 5, ctrlKey: true })
      return wheelStream(page, events)
    }
    case "pan": {
      const events = []
      for (let i = 0; i < 120; i++) events.push({ deltaX: i < 60 ? 20 : -20, deltaY: 0 })
      return wheelStream(page, events)
    }
    case "drag": {
      const x = VIEWPORT.width / 2
      const y = VIEWPORT.height / 2
      await page.mouse.move(x, y)
      await raf(page)
      await page.mouse.down()
      await raf(page)
      for (let i = 1; i <= 60; i++) {
        await page.mouse.move(x + i * 6, y + i * 2)
        await raf(page)
      }
      await page.mouse.up()
      await raf(page)
      return 60
    }
    case "hover": {
      const y = VIEWPORT.height / 2
      for (let i = 0; i < 60; i++) {
        await page.mouse.move(20 + (i * (VIEWPORT.width - 40)) / 59, y + 60 * Math.sin(i / 6))
        await raf(page)
      }
      return 60
    }
  }
  throw new Error(`unknown gesture ${gesture}`)
}

async function openPage(browser, url, lib) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  page.setDefaultTimeout(180_000)
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.addInitScript(REACT_HOOK)
  await page.goto(`${url}/?lib=${lib}`, { waitUntil: "load" })
  await page.waitForFunction(() => Boolean(window.bench?.isReady()), null, { timeout: 120_000 })
  await page.evaluate(() => window.bench.screenshotReady())
  return { page, errors }
}

function metricMap(res) {
  return Object.fromEntries(res.metrics.map((m) => [m.name, m.value]))
}

/** Reduce a trace to the numbers above. */
function analyzeTrace(events) {
  const mark = (msg) => events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === msg)
  const start = mark("dom-bench:start")
  const end = mark("dom-bench:end")
  if (!start || !end) return null
  const { pid, tid } = start
  const onMain = (e) => e.pid === pid && e.tid === tid && e.ts >= start.ts && e.ts <= end.ts
  const main = events.filter(onMain)
  // Top-level tasks: `RunTask` not nested inside another `RunTask`.
  const tasks = main.filter((e) => e.ph === "X" && e.name === "RunTask").sort((a, b) => a.ts - b.ts)
  const top = []
  let coverEnd = -Infinity
  for (const t of tasks) {
    if (t.ts >= coverEnd) {
      top.push(t)
      coverEnd = t.ts + (t.dur ?? 0)
    }
  }
  const frames = events
    .filter((e) => e.name === "BeginMainThreadFrame" && e.pid === pid && e.ts >= start.ts && e.ts <= end.ts)
    .map((e) => e.ts)
    .sort((a, b) => a - b)
  const perFrame = []
  for (let i = 0; i + 1 < frames.length; i++) {
    const lo = frames[i]
    const hi = frames[i + 1]
    let busy = 0
    for (const t of top) {
      const a = Math.max(lo, t.ts)
      const b = Math.min(hi, t.ts + (t.dur ?? 0))
      if (b > a) busy += b - a
    }
    perFrame.push(busy / 1000)
  }
  const sum = (name) => main.filter((e) => e.ph === "X" && e.name === name).reduce((s, e) => s + (e.dur ?? 0), 0) / 1000
  const sorted = [...perFrame].sort((a, b) => a - b)
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))] : null)
  return {
    frames: frames.length,
    mainP50: pct(0.5),
    mainP95: pct(0.95),
    mainTotal: top.reduce((s, t) => s + (t.dur ?? 0), 0) / 1000,
    traceStyleMs: sum("UpdateLayoutTree"),
    traceLayoutMs: sum("Layout"),
    wallMs: (end.ts - start.ts) / 1000,
  }
}

async function measure(browser, page, gesture) {
  await page.evaluate(() => {
    window.__domBench = { renders: 0, mounts: 0, unmounts: 0 }
    window.__reactCommits.commits = 0
    const loaf = (window.__loaf = { count: 0, blockingMs: 0 })
    try {
      window.__loafObserver?.disconnect()
      window.__loafObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          loaf.count++
          loaf.blockingMs += e.blockingDuration ?? 0
        }
      })
      window.__loafObserver.observe({ type: "long-animation-frame", buffered: false })
    } catch {
      /* not supported */
    }
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable")
  await browser.startTracing(page, { categories: TRACE_CATEGORIES })
  await page.evaluate(() => console.timeStamp("dom-bench:start"))
  const before = metricMap(await cdp.send("Performance.getMetrics"))
  const steps = await runGesture(page, gesture)
  await settle(page, 2)
  const after = metricMap(await cdp.send("Performance.getMetrics"))
  await page.evaluate(() => console.timeStamp("dom-bench:end"))
  const buf = await browser.stopTracing()
  await cdp.detach()
  const trace = JSON.parse(buf.toString("utf8"))
  const analysis = analyzeTrace(trace.traceEvents ?? trace)
  const counters = await page.evaluate(() => ({ ...window.__domBench, commits: window.__reactCommits.commits, loaf: { ...window.__loaf } }))
  const delta = (k) => ((after[k] ?? 0) - (before[k] ?? 0)) * 1000
  return {
    steps,
    ...analysis,
    styleMsPerStep: delta("RecalcStyleDuration") / steps,
    layoutMsPerStep: delta("LayoutDuration") / steps,
    scriptMsPerStep: delta("ScriptDuration") / steps,
    taskMsPerStep: delta("TaskDuration") / steps,
    commits: counters.commits,
    mounts: counters.mounts,
    unmounts: counters.unmounts,
    renders: counters.renders,
    loafCount: counters.loaf.count ?? 0,
    loafBlockingMs: counters.loaf.blockingMs ?? 0,
  }
}

const FIELDS = ["mainP50", "mainP95", "mainTotal", "styleMsPerStep", "layoutMsPerStep", "scriptMsPerStep", "taskMsPerStep", "commits", "mounts", "unmounts", "renders", "loafCount", "loafBlockingMs", "frames", "wallMs"]

function medianOf(runs) {
  const out = {}
  for (const f of FIELDS) out[f] = median(runs.map((r) => r[f]))
  return out
}

function gitRev() {
  try {
    const rev = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim()
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" }).trim()
    return dirty ? `${rev}-dirty` : rev
  } catch {
    return "unknown"
  }
}

const fmt = (v, d = 2) => (v === null || v === undefined ? "–" : Number(v).toFixed(d))

function table(results, libs) {
  const lines = []
  lines.push("| lib | N | kind | gesture | main p50 ms | main p95 ms | style ms/step | layout ms/step | commits | mounts | unmounts | renders | LoAF |")
  lines.push("| :-- | --: | :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |")
  for (const r of results) {
    if (!libs.includes(r.lib)) continue
    const m = r.median
    lines.push(`| ${r.lib} | ${r.n} | ${r.kind} | ${r.gesture} | ${fmt(m.mainP50)} | ${fmt(m.mainP95)} | ${fmt(m.styleMsPerStep)} | ${fmt(m.layoutMsPerStep)} | ${fmt(m.commits, 0)} | ${fmt(m.mounts, 0)} | ${fmt(m.unmounts, 0)} | ${fmt(m.renders, 0)} | ${fmt(m.loafCount, 0)} |`)
  }
  return lines.join("\n")
}

function compareTable(a, b) {
  const key = (r) => `${r.lib}|${r.n}|${r.kind}|${r.gesture}`
  const byKey = new Map(b.results.map((r) => [key(r), r]))
  const lines = []
  lines.push(`| N | kind | gesture | main p50 ms | main p95 ms | style ms/step | commits | mounts | unmounts | renders |`)
  lines.push(`| --: | :-- | :-- | --: | --: | --: | --: | --: | --: | --: |`)
  const pair = (x, y, d = 2) => `${fmt(x, d)} → ${fmt(y, d)}`
  for (const ra of a.results) {
    const rb = byKey.get(key(ra))
    if (!rb) continue
    const x = ra.median
    const y = rb.median
    lines.push(`| ${ra.n} | ${ra.kind} | ${ra.gesture} | ${pair(x.mainP50, y.mainP50)} | ${pair(x.mainP95, y.mainP95)} | ${pair(x.styleMsPerStep, y.styleMsPerStep)} | ${pair(x.commits, y.commits, 0)} | ${pair(x.mounts, y.mounts, 0)} | ${pair(x.unmounts, y.unmounts, 0)} | ${pair(x.renders, y.renders, 0)} |`)
  }
  return lines.join("\n")
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.compare) {
    const [a, b] = await Promise.all(opts.compare.map(async (p) => JSON.parse(await readFile(resolve(ROOT, p), "utf8"))))
    console.log(`Before: ${a.meta.label} (${a.meta.rev}, ${a.meta.date})\nAfter: ${b.meta.label} (${b.meta.rev}, ${b.meta.date})\n`)
    console.log(compareTable(a, b))
    return
  }
  const rev = gitRev()
  if (opts.build) {
    console.log("building bench app (production)…")
    await buildApp()
  }
  const preview = await startPreview(5183)
  const launched = await launchBrowser({ chromium }, preview.url, { gl: opts.gl })
  const { browser } = launched
  console.log(`chromium ${launched.version}, ${launched.gpu.renderer}`)
  const results = []
  try {
    for (const lib of opts.libs) {
      for (const n of opts.n) {
        for (const kind of opts.kinds) {
          for (const gesture of opts.gestures) {
            const runs = []
            for (let rep = 0; rep < opts.repeats; rep++) {
              const { page, errors } = await openPage(browser, preview.url, lib)
              try {
                // mocanvas starts in grid mode and tldraw does not; `--grid=off`
                // measures both without one, `--grid=on` both with.
                if (opts.grid !== "default") await page.evaluate((on) => window.editor.updateInstanceState({ isGridMode: on }), opts.grid === "on")
                await page.evaluate((cam) => window.bench.setCamera(cam), startCamera(gesture, n))
                await page.evaluate(([count, k]) => window.bench.create(count, k, false), [n, kind])
                await settle(page, 20)
                const run = await measure(browser, page, gesture)
                if (errors.length) run.errors = errors.slice(0, 5)
                runs.push(run)
              } finally {
                await page.close()
              }
            }
            const row = { lib, n, kind, gesture, runs, median: medianOf(runs) }
            results.push(row)
            const m = row.median
            console.log(`${lib} n=${n} ${kind} ${gesture}: main p50 ${fmt(m.mainP50)} p95 ${fmt(m.mainP95)} ms, style ${fmt(m.styleMsPerStep)} ms/step, commits ${m.commits}, mounts ${m.mounts}, unmounts ${m.unmounts}, renders ${m.renders}`)
          }
        }
      }
    }
  } finally {
    await browser.close()
    await preview.close()
  }
  const out = {
    meta: {
      label: opts.label,
      date: new Date().toISOString(),
      rev,
      machine: `${os.cpus()[0]?.model ?? "unknown"}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB`,
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      node: process.version,
      browser: launched.version,
      renderer: launched.gpu.renderer,
      gl: launched.mode,
      viewport: VIEWPORT,
      repeats: opts.repeats,
      grid: opts.grid,
    },
    results,
  }
  await mkdir(RESULTS_DIR, { recursive: true })
  const file = resolve(RESULTS_DIR, `dom-overlay-${opts.label}.json`)
  await writeFile(file, JSON.stringify(out, null, 2) + "\n")
  console.log(`\nwrote ${file}\n`)
  console.log(table(results, opts.libs))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
