import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createAssetId,
  createStore,
  Editor,
  loadEngineSync,
  PATH_OP,
  StateNode,
  type ImageAsset,
  type ShapeId,
} from "@mocanvas/editor"
import { defaultShapeUtils, getImageCropStyle, getImageTextureSource, ImageShapeUtil, type ImageShape, type TextShape } from "../shapes"
import { defaultBindingUtils } from "../bindings"
import {
  classifyExternalText,
  createImageAssetFromSvgText,
  fitImageSize,
  getSvgTextSize,
  readFileAsDataUrl,
  registerDefaultExternalContentHandlers,
  type ImageSizeLoader,
} from "./index"

const wasmPath = fileURLToPath(new URL("../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor(): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  const editor = new Editor({
    store: createStore(),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [TestTool],
    engine,
    getContainer: () => ({}) as HTMLElement,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

function imageAsset(over: Partial<ImageAsset["props"]> = {}) {
  return {
    type: "image" as const,
    props: { w: 400, h: 300, name: "a.png", isAnimated: false, mimeType: "image/png", src: "data:image/png;base64,AAAA", ...over },
  }
}

function shapesOfType<T extends ImageShape | TextShape>(editor: Editor, type: T["type"]): T[] {
  return editor.getCurrentPageShapes().filter((s): s is T => s.type === type)
}

describe("asset records", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("creates, reads, updates and deletes assets through the editor", () => {
    expect(editor.getAssets()).toEqual([])
    const id = createAssetId("one")
    editor.createAssets([{ id, ...imageAsset() }, imageAsset({ name: "b.png" })])

    const assets = editor.getAssets()
    expect(assets).toHaveLength(2)
    expect(assets.every((a) => a.typeName === "asset" && a.id.startsWith("asset:"))).toBe(true)
    const one = editor.getAsset<ImageAsset>(id)!
    expect(one.id).toBe(id)
    expect(one.props.name).toBe("a.png")
    expect(one.meta).toEqual({})
    expect(editor.getAsset(one)).toBe(one)

    editor.updateAssets([{ id, type: "image", props: { src: null, name: "renamed.png" }, meta: { origin: "test" } }])
    const updated = editor.getAsset<ImageAsset>(id)!
    expect(updated.props).toEqual({ ...one.props, src: null, name: "renamed.png" })
    expect(updated.meta).toEqual({ origin: "test" })

    editor.deleteAssets([id])
    expect(editor.getAsset(id)).toBeUndefined()
    expect(editor.getAssets()).toHaveLength(1)
    // deleting an unknown id is a no-op
    editor.deleteAsset(createAssetId("nope"))
    expect(editor.getAssets()).toHaveLength(1)
  })

  it("asset creation is undoable and assets are document-scoped", () => {
    editor.markHistoryStoppingPoint("before")
    editor.createAsset(imageAsset())
    expect(editor.getAssets()).toHaveLength(1)
    editor.undo()
    expect(editor.getAssets()).toHaveLength(0)
    editor.redo()
    expect(editor.getAssets()).toHaveLength(1)
    const snapshot = editor.store.getStoreSnapshot("document")
    expect(Object.values(snapshot.store).some((r) => (r as { typeName: string }).typeName === "asset")).toBe(true)
  })
})

describe("ImageShapeUtil", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("is a filled rectangle drawn by the overlay with a locked aspect ratio", () => {
    const util = editor.getShapeUtil<ImageShape>("image")
    expect(util).toBeInstanceOf(ImageShapeUtil)
    editor.createShape<ImageShape>({ type: "image", x: 10, y: 20, props: { w: 300, h: 150 } })
    const shape = shapesOfType<ImageShape>(editor, "image")[0]!
    expect(shape.props).toEqual({ w: 300, h: 150, assetId: null, playing: true, url: "", crop: null, flipX: false, flipY: false, altText: "" })

    // MOVE + LINE* + CLOSE over exactly the four corners
    const words = editor.getShapeGeometry(shape).toPathWords()
    const ops: number[] = []
    const points: string[] = []
    for (let i = 0; i < words.length; ) {
      const op = words[i]!
      ops.push(op)
      if (op === PATH_OP.CLOSE) {
        i += 1
        continue
      }
      expect([PATH_OP.MOVE, PATH_OP.LINE]).toContain(op)
      points.push(`${words[i + 1]},${words[i + 2]}`)
      i += 3
    }
    expect(ops[0]).toBe(PATH_OP.MOVE)
    expect(ops.at(-1)).toBe(PATH_OP.CLOSE)
    expect(ops.slice(1, -1).every((op) => op === PATH_OP.LINE)).toBe(true)
    expect(new Set(points)).toEqual(new Set(["0,0", "300,0", "300,150", "0,150"]))
    expect(editor.getShapeGeometry(shape).bounds).toMatchObject({ x: 0, y: 0, w: 300, h: 150 })
    expect(editor.getShapePageBounds(shape)).toMatchObject({ x: 10, y: 20, w: 300, h: 150 })

    expect(util.getRenderStyle(shape)).toBeNull()
    expect(util.isAspectRatioLocked(shape)).toBe(true)
    expect(util.canEdit(shape)).toBe(false)
    expect(typeof util.getIndicatorPath).toBe("function")
    expect(util.component(shape)).not.toBeNull()
  })

  it("resolves the texture source from the asset", () => {
    const assetId = createAssetId("img")
    editor.createAssets([{ id: assetId, ...imageAsset({ src: "data:image/png;base64,QUJD" }) }])
    editor.createShape<ImageShape>({ type: "image", props: { w: 40, h: 30, assetId } })
    const shape = shapesOfType<ImageShape>(editor, "image")[0]!
    expect(getImageTextureSource(editor, shape)).toBe("data:image/png;base64,QUJD")

    editor.updateAsset({ id: assetId, type: "image", props: { src: null } })
    expect(getImageTextureSource(editor, editor.getShape<ImageShape>(shape.id)!)).toBeNull()

    editor.updateShape<ImageShape>({ id: shape.id, type: "image", props: { assetId: null } })
    expect(getImageTextureSource(editor, editor.getShape<ImageShape>(shape.id)!)).toBeNull()
    expect(getImageTextureSource(editor, { ...shape, props: { ...shape.props, assetId: createAssetId("missing") } })).toBeNull()
  })

  it("maps crop and flips onto the img box", () => {
    editor.createShape<ImageShape>({ type: "image", props: { w: 200, h: 100 } })
    const shape = shapesOfType<ImageShape>(editor, "image")[0]!
    expect(getImageCropStyle(shape)).toEqual({ position: "absolute", left: 0, top: 0, width: 200, height: 100 })
    const cropped: ImageShape = {
      ...shape,
      props: { ...shape.props, flipX: true, crop: { topLeft: { x: 0.25, y: 0 }, bottomRight: { x: 0.75, y: 0.5 } } },
    }
    expect(getImageCropStyle(cropped)).toEqual({ position: "absolute", left: -100, top: -0, width: 400, height: 200, transform: "scale(-1, 1)" })
  })
})

