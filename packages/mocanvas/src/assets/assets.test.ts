import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AssetRecordType, createStore, Editor, loadEngineSync, StateNode, type Asset } from "@mocanvas/editor"
import { defaultShapeUtils } from "../shapes"
import { defaultBindingUtils } from "../bindings"
import { BookmarkAssetUtil, DEFAULT_MAX_ASSET_SIZE, ImageAssetUtil, VideoAssetUtil, defaultAssetUtils } from "./AssetUtils"
import { createShapesForAssets, downsizeDimensions, notifyIfFileNotAllowed } from "./media"
import type { TLDefaultExternalContentHandlerOpts } from "../external/handler-options"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

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
    assetUtils: defaultAssetUtils,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

function makeToastOpts(over: Partial<TLDefaultExternalContentHandlerOpts> = {}): TLDefaultExternalContentHandlerOpts {
  return {
    toasts: { addToast: vi.fn(() => "id"), removeToast: vi.fn(), clearToasts: vi.fn(), toasts: [] },
    msg: (id: string) => id,
    ...over,
  }
}

describe("downsizeDimensions", () => {
  it("scales the longest side down to the maximum", () => {
    expect(downsizeDimensions({ w: 2000, h: 1000 }, 1000)).toEqual({ w: 1000, h: 500 })
  })

  it("never scales up", () => {
    expect(downsizeDimensions({ w: 32, h: 32 }, 1000)).toEqual({ w: 32, h: 32 })
  })

  it("leaves things alone with no maximum", () => {
    expect(downsizeDimensions({ w: 5000, h: 100 })).toEqual({ w: 5000, h: 100 })
  })
})

describe("the built-in asset utils", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("registers all three under their types", () => {
    expect(editor.hasAssetUtil("image")).toBe(true)
    expect(editor.hasAssetUtil("video")).toBe(true)
    expect(editor.hasAssetUtil("bookmark")).toBe(true)
  })

  it("claims the mime types it says it does", () => {
    const image = new ImageAssetUtil(editor)
    expect(image.acceptsMimeType("image/png")).toBe(true)
    expect(image.acceptsMimeType("IMAGE/PNG")).toBe(true)
    expect(image.acceptsMimeType("video/mp4")).toBe(false)
  })

  it("routes a mime type to the util that claims it", () => {
    expect(editor.getAssetUtilForMimeType("image/png")?.type).toBe("image")
    expect(editor.getAssetUtilForMimeType("video/mp4")?.type).toBe("video")
    expect(editor.getAssetUtilForMimeType("application/pdf")).toBeUndefined()
  })

  it("narrows its mime types through configure, without touching the original", () => {
    const PngOnly = ImageAssetUtil.configure({ supportedMimeTypes: ["image/png"] })
    expect(new PngOnly(editor).acceptsMimeType("image/jpeg")).toBe(false)
    expect(new ImageAssetUtil(editor).acceptsMimeType("image/jpeg")).toBe(true)
  })

  it("keeps its type through configure", () => {
    expect(ImageAssetUtil.configure({ supportedMimeTypes: [] }).type).toBe("image")
  })

  it("names the shape type each asset becomes", () => {
    expect(new ImageAssetUtil(editor).getShapeType()).toBe("image")
    expect(new VideoAssetUtil(editor).getShapeType()).toBe("video")
    expect(new BookmarkAssetUtil(editor).getShapeType()).toBe("bookmark")
  })

  it("gives a bookmark no mime types, because it comes from a url", () => {
    expect(new BookmarkAssetUtil(editor).getSupportedMimeTypes()).toEqual([])
    expect(new BookmarkAssetUtil(editor).acceptsMimeType("text/uri-list")).toBe(false)
  })

  it("resolves an asset to its src", () => {
    const util = new ImageAssetUtil(editor)
    expect(util.resolve({ props: { src: "data:image/png;base64,AA" } } as unknown as Asset)).toBe("data:image/png;base64,AA")
    expect(util.resolve({ props: {} } as unknown as Asset)).toBeNull()
  })
})

describe("notifyIfFileNotAllowed", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("allows a file whose type an asset util claims", () => {
    const opts = makeToastOpts()
    expect(notifyIfFileNotAllowed(editor, new File([""], "a.png", { type: "image/png" }), opts)).toBe(true)
    expect(opts.toasts.addToast).not.toHaveBeenCalled()
  })

  it("refuses a file nothing claims, with a toast", () => {
    const opts = makeToastOpts()
    expect(notifyIfFileNotAllowed(editor, new File([""], "a.pdf", { type: "application/pdf" }), opts)).toBe(false)
    expect(opts.toasts.addToast).toHaveBeenCalledWith(expect.objectContaining({ severity: "error" }))
  })

  it("refuses a file over the size limit, with a toast", () => {
    const opts = makeToastOpts({ maxAssetSize: 4 })
    const file = new File(["much too long"], "a.png", { type: "image/png" })
    expect(notifyIfFileNotAllowed(editor, file, opts)).toBe(false)
    expect(opts.toasts.addToast).toHaveBeenCalled()
  })

  it("honours an explicit accept list over the registered utils", () => {
    const opts = makeToastOpts({ acceptedImageMimeTypes: ["image/png"] })
    expect(notifyIfFileNotAllowed(editor, new File([""], "a.png", { type: "image/png" }), opts)).toBe(true)
    expect(notifyIfFileNotAllowed(editor, new File([""], "a.gif", { type: "image/gif" }), opts)).toBe(false)
  })

  it("defaults its size limit to the documented ceiling", () => {
    expect(DEFAULT_MAX_ASSET_SIZE).toBe(10 * 1024 * 1024)
    const opts = makeToastOpts()
    const file = new File([""], "a.png", { type: "image/png" })
    Object.defineProperty(file, "size", { value: DEFAULT_MAX_ASSET_SIZE + 1 })
    expect(notifyIfFileNotAllowed(editor, file, opts)).toBe(false)
  })
})

describe("createShapesForAssets", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  function imageAsset(w = 100, h = 80): Asset {
    return {
      id: AssetRecordType.createId(),
      typeName: "asset",
      type: "image",
      props: { w, h, name: "a.png", isAnimated: false, mimeType: "image/png", src: "data:image/png;base64,AA" },
      meta: {},
    }
  }

  it("stores the assets and creates a shape for each", async () => {
    const ids = await createShapesForAssets(editor, [imageAsset(), imageAsset()], { x: 0, y: 0 })
    expect(ids).toHaveLength(2)
    expect(editor.getAssets()).toHaveLength(2)
    expect(editor.getCurrentPageShapes().filter((s) => s.type === "image")).toHaveLength(2)
  })

  it("centres the first shape on the point", async () => {
    const [id] = await createShapesForAssets(editor, [imageAsset(100, 80)], { x: 500, y: 400 })
    const shape = editor.getShape(id!)!
    expect(shape.x).toBeCloseTo(450)
    expect(shape.y).toBeCloseTo(360)
  })

  it("stacks several so they do not land exactly on top of each other", async () => {
    const ids = await createShapesForAssets(editor, [imageAsset(), imageAsset()], { x: 0, y: 0 })
    expect(editor.getShape(ids[1]!)!.x).toBeGreaterThan(editor.getShape(ids[0]!)!.x)
  })

  it("selects what it created", async () => {
    const ids = await createShapesForAssets(editor, [imageAsset()], { x: 0, y: 0 })
    expect(editor.getSelectedShapeIds()).toEqual(ids)
  })

  it("does nothing for no assets", async () => {
    expect(await createShapesForAssets(editor, [], { x: 0, y: 0 })).toEqual([])
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
  })
})
