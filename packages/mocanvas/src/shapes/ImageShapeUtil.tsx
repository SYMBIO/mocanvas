import {
  BaseBoxShapeUtil,
  Rectangle2d,
  type AssetId,
  type BaseShape,
  type Editor,
  type Geometry2d,
  type ImageAsset,
  type StyleWords,
} from "@mocanvas/editor"
import type { CSSProperties, ReactNode } from "react"
import { propsOf, readBoolean, readNumber, readString } from "./prop-access"

/** Normalized crop window: both corners in [0, 1] of the source image. */
export interface ImageCrop {
  topLeft: { x: number; y: number }
  bottomRight: { x: number; y: number }
  isCircle?: boolean
}

export interface ImageShapeProps {
  w: number
  h: number
  /** The image asset holding the pixels; `null` while nothing is attached. */
  assetId: AssetId | null
  /** Whether an animated image plays. */
  playing: boolean
  /** A hyperlink attached to the shape (not the image source). */
  url: string
  crop: ImageCrop | null
  flipX: boolean
  flipY: boolean
  altText: string
}

export type ImageShape = BaseShape<"image", ImageShapeProps>

export const IMAGE_PLACEHOLDER_FILL = "#eceff3"
export const IMAGE_PLACEHOLDER_STROKE = "#9fa8b2"

/**
 * The source the shape's pixels come from: the asset's `src` (a URL or data URL),
 * or `null` when the shape has no asset yet or the asset is still uploading.
 * `getImageTextureKey` turns it into a GPU texture; `component` draws the same
 * source in the DOM overlay while that texture loads (and for crops/flips).
 */
export function getImageTextureSource(editor: Editor, shape: ImageShape): string | null {
  const assetId = readString(propsOf(shape), "assetId", "") as AssetId | ""
  if (!assetId) return null
  const asset = editor.getAsset<ImageAsset>(assetId)
  if (!asset || asset.type !== "image") return null
  return asset.props.src ?? null
}

/**
 * Texture cache key for the shape's pixels, or `null` when it must stay on the
 * DOM overlay.
 *
 * The GPU path only covers the plain case. The engine maps uv `0..1` over the
 * shape's local geometry bounds, so a crop window or a flip would need the quad
 * to carry its own uvs; until the bridge does, cropped and flipped images (and
 * anything without a decoded source) are drawn by `component`.
 *
 * Assets are treated as immutable, so the key is the asset id: replacing an
 * asset's `src` in place keeps the cached texture.
 */
export function getImageTextureKey(editor: Editor, shape: ImageShape): string | null {
  const p = propsOf(shape)
  const assetId = readString(p, "assetId", "")
  if (!assetId || p["crop"] || readBoolean(p, "flipX", false) || readBoolean(p, "flipY", false)) return null
  if (!canUploadImageTextures()) return null
  return getImageTextureSource(editor, shape) === null ? null : `asset:${assetId}`
}

/** Whether this environment can decode an image into a texture source at all. */
export function canUploadImageTextures(): boolean {
  return typeof createImageBitmap === "function" || typeof Image === "function"
}

/** Decode an image `src` (URL or data URL) into something the GPU can sample. */
export async function loadImageTextureSource(src: string): Promise<TexImageSource> {
  const isData = src.startsWith("data:")
  if (!isData && typeof createImageBitmap === "function" && typeof fetch === "function") {
    const res = await fetch(src)
    if (!res.ok) throw new Error(`mocanvas: image asset request failed (${res.status})`)
    return await createImageBitmap(await res.blob())
  }
  return await loadHtmlImage(src, isData)
}

function loadHtmlImage(src: string, isData: boolean): Promise<HTMLImageElement> {
  if (typeof Image !== "function") return Promise.reject(new Error("mocanvas: no image decoder available"))
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (!isData) img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("mocanvas: image asset failed to decode"))
    img.src = src
  })
}

