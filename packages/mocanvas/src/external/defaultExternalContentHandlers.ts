import { AssetRecordType, createShapeId, type Editor, type ExternalContent, type ImageAsset, type ShapeId, type VecLike } from "@mocanvas/editor"
import type { ImageShape } from "../shapes/ImageShapeUtil"
import type { TextShape } from "../shapes/TextShapeUtil"

export interface ImageSize {
  w: number
  h: number
}

/** Resolves an image's pixel size from its source; injectable so tests can run without a DOM. */
export type ImageSizeLoader = (src: string, file?: File) => Promise<ImageSize>

export interface ExternalContentOptions {
  /** Longest side an inserted image may have, in page units. */
  maxImageDimension?: number
  /** Fallback size when an image's dimensions cannot be read. */
  fallbackImageSize?: ImageSize
  loadImageSize?: ImageSizeLoader
  readFileAsDataUrl?: (file: File) => Promise<string>
  /** Offset between shapes when several are inserted at the same point. */
  stackOffset?: number
}

export const DEFAULT_MAX_IMAGE_DIMENSION = 1000
const DEFAULT_FALLBACK_IMAGE_SIZE: ImageSize = { w: 100, h: 100 }
const DEFAULT_STACK_OFFSET = 20

/** Scale `size` down (never up) so both sides fit within `max`, keeping the aspect ratio. */
export function fitImageSize(size: ImageSize, max = DEFAULT_MAX_IMAGE_DIMENSION): ImageSize {
  const w = Math.max(1, size.w)
  const h = Math.max(1, size.h)
  const scale = Math.min(1, max / Math.max(w, h))
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/")
}

export function isSvgFile(file: File): boolean {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name)
}

export function isAnimatedImageType(mimeType: string): boolean {
  return mimeType === "image/gif" || mimeType === "image/apng" || mimeType === "image/webp"
}

const URL_RE = /^(https?:\/\/|mailto:)\S+$/i

export function looksLikeUrl(text: string): boolean {
  return URL_RE.test(text.trim())
}

export function looksLikeSvg(text: string): boolean {
  return /^\s*(<\?xml[^>]*>\s*)?(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)
}

