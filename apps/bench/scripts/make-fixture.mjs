/**
 * Build the rendering-comparison fixture.
 *
 * Drives the tldraw bench page through tldraw's public API (`createShapes`,
 * `createBindings`, `getSnapshot`) to author a document with one of each
 * built-in shape family, then writes it as `public/compare.tldr` in the
 * documented `.tldr` envelope: `{ tldrawFileFormatVersion, schema, records }`.
 *
 * Usage: `pnpm --filter bench fixture`
 */
import { chromium } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { ROOT, buildApp, launchBrowser, openBenchPage, startPreview, withTimeout } from "./lib.mjs"

const OUT = resolve(ROOT, "public/compare.tldr")

async function main() {
  console.log("building bench app…")
  await buildApp()
  const server = await startPreview()
  console.log(`preview at ${server.url}`)

  const launched = await launchBrowser({ chromium }, server.url)
  console.log(`chromium ${launched.version} (${launched.mode}) — ${launched.gpu.renderer}`)

  const { page } = await openBenchPage(launched.browser, server.url, "tldraw")
  const file = await withTimeout(page, 120_000, async () => {
    const doc = await window.bench.makeFixture()
    return doc
  })

  if (!file || !Array.isArray(file.records)) throw new Error("makeFixture did not return a .tldr document")

  const shapes = file.records.filter((r) => r.typeName === "shape")
  const bindings = file.records.filter((r) => r.typeName === "binding")
  const byType = {}
  for (const s of shapes) byType[s.type] = (byType[s.type] ?? 0) + 1

  await mkdir(resolve(ROOT, "public"), { recursive: true })
  await writeFile(OUT, `${JSON.stringify(file, null, 2)}\n`)

  console.log(`\nwrote ${OUT}`)
  console.log(`  format version : ${file.tldrawFileFormatVersion}`)
  console.log(`  schema version : ${file.schema?.schemaVersion}`)
  console.log(`  records        : ${file.records.length}`)
  console.log(`  shapes         : ${shapes.length} (${Object.entries(byType).map(([t, c]) => `${t}×${c}`).join(", ")})`)
  console.log(`  bindings       : ${bindings.length}`)

  await launched.browser.close()
  await server.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
