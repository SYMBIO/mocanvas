import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import { createShapeId, createStore, Editor, loadEngineSync, StateNode } from "@mocanvas/editor"
import { defaultShapeUtils } from "./shapes"
import { defaultBindingUtils } from "./bindings"
import { TLDRAW_FILE_EXTENSION, loadMocanvasFile, parseTldrawJsonFile, serializeTldrawJson, serializeTldrawJsonBlob } from "./file"
import { embedPermissionsToAllowAttribute, embedShapePermissionDefaults } from "./external/embeds"
import { defaultEditorAssetUrls, defaultGeoTypeDefinitions } from "./config"

const wasmPath = fileURLToPath(new URL("../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor(): Editor {
  const editor = new Editor({
    store: createStore(),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [TestTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

describe("the documented .tldr surface", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
    editor.createShape({ id: createShapeId(), type: "geo", x: 0, y: 0, props: { w: 10, h: 10 } } as never)
  })

  it("names the file extension", () => {
    expect(TLDRAW_FILE_EXTENSION).toBe(".tldr")
  })

  it("serializes to json text a parse can read back", async () => {
    const json = await serializeTldrawJson(editor)
    const parsed = parseTldrawJsonFile({ json })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.records.some((record) => record.typeName === "shape")).toBe(true)
  })

  it("serializes to a blob of the same text", async () => {
    const blob = await serializeTldrawJsonBlob(editor)
    expect(blob.type).toBe("application/json")
    expect(await blob.text()).toBe(await serializeTldrawJson(editor))
  })

  it("round-trips through load", async () => {
    const json = await serializeTldrawJson(editor)
    const other = makeEditor()
    const result = loadMocanvasFile(other, json)
    expect(result.ok).toBe(true)
    expect(other.getCurrentPageShapes()).toHaveLength(1)
  })

  it("reports unparseable text as notATldrawFile", () => {
    const parsed = parseTldrawJsonFile({ json: "{{{" })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.type).toBe("notATldrawFile")
  })

  it("reports a document that is not a tldraw file", () => {
    const parsed = parseTldrawJsonFile({ json: JSON.stringify({ hello: "world" }) })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.type).toBe("notATldrawFile")
  })

  it("recognises a v1 file", () => {
    const parsed = parseTldrawJsonFile({ json: JSON.stringify({ document: { pages: {} } }) })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.type).toBe("v1File")
  })

  it("reports a file from a newer build by version", () => {
    const parsed = parseTldrawJsonFile({
      json: JSON.stringify({ tldrawFileFormatVersion: 99, schema: { schemaVersion: 2 }, records: [] }),
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.type).toBe("fileFormatVersionTooNew")
  })

  it("reports records it cannot read", () => {
    const parsed = parseTldrawJsonFile({
      json: JSON.stringify({ tldrawFileFormatVersion: 1, schema: { schemaVersion: 2 }, records: [{ nope: true }] }),
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.type).toBe("invalidRecords")
  })
})

describe("configuration seams", () => {
  it("ships no cdn urls", () => {
    expect(defaultEditorAssetUrls).toEqual({})
  })

  it("exposes the built-in geo forms", () => {
    expect(Object.keys(defaultGeoTypeDefinitions).length).toBeGreaterThan(0)
    expect(defaultGeoTypeDefinitions["rectangle"]).toBeDefined()
  })

  it("denies every capability that reaches hardware or identity", () => {
    for (const feature of ["camera", "microphone", "geolocation", "usb", "payment", "display-capture"] as const) {
      expect(embedShapePermissionDefaults[feature]).toBe(false)
    }
  })

  it("allows only what a media player needs", () => {
    expect(embedShapePermissionDefaults.fullscreen).toBe(true)
    expect(embedShapePermissionDefaults.autoplay).toBe(true)
    expect(embedShapePermissionDefaults["picture-in-picture"]).toBe(true)
  })

  it("writes only the allowed features into the iframe attribute", () => {
    const allow = embedPermissionsToAllowAttribute(embedShapePermissionDefaults)
    expect(allow).toContain("fullscreen")
    expect(allow).not.toContain("camera")
  })
})
