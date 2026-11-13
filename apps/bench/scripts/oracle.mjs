#!/usr/bin/env node
/**
 * The oracle: ask both libraries the same questions and fail on a new answer.
 *
 * mocanvas's own test suite checks mocanvas against what its author believed
 * tldraw does. It cannot check the belief, which is why every divergence fixed
 * on 2026-11-12 was found by a consumer running the two side by side rather
 * than here. This asks tldraw directly: `oracle/probes.mjs` holds the
 * questions, both pages answer them in one browser, and anything that differs
 * and is not already written down in `oracle/divergences.json` fails the run.
 *
 * Usage, from the repo root:
 *
 *   pnpm --filter bench oracle                 # the gate CI runs
 *   pnpm --filter bench oracle --probes=text-shape-size-by-font,note-grow
 *   pnpm --filter bench oracle --update        # re-record divergences, then write the reasons
 *   pnpm --filter bench oracle --headed        # watch the gestures happen
 *
 * Exit codes: 0 agreed (or every difference accounted for), 1 a new divergence,
 * 2 the harness itself could not run.
 *
 * Clean room: this drives tldraw through its public API and reads what it
 * returns. It never reads tldraw's source, and nothing it prints is copied into
 * `packages/**` — a divergence is a question for a human (docs/CLEAN_ROOM.md).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { ROOT, buildApp, launchBrowser, openBenchPage, startPreview } from "./lib.mjs"
import { helpersSource, probes } from "../oracle/probes.mjs"
import { classify, diff, show } from "../oracle/compare.mjs"

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const DIVERGENCES = join(ROOT, "oracle/divergences.json")
const OUT = opt("out", join(ROOT, "results/oracle.json"))
const ONLY = opt("probes", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
const UPDATE = flag("update")
const HEADED = flag("headed")
/**
 * Software rasterisation by default. Nothing here is a frame time, and the
 * point of this gate is that two runs on two machines produce the same answer —
 * so take the renderer that does not depend on which GPU the runner has.
 */
const GL = opt("gl", "software")
const PROBE_TIMEOUT_MS = Number(opt("timeout", "60000"))

