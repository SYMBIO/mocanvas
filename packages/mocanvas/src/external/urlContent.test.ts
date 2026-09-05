import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AssetRecordType, createStore, Editor, loadEngineSync, StateNode, type BookmarkAsset } from "@mocanvas/editor"
import { defaultShapeUtils } from "../shapes"
import { defaultBindingUtils } from "../bindings"
import { BOOKMARK_UNFURL_FAILED, defaultHandleExternalUrlContent } from "./urlContent"
import { registerDefaultExternalContentHandlers } from "./defaultExternalContentHandlers"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

class TestTool extends StateNode {
  static override id = "test"
}

const FIGMA_URL = "https://www.figma.com/file/AbCdEfGhIjKlMnOpQrStUv/Molekula"
const PLAIN_URL = "https://example.com/page"

function makeEditor(shapeUtils: typeof defaultShapeUtils = defaultShapeUtils): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [TestTool],
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

const typesOnPage = (editor: Editor): string[] => editor.getCurrentPageShapes().map((s) => s.type)

describe("defaultHandleExternalUrlContent", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("a url on the embed permit list becomes an embed carrying that url", async () => {
    await defaultHandleExternalUrlContent(editor, { url: FIGMA_URL, point: { x: 0, y: 0 } })
    const shapes = editor.getCurrentPageShapes()
    expect(shapes.map((s) => s.type)).toEqual(["embed"])
    expect((shapes[0]!.props as { url: string }).url).toBe(FIGMA_URL)
    expect(editor.getSelectedShapeIds()).toEqual([shapes[0]!.id])
  })

  it("a url off the permit list never embeds — it takes the bookmark path", async () => {
    await defaultHandleExternalUrlContent(editor, { url: PLAIN_URL, point: { x: 0, y: 0 } })
    expect(typesOnPage(editor)).toEqual(["bookmark"])
    expect(typesOnPage(editor)).not.toContain("embed")
  })

  it("stores the unfurled asset on the card when a url asset handler produced one", async () => {
    const asset: BookmarkAsset = {
      id: AssetRecordType.createId(),
      typeName: "asset",
      type: "bookmark",
      props: { src: PLAIN_URL, title: "A page", description: "", image: "", favicon: "" },
      meta: {},
    }
    editor.registerExternalAssetHandler("url", () => asset)
    await defaultHandleExternalUrlContent(editor, { url: PLAIN_URL })
    const [shape] = editor.getCurrentPageShapes()
    expect((shape!.props as { assetId: string | null }).assetId).toBe(asset.id)
    expect(editor.getAsset(asset.id)?.type).toBe("bookmark")
  })

  it("still creates the card when the unfurl throws, and reports it once", async () => {
    const addToast = vi.fn()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    editor.registerExternalAssetHandler("url", () => {
      throw new Error("offline")
    })
    await expect(
      defaultHandleExternalUrlContent(editor, { url: PLAIN_URL }, { toasts: { addToast }, msg: (id) => `t:${id}` }),
    ).resolves.toBeUndefined()
    const [shape] = editor.getCurrentPageShapes()
    expect(shape!.type).toBe("bookmark")
    expect((shape!.props as { assetId: string | null }).assetId).toBeNull()
    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast.mock.calls[0]![0]).toMatchObject({ id: BOOKMARK_UNFURL_FAILED, title: `t:${BOOKMARK_UNFURL_FAILED}` })
    vi.restoreAllMocks()
  })

  it("an empty or whitespace url creates nothing", async () => {
    await defaultHandleExternalUrlContent(editor, { url: "   " })
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
  })

  it("falls back to a text shape on an editor with no bookmark util", async () => {
    const trimmed = makeEditor(defaultShapeUtils.filter((U) => U.type !== "bookmark" && U.type !== "embed"))
    await defaultHandleExternalUrlContent(trimmed, { url: PLAIN_URL })
    const [shape] = trimmed.getCurrentPageShapes()
    expect(shape!.type).toBe("text")
    expect((shape!.props as { text: string }).text).toBe(PLAIN_URL)
    trimmed.dispose()
  })

  it("is what the default `url` content handler does", async () => {
    registerDefaultExternalContentHandlers(editor)
    await editor.putExternalContent({ type: "url", url: FIGMA_URL })
    expect(typesOnPage(editor)).toEqual(["embed"])
  })
})