/** Read a file into a `data:` URL, via `FileReader` where present and `arrayBuffer()` elsewhere. */
export async function readFileAsDataUrl(file: File): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error ?? new Error("Could not read file"))
      reader.readAsDataURL(file)
    })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`
}

/** A `data:` URL for an SVG document string. */
export function svgTextToDataUrl(text: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
}

/** Pixel size declared by an SVG's root `width`/`height` or `viewBox`, or `null` when neither is usable. */
export function getSvgTextSize(text: string): ImageSize | null {
  const root = /<svg\b[^>]*>/i.exec(text)?.[0]
  if (!root) return null
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1]
  const px = (v: string | undefined) => {
    if (!v || /%$/.test(v)) return undefined
    const n = parseFloat(v)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  const w = px(attr("width"))
  const h = px(attr("height"))
  if (w && h) return { w, h }
  const viewBox = attr("viewBox")
    ?.split(/[\s,]+/)
    .map(Number)
  if (viewBox && viewBox.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0) return { w: viewBox[2]!, h: viewBox[3]! }
  return null
}

/** Default size loader: `createImageBitmap` when available, else an `Image` element. */
export const loadImageSizeInBrowser: ImageSizeLoader = async (src, file) => {
  if (file && typeof createImageBitmap === "function" && !isSvgFile(file)) {
    try {
      const bitmap = await createImageBitmap(file)
      const size = { w: bitmap.width, h: bitmap.height }
      bitmap.close()
      return size
    } catch {
      // fall through to the Image element (e.g. unsupported type)
    }
  }
  if (typeof Image === "undefined") throw new Error("No image decoder available")
  return new Promise<ImageSize>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error("Could not decode image"))
    img.src = src
  })
}

type ResolvedOptions = Required<ExternalContentOptions>

function resolveOptions(opts: ExternalContentOptions): ResolvedOptions {
  return {
    maxImageDimension: opts.maxImageDimension ?? DEFAULT_MAX_IMAGE_DIMENSION,
    fallbackImageSize: opts.fallbackImageSize ?? DEFAULT_FALLBACK_IMAGE_SIZE,
    loadImageSize: opts.loadImageSize ?? loadImageSizeInBrowser,
    readFileAsDataUrl: opts.readFileAsDataUrl ?? readFileAsDataUrl,
    stackOffset: opts.stackOffset ?? DEFAULT_STACK_OFFSET,
  }
}

/** Build (without storing) an image asset for a file; `undefined` for non-image files. */
export async function createImageAssetFromFile(file: File, opts: ExternalContentOptions = {}): Promise<ImageAsset | undefined> {
  if (!isImageFile(file) && !isSvgFile(file)) return undefined
  const o = resolveOptions(opts)
  const src = await o.readFileAsDataUrl(file)
  let size: ImageSize
  try {
    size = await o.loadImageSize(src, file)
  } catch {
    size = o.fallbackImageSize
  }
  const mimeType = file.type || (isSvgFile(file) ? "image/svg+xml" : null)
  return {
    id: AssetRecordType.createId(),
    typeName: "asset",
    type: "image",
    props: {
      ...fitImageSize(size, o.maxImageDimension),
      name: file.name,
      isAnimated: mimeType ? isAnimatedImageType(mimeType) : false,
      mimeType,
      src,
      fileSize: file.size,
    },
    meta: {},
  }
}

/** Build (without storing) an image asset from SVG markup. */
export function createImageAssetFromSvgText(text: string, opts: ExternalContentOptions = {}): ImageAsset {
  const o = resolveOptions(opts)
  const size = getSvgTextSize(text) ?? o.fallbackImageSize
  return {
    id: AssetRecordType.createId(),
    typeName: "asset",
    type: "image",
    props: { ...fitImageSize(size, o.maxImageDimension), name: "image.svg", isAnimated: false, mimeType: "image/svg+xml", src: svgTextToDataUrl(text) },
    meta: {},
  }
}

function pointOrCenter(editor: Editor, point: VecLike | undefined): VecLike {
  return point ?? editor.getViewportPageCenter()
}

/** Store `assets` and create one image shape per asset, centered on `point` and stacked by `stackOffset`. */
export function createImageShapesForAssets(editor: Editor, assets: readonly ImageAsset[], point: VecLike | undefined, stackOffset = DEFAULT_STACK_OFFSET): ShapeId[] {
  if (assets.length === 0) return []
  const p = pointOrCenter(editor, point)
  const ids: ShapeId[] = []
  editor.run(() => {
    editor.createAssets(assets.map((a) => ({ id: a.id, type: a.type, props: a.props, meta: a.meta })))
    editor.createShapes<ImageShape>(
      assets.map((asset, i) => {
        const id = createShapeId()
        ids.push(id)
        const { w, h } = asset.props
        return {
          id,
          type: "image",
          x: p.x - w / 2 + i * stackOffset,
          y: p.y - h / 2 + i * stackOffset,
          props: { w, h, assetId: asset.id },
        }
      }),
    )
    editor.setSelectedShapes(ids)
  })
  return ids
}

/** Create a text shape whose bounds are centered on `point`. */
export function createTextShapeAt(editor: Editor, text: string, point: VecLike | undefined): ShapeId {
  const p = pointOrCenter(editor, point)
  const id = createShapeId()
  editor.run(() => {
    editor.createShape<TextShape>({ id, type: "text", x: p.x, y: p.y, props: { text } })
    const shape = editor.getShape<TextShape>(id)
    const bounds = shape ? editor.getShapeGeometry(shape).bounds : undefined
    if (bounds) editor.updateShape<TextShape>({ id, type: "text", x: p.x - bounds.w / 2, y: p.y - bounds.h / 2 })
    editor.setSelectedShapes([id])
  })
  return id
}

/**
 * Install the default drop/paste behaviour: image files become image assets +
 * image shapes, SVG markup becomes an image asset, text and urls become text
 * shapes. Types that already have a handler are left alone. Returns a function
 * that removes the handlers this call installed.
 */
export function registerDefaultExternalContentHandlers(editor: Editor, opts: ExternalContentOptions = {}): () => void {
  const o = resolveOptions(opts)
  const disposers: (() => void)[] = []

  if (!editor.hasExternalAssetHandler("file")) {
    disposers.push(editor.registerExternalAssetHandler("file", ({ file }) => createImageAssetFromFile(file, o)))
  }

  if (!editor.hasExternalContentHandler("files")) {
    disposers.push(
      editor.registerExternalContentHandler("files", async ({ files, point }) => {
        const assets: ImageAsset[] = []
        for (const file of files) {
          const asset = await editor.getAssetForExternalContent({ type: "file", file })
          if (asset?.type === "image") assets.push(asset)
        }
        if (assets.length === 0) return
        editor.markHistoryStoppingPoint("insert images")
        createImageShapesForAssets(editor, assets, point, o.stackOffset)
      }),
    )
  }

  if (!editor.hasExternalContentHandler("text")) {
    disposers.push(
      editor.registerExternalContentHandler("text", ({ text, point }) => {
        const trimmed = text.trim()
        if (!trimmed) return
        editor.markHistoryStoppingPoint("insert text")
        createTextShapeAt(editor, trimmed, point)
      }),
    )
  }

  if (!editor.hasExternalContentHandler("url")) {
    disposers.push(
      editor.registerExternalContentHandler("url", ({ url, point }) => {
        editor.markHistoryStoppingPoint("insert url")
        createTextShapeAt(editor, url.trim(), point)
      }),
    )
  }

  if (!editor.hasExternalContentHandler("svg-text")) {
    disposers.push(
      editor.registerExternalContentHandler("svg-text", ({ text, point }) => {
        editor.markHistoryStoppingPoint("insert svg")
        createImageShapesForAssets(editor, [createImageAssetFromSvgText(text, o)], point, o.stackOffset)
      }),
    )
  }

  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** Classify pasted or dropped plain text as our own clipboard JSON (`null`), a url, svg markup, or text. */
export function classifyExternalText(text: string, point?: VecLike): ExternalContent | null {
  if (!text.trim()) return null
  if (text.trimStart().startsWith("{")) {
    try {
      const data = JSON.parse(text) as { type?: unknown }
      if (data && data.type === "application/mocanvas") return null
    } catch {
      // ordinary text that happens to start with a brace
    }
  }
  const at = point ? { point } : {}
  if (looksLikeSvg(text)) return { type: "svg-text", text, ...at }
  if (looksLikeUrl(text)) return { type: "url", url: text.trim(), ...at }
  return { type: "text", text, ...at }
}
