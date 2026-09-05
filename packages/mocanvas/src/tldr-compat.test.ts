/**
 * Loading a `.tldr` written by the reference implementation.
 *
 * The file records the version of every migration sequence it was saved under.
 * A sequence this schema does not know is ignored with a warning and the props
 * load as written — but a sequence it *claims to know* at a lower version is a
 * hard failure, because the file is then genuinely from a future the schema
 * cannot reason about.
 *
 * That distinction is why this library's own built-in migrations live under
 * `com.mocanvas.shape.*`. Registering one under `com.tldraw.shape.geo` at
 * version 1 made every real file fail to load with "data comes from a newer
 * version" — the reference implementation's geo sequence was at 12.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { Editor, createStore, loadEngineSync } from "@mocanvas/editor"
import { defaultBindingUtils, defaultShapeUtils, defaultTools } from "./index"
import { loadMocanvasFile } from "./file"

const wasmPath = fileURLToPath(new URL("../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))
const engine = loadEngineSync(readFileSync(wasmPath))
const fixturePath = fileURLToPath(new URL("../../../apps/bench/public/compare.tldr", import.meta.url))

function makeEditor(): Editor {
  const editor = new Editor({
    store: createStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils }),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: defaultTools,
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1200, h: 800 })
  return editor
}

describe("loading a .tldr from the reference implementation", () => {
  const file = JSON.parse(readFileSync(fixturePath, "utf8")) as { schema?: { sequences?: Record<string, number> } }

  it("the fixture really is from a newer schema — otherwise this test proves nothing", () => {
    expect(file.schema?.sequences?.["com.tldraw.shape.geo"]).toBeGreaterThan(1)
  })

  it("loads it, with every shape on the page", () => {
    const editor = makeEditor()
    const result = loadMocanvasFile(editor, file)
    expect(result.ok).toBe(true)
    expect(editor.getCurrentPageShapes().length).toBeGreaterThan(0)
  })

  it("does not claim any of the reference implementation's sequence ids", () => {
    // Every built-in migration this library registers must sit under its own
    // prefix. Claiming `com.tldraw.*` is what broke loading.
    for (const util of defaultShapeUtils) {
      const migrations = (util as { migrations?: { sequenceId?: string } }).migrations
      const id = migrations?.sequenceId
      if (id) expect(id.startsWith("com.tldraw.")).toBe(false)
    }
  })
})
