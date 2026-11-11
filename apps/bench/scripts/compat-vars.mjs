/**
 * Does `@mocanvas/compat` still hand a shape the live camera, as CSS sees it?
 *
 * `var()` is substituted where the declaration sits, and descendants inherit the
 * computed value rather than the expression. So a `--tl-scale: var(--mocanvas-scale)`
 * written only on the overlay layer resolves there — to the constant the layer
 * declares — and every shape below inherits that answer, however live its own
 * `--mocanvas-scale` is. 4.15.0 shipped exactly that bug, and no test in the
 * repo could see it: jsdom does not resolve `var()` at all, so a unit test
 * reading `--tl-scale` passes against both the broken and the fixed stylesheet.
 *
 * This runs the real stylesheet in a real engine against the DOM the canvas
 * builds, and asserts the three cases that matter.
 *
 *   node scripts/compat-vars.mjs
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const CSS = readFileSync(resolve(HERE, "../../../packages/compat/compat.css"), "utf8")

const ZOOM = 4
const SCALE = 1 / ZOOM

/** The structure `Canvas.tsx` renders: live container, cut layer, one shape that asked and one that did not. */
const PAGE = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<div class="mocanvas" style="--mocanvas-zoom: ${ZOOM}; --mocanvas-scale: ${SCALE}">
  <div class="mocanvas-overlay" style="--mocanvas-zoom: 1; --mocanvas-scale: 1">
    <div class="mocanvas-shape" id="asked" style="--mocanvas-zoom: ${ZOOM}; --mocanvas-scale: ${SCALE}"><div id="asked-content"></div></div>
    <div class="mocanvas-shape" id="plain"><div id="plain-content"></div></div>
  </div>
  <div id="chrome"></div>
</div>`

const EXPECTED = [
  // A shape whose util returns true from `usesCameraCssVars`: the real camera,
  // through the tldraw alias a migrated stylesheet reads.
  { id: "asked-content", prop: "--tl-scale", value: String(SCALE) },
  { id: "asked-content", prop: "--tl-zoom", value: String(ZOOM) },
  // A shape that did not ask: the constant, so a zoom restyles nothing here.
  { id: "plain-content", prop: "--tl-scale", value: "1" },
  // Anything outside the overlay — the app's own chrome — is unaffected.
  { id: "chrome", prop: "--tl-scale", value: String(SCALE) },
  { id: "chrome", prop: "--tl-zoom", value: String(ZOOM) },
]

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.setContent(PAGE)
  const failures = []
  for (const { id, prop, value } of EXPECTED) {
    const actual = await page.evaluate(
      ([id, prop]) => getComputedStyle(document.getElementById(id)).getPropertyValue(prop).trim(),
      [id, prop],
    )
    const ok = actual === value
    console.log(`${ok ? "ok  " : "FAIL"}  #${id} ${prop} = ${actual || "(empty)"}${ok ? "" : `, expected ${value}`}`)
    if (!ok) failures.push(`#${id} ${prop}`)
  }
  if (failures.length) {
    console.error(`\n${failures.length} of ${EXPECTED.length} wrong: ${failures.join(", ")}`)
    process.exitCode = 1
  } else {
    console.log(`\nall ${EXPECTED.length} as expected`)
  }
} finally {
  await browser.close()
}
