import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAssetId, createShapeId, type Editor, type ImageAsset, type PageId, type UnknownShape } from "@mocanvas/editor"
import type { IndexKey } from "@mocanvas/store"
import { FrameShapeUtil, type FrameShape } from "./FrameShapeUtil"
import { getImageTextureKey, ImageShapeUtil, type ImageShape } from "./ImageShapeUtil"
import { getTextShapeBox, getTextShapeTextureSpec, TextShapeUtil, type TextShape } from "./TextShapeUtil"

/** Node has no image decoder; the GPU path checks for one, so stand one in. */
const hadImage = "Image" in globalThis
beforeAll(() => {
  if (!hadImage) (globalThis as { Image?: unknown }).Image = class {}
})
afterAll(() => {
  if (!hadImage) delete (globalThis as { Image?: unknown }).Image
})

function stubEditor(opts: { assets?: Record<string, ImageAsset>; ready?: Set<string>; editingId?: string | null } = {}) {
  const acquired: string[] = []
  const ready = opts.ready ?? new Set<string>()
  const editor = {
    getEditingShapeId: () => opts.editingId ?? null,
    getAsset: (id: string) => opts.assets?.[id],
    getTextureResolution: () => 2,
    textures: {
      acquire: (key: string) => {
        acquired.push(key)
        return key.startsWith("bad:") ? 0 : 42
      },
      isReady: (key: string) => ready.has(key),
    },
  } as unknown as Editor
  return { editor, acquired, ready }
}

function makeShape<T extends UnknownShape>(type: T["type"], props: T["props"]): T {
  return {
    id: createShapeId("test"),
    typeName: "shape",
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1" as IndexKey,
    parentId: "page:page" as PageId,
    isLocked: false,
    opacity: 1,
    props,
    meta: {},
  } as T
}

const ASSET_ID = createAssetId("img")
const imageAsset = (src: string | null): ImageAsset => ({
  id: ASSET_ID,
  typeName: "asset",
  type: "image",
  props: { w: 10, h: 10, name: "a.png", isAnimated: false, mimeType: "image/png", src },
  meta: {},
})

function imageShape(props: Partial<ImageShape["props"]> = {}): ImageShape {
  const util = new ImageShapeUtil(stubEditor().editor)
  return makeShape<ImageShape>("image", { ...util.getDefaultProps(), ...props })
}

describe("ImageShapeUtil textures", () => {
  it("has no texture without an asset source", () => {
    const { editor } = stubEditor({ assets: { [ASSET_ID]: imageAsset(null) } })
    const util = new ImageShapeUtil(editor)
    expect(getImageTextureKey(editor, imageShape())).toBeNull()
    expect(getImageTextureKey(editor, imageShape({ assetId: ASSET_ID }))).toBeNull()
    expect(util.getRenderStyle(imageShape({ assetId: ASSET_ID }))).toBeNull()
    expect(util.needsOverlay(imageShape({ assetId: ASSET_ID }))).toBe(true)
  })

  it("renders a white textured quad once the asset resolves", () => {
    const key = `asset:${ASSET_ID}`
    const { editor, acquired } = stubEditor({ assets: { [ASSET_ID]: imageAsset("data:image/png;base64,QUJD") }, ready: new Set([key]) })
    const util = new ImageShapeUtil(editor)
    const shape = imageShape({ assetId: ASSET_ID })

    expect(getImageTextureKey(editor, shape)).toBe(key)
    expect(util.getRenderStyle(shape)).toEqual({ fill: 0xffffffff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1, texture: 42 })
    expect(acquired).toEqual([key])
    expect(util.needsOverlay(shape)).toBe(false)
  })

  it("keeps the DOM overlay while the texture is still pending", () => {
    const { editor } = stubEditor({ assets: { [ASSET_ID]: imageAsset("https://example.com/a.png") } })
    const util = new ImageShapeUtil(editor)
    const shape = imageShape({ assetId: ASSET_ID })
    // The id is handed out immediately, but the overlay draws until it is ready.
    expect(util.getRenderStyle(shape)?.texture).toBe(42)
    expect(util.needsOverlay(shape)).toBe(true)
  })

  it("crops and flips stay on the DOM overlay", () => {
    const key = `asset:${ASSET_ID}`
    const { editor } = stubEditor({ assets: { [ASSET_ID]: imageAsset("data:image/png;base64,QUJD") }, ready: new Set([key]) })
    const util = new ImageShapeUtil(editor)
    for (const props of [
      { flipX: true },
      { flipY: true },
      { crop: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 0.5, y: 0.5 } } },
    ] as Partial<ImageShape["props"]>[]) {
      const shape = imageShape({ assetId: ASSET_ID, ...props })
      expect(getImageTextureKey(editor, shape)).toBeNull()
      expect(util.getRenderStyle(shape)).toBeNull()
      expect(util.needsOverlay(shape)).toBe(true)
    }
  })

  it("the shape being edited stays in the overlay", () => {
    const key = `asset:${ASSET_ID}`
    const { editor } = stubEditor({ assets: { [ASSET_ID]: imageAsset("data:image/png;base64,QUJD") }, ready: new Set([key]) })
    const util = new ImageShapeUtil(editor)
    const shape = imageShape({ assetId: ASSET_ID })
    const editing = stubEditor({
      assets: { [ASSET_ID]: imageAsset("data:image/png;base64,QUJD") },
      ready: new Set([key]),
      editingId: shape.id,
    })
    expect(util.needsOverlay(shape)).toBe(false)
    expect(new ImageShapeUtil(editing.editor).needsOverlay(shape)).toBe(true)
  })
})

describe("FrameShapeUtil", () => {
  it("clips its descendants", () => {
    const util = new FrameShapeUtil(stubEditor().editor)
    const shape = makeShape<FrameShape>("frame", util.getDefaultProps())
    expect(util.isClipShape(shape)).toBe(true)
    // The frame body itself is still drawn on the GPU with a DOM name label.
    expect(util.getRenderStyle(shape)).not.toBeNull()
    expect(util.needsOverlay(shape)).toBe(false)
    expect(util.hasOverlayLabel(shape)).toBe(true)
  })
})

describe("text shape texture specs", () => {
  const { editor } = stubEditor()
  const util = new TextShapeUtil(editor)
  const textShape = (props: Partial<TextShape["props"]> = {}) =>
    makeShape<TextShape>("text", { ...util.getDefaultProps(), text: "hello", ...props })

  it("covers exactly the shape's geometry box", () => {
    const shape = textShape({ w: 120, autoSize: false })
    const spec = getTextShapeTextureSpec(editor, shape)
    const box = getTextShapeBox(shape)
    expect({ w: spec.width, h: spec.height }).toEqual(box)
    expect(util.getGeometry(shape).bounds).toMatchObject({ w: box.w, h: box.h })
    // Wrapped text carries the wrap width; auto-sized text does not wrap.
    expect(spec.maxWidth).toBe(box.w)
    expect(getTextShapeTextureSpec(editor, textShape({ autoSize: true })).maxWidth).toBeUndefined()
  })

  it("takes the resolution from the editor's bucket", () => {
    expect(getTextShapeTextureSpec(editor, textShape()).resolution).toBe(2)
  })

  it("falls back to the DOM overlay where there is no canvas (Node/SSR)", () => {
    expect(typeof document).toBe("undefined")
    expect(util.getRenderStyle(textShape())).toBeNull()
    expect(util.needsOverlay(textShape())).toBe(true)
  })
})