describe("fitImageSize", () => {
  it("scales down to fit the longest side and never scales up", () => {
    expect(fitImageSize({ w: 2000, h: 1000 })).toEqual({ w: 1000, h: 500 })
    expect(fitImageSize({ w: 500, h: 4000 })).toEqual({ w: 125, h: 1000 })
    expect(fitImageSize({ w: 300, h: 200 })).toEqual({ w: 300, h: 200 })
    expect(fitImageSize({ w: 3000, h: 3000 }, 600)).toEqual({ w: 600, h: 600 })
    expect(fitImageSize({ w: 0, h: 0 })).toEqual({ w: 1, h: 1 })
  })
})

describe("classifyExternalText", () => {
  it("ignores our own clipboard JSON and empty text, detects urls and svg", () => {
    expect(classifyExternalText(JSON.stringify({ type: "application/mocanvas", shapes: [] }))).toBeNull()
    expect(classifyExternalText("   ")).toBeNull()
    expect(classifyExternalText("{not json")).toEqual({ type: "text", text: "{not json" })
    expect(classifyExternalText("https://example.com/a?b=1", { x: 1, y: 2 })).toEqual({ type: "url", url: "https://example.com/a?b=1", point: { x: 1, y: 2 } })
    expect(classifyExternalText("hello world")).toEqual({ type: "text", text: "hello world" })
    expect(classifyExternalText('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>')?.type).toBe("svg-text")
  })

  it("reads an svg's declared size", () => {
    expect(getSvgTextSize('<svg width="120" height="80"></svg>')).toEqual({ w: 120, h: 80 })
    expect(getSvgTextSize('<svg width="100%" viewBox="0 0 30 20"></svg>')).toEqual({ w: 30, h: 20 })
    expect(getSvgTextSize("<svg></svg>")).toBeNull()
    expect(getSvgTextSize("<div/>")).toBeNull()
  })
})