/** The accepted-divergence file, as `{ entries: [...] }`. */
function readAccepted() {
  try {
    const parsed = JSON.parse(readFileSync(DIVERGENCES, "utf8"))
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch (e) {
    if (e.code === "ENOENT") return []
    throw new Error(`${DIVERGENCES} is not readable JSON: ${e.message}`)
  }
}

/**
 * Run one probe body on a page.
 *
 * The body is serialised to source and evaluated there, so a probe closes over
 * nothing and both libraries get byte-identical code.
 */
async function evalInPage(page, fnSource, label) {
  return await page.evaluate(
    async ({ src, helpersSrc }) => {
      const h = (0, eval)(helpersSrc)
      const fn = (0, eval)(`(${src})`)
      const value = await fn(window.editor, h, window.oracleKit)
      // Prove it survives the wire in the page, where the probe can still be
      // named, rather than as an opaque serialisation failure in the driver.
      JSON.stringify(value === undefined ? null : value)
      return value === undefined ? null : value
    },
    { src: fnSource, helpersSrc: helpersSource },
  ).catch((e) => {
    throw new Error(`${label}: ${e.message}`)
  })
}

/**
 * Let the page render before and after a gesture.
 *
 * A gesture aims at what the editor has laid out, not at what it was told a
 * moment ago: pressing a selection's resize handle in the same tick it was
 * selected finds no handle, and the press lands on the canvas instead. Two
 * frames each side — found by a probe that resized in a one-page debug run and
 * did nothing in the harness, where the only difference was these waits.
 */
async function settle(page, frames = 2) {
  for (let i = 0; i < frames; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
}

const MODIFIERS = ["Shift", "Control", "Alt", "Meta"]

/**
 * The platform's accelerator, which a step asks for as `"$accel"`.
 *
 * Not a convenience: on macOS ctrl+click *is* a right click, so a probe that
 * holds Control through a press is not testing the accelerator at all — the
 * browser turns the press into a context menu, the editor drops it, and the
 * Control keyup never arrives either, which leaves the modifier stuck down for
 * every probe after it. Both libraries read the platform accelerator, so
 * asking for the right key is also the more honest question.
 */
const ACCEL = process.platform === "darwin" ? "Meta" : "Control"

/** Perform a gesture probe's steps with real pointer and keyboard events. */
async function playSteps(page, steps) {
  for (const s of steps) {
    const key = s.value === "$accel" ? ACCEL : s.value
    if (s.mouse === "move") await page.mouse.move(s.x, s.y, { steps: s.steps ?? 1 })
    else if (s.mouse === "down") await page.mouse.down()
    else if (s.mouse === "up") await page.mouse.up()
    else if (s.key === "down") await page.keyboard.down(key)
    else if (s.key === "up") await page.keyboard.up(key)
    else if (s.wait) await page.waitForTimeout(s.wait)
    else throw new Error(`unknown step: ${JSON.stringify(s)}`)
    // Both libraries queue pointer work onto a frame; stepping past one keeps
    // the drag a drag rather than a teleport.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
  }
}

/** Reload a page back to a freshly mounted editor. */
async function freshen(ctx) {
  await ctx.page.reload({ waitUntil: "load" })
  await ctx.page.waitForFunction(() => Boolean(window.bench?.isReady()), null, { timeout: 120_000 })
  await ctx.page.evaluate(() => window.bench.screenshotReady())
}

/**
 * Put the pointer and the modifiers back where the next probe expects them.
 *
 * Releasing is not enough on its own — an editor only knows a key went up if
 * the event reached it — so this asks the page what it still believes and
 * reloads when the answer is wrong. A probe that inherits a held modifier
 * fails in a way that reads as a divergence, which is the most expensive kind
 * of harness bug there is.
 */
async function clearInput(ctx) {
  /** Returns the modifiers the editor still believed were held, if any. */
  await ctx.page.mouse.up().catch(() => {})
  for (const m of MODIFIERS) await ctx.page.keyboard.up(m).catch(() => {})
  const stuck = await ctx.page
    .evaluate(() => {
      const i = window.editor?.inputs
      if (!i) return []
      return ["shiftKey", "ctrlKey", "altKey", "metaKey"].filter((k) => i[k])
    })
    .catch(() => [])
  if (stuck.length) await freshen(ctx)
  return stuck
}

async function runProbe(ctx, probe) {
  if (probe.pure) await freshen(ctx)
  const timed = (p) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${PROBE_TIMEOUT_MS} ms`)), PROBE_TIMEOUT_MS))])
  try {
    if (probe.setup) {
      await timed(evalInPage(ctx.page, String(probe.setup), `${probe.id} setup`))
      await timed(settle(ctx.page))
    }
    if (probe.steps) {
      await timed(playSteps(ctx.page, probe.steps))
      await timed(settle(ctx.page))
    }
    const value = await timed(evalInPage(ctx.page, String(probe.run), probe.id))
    if (probe.steps) ctx.stuck = await clearInput(ctx)
    return value
  } catch (e) {
    if (probe.steps) await clearInput(ctx).catch(() => {})
    return { __error: String(e.message ?? e) }
  }
}

async function main() {
  const selected = ONLY.length ? probes.filter((p) => ONLY.includes(p.id)) : probes
  if (ONLY.length) {
    const missing = ONLY.filter((id) => !probes.some((p) => p.id === id))
    if (missing.length) {
      console.error(`no such probe: ${missing.join(", ")}`)
      process.exit(2)
    }
  }
  const accepted = readAccepted()

  console.log(`building the bench app…`)
  await buildApp()
  const preview = await startPreview(5186)
  let launched
  try {
    launched = await launchBrowser({ chromium }, preview.url, { headed: HEADED, gl: GL })
  } catch (e) {
    await preview.close()
    console.error(`could not launch a browser: ${e.message}`)
    process.exit(2)
  }
  const { browser } = launched

  const results = []
  let newCount = 0
  let knownCount = 0
  let openCount = 0
  try {
    const moc = await openBenchPage(browser, preview.url, "mocanvas")
    const tld = await openBenchPage(browser, preview.url, "tldraw")

    // A probe that asks the kit for something the page does not export would
    // otherwise fail as a divergence on one side only, which reads as a bug in
    // the library rather than a hole in the harness.
    for (const [name, ctx] of [["mocanvas", moc], ["tldraw", tld]]) {
      const kit = await ctx.page.evaluate(() => (window.oracleKit ? Object.keys(window.oracleKit).sort() : null))
      if (!kit) {
        throw new Error(`the ${name} page did not install window.oracleKit — see apps/bench/src/pages/`)
      }
    }

    for (const probe of selected) {
      process.stdout.write(`  ${probe.id} … `)
      const mocanvas = await runProbe(moc, probe)
      const tldraw = await runProbe(tld, probe)
      const differences = diff(mocanvas, tldraw, probe.tolerance ?? {})
      const { known, new: news, unused } = classify(probe.id, differences, accepted)
      knownCount += known.length
      openCount += known.filter((d) => d.status === "open").length
      newCount += news.length
      results.push({ id: probe.id, title: probe.title, about: probe.about ?? null, mocanvas, tldraw, known, new: news, unused })
      const open = known.filter((d) => d.status === "open").length
      const stuck = [...new Set([...(moc.stuck ?? []), ...(tld.stuck ?? [])])]
      moc.stuck = tld.stuck = []
      const note = stuck.length ? `  (${stuck.join(", ")} stayed held; pages reloaded)` : ""
      console.log(
        (news.length ? `${news.length} NEW` : known.length ? `${known.length} known${open ? `, ${open} undecided` : ""}` : "agree") + note,
      )
    }
  } catch (e) {
    await browser.close().catch(() => {})
    await preview.close()
    console.error(`\nthe harness itself failed: ${e.message}`)
    process.exit(2)
  } finally {
    await browser.close().catch(() => {})
    await preview.close()
  }

  // ---- report -------------------------------------------------------------
  const unusedAll = results.flatMap((r) => r.unused.map((u) => ({ ...u, probe: r.id })))
  const report = {
    at: new Date().toISOString(),
    browser: launched.version,
    renderer: launched.gpu?.renderer ?? null,
    probes: selected.length,
    agreed: results.filter((r) => !r.new.length && !r.known.length).length,
    known: knownCount,
    open: openCount,
    new: newCount,
    unusedAccepted: unusedAll,
    results,
  }
  mkdirSync(join(ROOT, "results"), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))

  console.log(`\n${"=".repeat(72)}`)
  for (const r of results) {
    if (!r.new.length && !r.known.length) continue
    console.log(`\n${r.id} — ${r.title}`)
    if (r.about) console.log(`  ${r.about}`)
    for (const d of r.new) {
      console.log(`  NEW   ${d.path || "<root>"}`)
      console.log(`          mocanvas ${show(d.mocanvas)}`)
      console.log(`          tldraw   ${show(d.tldraw)}`)
    }
    const open = r.known.filter((d) => d.status === "open")
    for (const d of open.slice(0, 3)) {
      console.log(`  open  ${d.path || "<root>"} — ${d.reason}`)
      console.log(`          mocanvas ${show(d.mocanvas)}  ·  tldraw ${show(d.tldraw)}`)
    }
    if (open.length > 3) console.log(`  open  … and ${open.length - 3} more undecided`)
    const settled = r.known.length - open.length
    if (settled) console.log(`  (${settled} accepted difference${settled === 1 ? "" : "s"})`)
  }

  if (UPDATE) {
    const entries = [...accepted]
    for (const r of results) {
      for (const d of r.new) {
        entries.push({
          probe: r.id,
          path: d.path,
          reason: "TODO: say why mocanvas is right to differ here, or fix it",
          since: new Date().toISOString().slice(0, 10),
          mocanvasWas: d.mocanvas ?? null,
          tldrawWas: d.tldraw ?? null,
        })
      }
    }
    writeFileSync(
      DIVERGENCES,
      JSON.stringify({ about: ACCEPTED_FILE_ABOUT, entries }, null, 2) + "\n",
    )
    console.log(`\nrecorded ${newCount} difference(s) into ${DIVERGENCES}.`)
    console.log(`Every new entry says TODO. Replace each one with the reason, or fix the divergence —`)
    console.log(`a run without --update fails while a TODO is still there.`)
    process.exit(0)
  }

  const todos = accepted.filter((a) => /^TODO/i.test(String(a.reason ?? "")))
  console.log(`\n${"=".repeat(72)}`)
  console.log(
    `${results.length} probes — ${report.agreed} agree, ${knownCount - openCount} accepted, ${openCount} undecided, ${newCount} new`,
  )
  if (unusedAll.length) {
    console.log(`\n${unusedAll.length} accepted divergence(s) matched nothing and should be deleted:`)
    for (const u of unusedAll) console.log(`  ${u.probe} ${u.path} — ${u.reason}`)
  }
  if (todos.length) {
    console.log(`\n${todos.length} accepted divergence(s) still say TODO:`)
    for (const t of todos) console.log(`  ${t.probe} ${t.path}`)
  }
  console.log(`\nfull report: ${OUT}`)

  if (newCount) {
    console.log(`\nA new divergence is not automatically a bug in mocanvas — tldraw is the`)
    console.log(`reference, not the authority. Decide, then either fix it or write the`)
    console.log(`reason into oracle/divergences.json.`)
  }
  process.exit(newCount || todos.length || unusedAll.length ? 1 : 0)
}

const ACCEPTED_FILE_ABOUT = [
  "Differences from tldraw that mocanvas keeps on purpose, and the reason for each.",
  "`path` is exact, or a prefix ending in `.*`, or `*` for the whole probe.",
  "An entry that matches nothing fails the run: prune it rather than leaving it.",
  "Regenerate the raw entries with `pnpm --filter bench oracle --update`, then write the reasons.",
].join(" ")

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
