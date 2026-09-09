/**
 * Screenshot one shape, zoomed in, in both libraries.
 *
 * The pixel metrics in `bench.mjs` compare whole shapes at fit-zoom, where a
 * misshapen arrowhead is a handful of pixels and disappears into the stroke
 * band. This exists for the other kind of question — "does that join look
 * right?" — which only an eye can answer, so it puts the two renderings side by
 * side at a magnification where the answer is obvious.
 *
 *   pnpm --filter bench arrow-shot -- --shape=arrow-straight --zoom=6
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { ROOT, buildApp, launchBrowser, openBenchPage, startPreview, withTimeout } from "./lib.mjs"

const args = process.argv.slice(2)
const arg = (k, d) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const SHAPE = arg("shape", "arrow-straight")
const ZOOM = Number(arg("zoom", "6"))
const OUT = resolve(ROOT, "results")

/** Load the fixture, frame `part` of the named shape at `zoom`, and shoot. */
async function shoot(page, lib) {
  await withTimeout(page, 120_000, async ({ shape, zoom }) => {
    const doc = await (await fetch("/compare.tldr")).json()
    await window.bench.loadTldr(doc)
    const ed = window.editor
    const s = ed.getCurrentPageShapes().find((x) => String(x.id).includes(shape))
    if (!s) throw new Error(`no shape matching ${shape}`)
    const b = ed.getShapePageBounds(s)
    // The head end of the arrow: the last third of its bounds, squared up so
    // both libraries frame exactly the same page-space window.
    const side = Math.max(b.w, b.h) / 3
    const cx = b.maxX - side / 2
    const cy = b.center.y
    ed.setCamera({ x: -(cx - 600 / zoom), y: -(cy - 400 / zoom), z: zoom }, { animation: { duration: 0 }, force: true })
    await window.bench.screenshotReady()
  }, { shape: SHAPE, zoom: ZOOM })
  await page.screenshot({ path: resolve(OUT, `arrow-${lib}.png`) })
}

await buildApp()
const server = await startPreview()
try {
  const launched = await launchBrowser({ chromium }, server.url, { headed: true })
  try {
    for (const lib of ["mocanvas", "tldraw"]) {
      const { page } = await openBenchPage(launched.browser, server.url, lib)
      await shoot(page, lib)
      await page.close()
    }
  } finally {
    await launched.browser.close()
  }
  await mkdir(OUT, { recursive: true })
  await writeFile(resolve(OUT, "arrow-shot.json"), JSON.stringify({ shape: SHAPE, zoom: ZOOM, gpu: launched.gpu }, null, 2))
  console.log(`wrote results/arrow-{mocanvas,tldraw}.png  shape=${SHAPE} zoom=${ZOOM}`)
} finally {
  await server.close()
}