describe("putExternalContent", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("resolves without effect when no handler is registered", async () => {
    await editor.putExternalContent({ type: "text", text: "hi" })
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
    expect(editor.hasExternalContentHandler("text")).toBe(false)
  })

  it("text becomes a text shape centered on the point and selected", async () => {
    registerDefaultExternalContentHandlers(editor)
    await editor.putExternalContent({ type: "text", text: "  hello  ", point: { x: 300, y: 200 } })
    const [shape] = shapesOfType<TextShape>(editor, "text")
    expect(shape).toBeDefined()
    expect(shape!.props.text).toBe("hello")
    const b = editor.getShapePageBounds(shape!)!
    expect(b.center.x).toBeCloseTo(300, 6)
    expect(b.center.y).toBeCloseTo(200, 6)
    expect(editor.getSelectedShapeIds()).toEqual([shape!.id])

    // whitespace-only text is dropped; urls become text too
    await editor.putExternalContent({ type: "text", text: "  " })
    await editor.putExternalContent({ type: "url", url: "https://example.com" })
    const texts = shapesOfType<TextShape>(editor, "text")
    expect(texts).toHaveLength(2)
    expect(texts[1]!.props.text).toBe("https://example.com")
    // defaults to the viewport center when no point is given
    expect(editor.getShapePageBounds(texts[1]!)!.center.x).toBeCloseTo(editor.getViewportPageCenter().x, 6)
  })

  it("registered handlers are replaceable, removable, and defaults do not override them", async () => {
    const custom = vi.fn()
    const remove = editor.registerExternalContentHandler("text", custom)
    registerDefaultExternalContentHandlers(editor)
    await editor.putExternalContent({ type: "text", text: "x" })
    expect(custom).toHaveBeenCalledWith({ type: "text", text: "x" })
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
    remove()
    expect(editor.hasExternalContentHandler("text")).toBe(false)
  })

  it("image files become data-url assets and image shapes, sized with the stubbed loader", async () => {
    const loadImageSize = vi.fn<ImageSizeLoader>(async () => ({ w: 2000, h: 1000 }))
    registerDefaultExternalContentHandlers(editor, { loadImageSize })
    const file = new File([PNG_BYTES], "photo.png", { type: "image/png" })
    const notes = new File(["hello"], "notes.txt", { type: "text/plain" })

    await editor.putExternalContent({ type: "files", files: [file, notes], point: { x: 500, y: 400 } })

    expect(loadImageSize).toHaveBeenCalledTimes(1)
    expect(loadImageSize.mock.calls[0]![0]).toMatch(/^data:image\/png;base64,/)
    expect(loadImageSize.mock.calls[0]![1]).toBe(file)

    const assets = editor.getAssets() as ImageAsset[]
    expect(assets).toHaveLength(1)
    const asset = assets[0]!
    expect(asset.type).toBe("image")
    expect(asset.props).toMatchObject({ w: 1000, h: 500, name: "photo.png", mimeType: "image/png", isAnimated: false, fileSize: PNG_BYTES.length })
    expect(asset.props.src).toBe(await readFileAsDataUrl(file))
    expect(asset.props.src!.startsWith("data:image/png;base64,iVBORw0KGgo")).toBe(true)

    const images = shapesOfType<ImageShape>(editor, "image")
    expect(images).toHaveLength(1)
    expect(images[0]!.props).toMatchObject({ w: 1000, h: 500, assetId: asset.id })
    expect(images[0]!.x).toBe(0)
    expect(images[0]!.y).toBe(150)
    expect(editor.getSelectedShapeIds()).toEqual([images[0]!.id] as ShapeId[])
    expect(getImageTextureSource(editor, images[0]!)).toBe(asset.props.src)

    // the whole insert is one undo step
    editor.undo()
    expect(editor.getAssets()).toHaveLength(0)
    expect(shapesOfType<ImageShape>(editor, "image")).toHaveLength(0)
  })

  it("falls back to the fallback size when the loader fails and stacks several images", async () => {
    registerDefaultExternalContentHandlers(editor, {
      loadImageSize: async () => {
        throw new Error("no decoder")
      },
      fallbackImageSize: { w: 50, h: 40 },
    })
    const a = new File([PNG_BYTES], "a.png", { type: "image/png" })
    const b = new File([PNG_BYTES], "b.gif", { type: "image/gif" })
    await editor.putExternalContent({ type: "files", files: [a, b], point: { x: 100, y: 100 } })
    const images = shapesOfType<ImageShape>(editor, "image")
    expect(images).toHaveLength(2)
    expect(images.map((s) => [s.x, s.y])).toEqual([
      [75, 80],
      [95, 100],
    ])
    const assets = editor.getAssets() as ImageAsset[]
    expect(assets.map((x) => x.props.isAnimated)).toEqual([false, true])
    expect(editor.getSelectedShapeIds()).toHaveLength(2)
  })

  it("svg markup becomes an svg data-url image asset sized from its viewBox", async () => {
    registerDefaultExternalContentHandlers(editor)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4000 2000"><rect width="4000" height="2000"/></svg>'
    await editor.putExternalContent({ type: "svg-text", text: svg, point: { x: 0, y: 0 } })
    const asset = editor.getAssets()[0] as ImageAsset
    expect(asset.props).toMatchObject({ w: 1000, h: 500, mimeType: "image/svg+xml", name: "image.svg" })
    expect(asset.props.src).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    expect(decodeURIComponent(asset.props.src!.split(",")[1]!)).toBe(svg)
    const image = shapesOfType<ImageShape>(editor, "image")[0]!
    expect(image.props.assetId).toBe(asset.id)
    expect([image.x, image.y]).toEqual([-500, -250])

    const direct = createImageAssetFromSvgText("<svg/>", { fallbackImageSize: { w: 7, h: 9 } })
    expect(direct.props).toMatchObject({ w: 7, h: 9 })
  })

  it("the asset handler can be replaced to decide what an image becomes", async () => {
    editor.registerExternalAssetHandler("file", () => undefined)
    registerDefaultExternalContentHandlers(editor)
    expect(editor.hasExternalAssetHandler("file")).toBe(true)
    await editor.putExternalContent({ type: "files", files: [new File([PNG_BYTES], "a.png", { type: "image/png" })] })
    expect(editor.getAssets()).toHaveLength(0)
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
    expect(await editor.getAssetForExternalContent({ type: "url", url: "https://x" })).toBeUndefined()
  })
})