/** CSS for the `<img>` so the crop window fills the shape's box; `null` crop shows the whole image. */
export function getImageCropStyle(shape: ImageShape): CSSProperties {
  const { w, h } = readImageBox(shape)
  const p = propsOf(shape)
  const crop = readImageCrop(shape)
  const flipX = readBoolean(p, "flipX", false)
  const flipY = readBoolean(p, "flipY", false)
  const transform = flipX || flipY ? `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` : undefined
  if (!crop) {
    return { position: "absolute", left: 0, top: 0, width: w, height: h, ...(transform ? { transform } : {}) }
  }
  const cw = Math.max(1e-6, crop.bottomRight.x - crop.topLeft.x)
  const ch = Math.max(1e-6, crop.bottomRight.y - crop.topLeft.y)
  const fullW = w / cw
  const fullH = h / ch
  return {
    position: "absolute",
    left: -crop.topLeft.x * fullW,
    top: -crop.topLeft.y * fullH,
    width: fullW,
    height: fullH,
    ...(transform ? { transform } : {}),
  }
}

/** The shape's box, with each side falling back to the util's default. */
function readImageBox(shape: { props?: unknown }): { w: number; h: number } {
  const p = propsOf(shape)
  return { w: readNumber(p, "w", 100), h: readNumber(p, "h", 100) }
}

/** The crop window, or `null` when there is none or it is not shaped like one. */
function readImageCrop(shape: { props?: unknown }): ImageCrop | null {
  const crop = propsOf(shape)["crop"]
  if (typeof crop !== "object" || crop === null) return null
  const corners = crop as { topLeft?: unknown; bottomRight?: unknown }
  if (typeof corners.topLeft !== "object" || typeof corners.bottomRight !== "object") return null
  return {
    topLeft: { x: readNumber(corners.topLeft, "x", 0), y: readNumber(corners.topLeft, "y", 0) },
    bottomRight: { x: readNumber(corners.bottomRight, "x", 1), y: readNumber(corners.bottomRight, "y", 1) },
    isCircle: readBoolean(crop, "isCircle", false),
  }
}

export class ImageShapeUtil extends BaseBoxShapeUtil<ImageShape> {
  static override type = "image" as const

  getDefaultProps(): ImageShapeProps {
    return { w: 100, h: 100, assetId: null, playing: true, url: "", crop: null, flipX: false, flipY: false, altText: "" }
  }

  getGeometry(shape: ImageShape): Geometry2d {
    const { w, h } = readImageBox(shape)
    return new Rectangle2d({ width: Math.max(1, w), height: Math.max(1, h), isFilled: true })
  }

  /** A white textured quad over the shape's bounds, or `null` for the DOM overlay path. */
  override getRenderStyle(shape: ImageShape): StyleWords | null {
    const key = getImageTextureKey(this.editor, shape)
    if (!key) return null
    const src = getImageTextureSource(this.editor, shape)
    if (!src) return null
    const texture = this.editor.textures.acquire(key, () => loadImageTextureSource(src))
    if (!texture) return null
    return { fill: 0xffffffff, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1, texture }
  }

  /** The DOM overlay draws the image until (and unless) its texture is ready. */
  override needsOverlay(shape: ImageShape): boolean {
    if (super.needsOverlay(shape)) return true
    const key = getImageTextureKey(this.editor, shape)
    return key === null || !this.editor.textures.isReady(key)
  }

  component(shape: ImageShape): ReactNode {
    const { w, h } = readImageBox(shape)
    const crop = readImageCrop(shape)
    const altText = readString(propsOf(shape), "altText", "")
    const src = getImageTextureSource(this.editor, shape)
    const clip: CSSProperties = {
      position: "absolute",
      left: 0,
      top: 0,
      width: w,
      height: h,
      overflow: "hidden",
      ...(crop?.isCircle ? { borderRadius: "50%" } : {}),
    }
    if (!src) {
      return (
        <div
          style={{
            ...clip,
            boxSizing: "border-box",
            background: IMAGE_PLACEHOLDER_FILL,
            border: `1px dashed ${IMAGE_PLACEHOLDER_STROKE}`,
          }}
          aria-label={altText || "image"}
        />
      )
    }
    return (
      <div style={clip}>
        <img src={src} alt={altText} draggable={false} style={{ ...getImageCropStyle(shape), pointerEvents: "none", userSelect: "none" }} />
      </div>
    )
  }

  indicator(shape: ImageShape): ReactNode {
    const { w, h } = readImageBox(shape)
    return <rect width={w} height={h} />
  }

  override isAspectRatioLocked(_shape: ImageShape): boolean {
    return true
  }
}
