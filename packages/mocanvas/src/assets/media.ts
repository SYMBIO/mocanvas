/**
 * The file-handling bits every asset path shares: measuring an image, shrinking
 * one, deciding whether a file is allowed at all, and turning finished assets
 * into shapes.
 *
 * They live apart from the asset utils because the drop handler, the paste
 * handler and an app's own upload button all need them and none of them has an
 * asset util to hand at the point they need it.
 */

import { createShapeId, type Asset, type Editor, type ShapeId, type VecLike } from "@mocanvas/editor"
import type { TLDefaultExternalContentHandlerOpts } from "../external/handler-options"

/** Pixel dimensions of an image. */
export interface ImageDimensions {
  w: number
  h: number
}

const FALLBACK_IMAGE_SIZE: ImageDimensions = { w: 100, h: 100 }

/**
 * Scale `size` down — never up — so neither side exceeds `max`, keeping the
 * aspect ratio.
 *
 * Never scaling up is the whole point: a 32×32 icon dropped on the canvas
 * should arrive as a 32×32 shape, not blown up to the maximum.
 */
export function downsizeDimensions(size: ImageDimensions, max = Infinity): ImageDimensions {
  const w = Math.max(1, size.w)
  const h = Math.max(1, size.h)
  const scale = Math.min(1, max / Math.max(w, h))
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

/**
 * Re-encode an image blob at `width`×`height`.
 *
 * Used before an asset is stored, so a 12-megapixel photo does not become a
 * 16 MB data URL in the document. Returns the original blob unchanged where no
 * canvas is available, or where the requested size is not smaller — shrinking
 * is an optimisation, and failing it must not fail the drop.
 */
export async function downsizeImage(
  blob: Blob,
  width: number,
  height: number,
  opts: { quality?: number; type?: string } = {},
): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return blob
  try {
    const bitmap = await createImageBitmap(blob)
    if (bitmap.width <= width && bitmap.height <= height) {
      bitmap.close()
      return blob
    }
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
    const context = canvas.getContext("2d")
    if (!context) {
      bitmap.close()
      return blob
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await canvas.convertToBlob({ type: opts.type ?? blob.type ?? "image/png", quality: opts.quality ?? 0.92 })
  } catch {
    return blob
  }
}

/**
 * The pixel size of an image from its source.
 *
 * Falls back to a small square rather than throwing: an image whose size cannot
 * be read still deserves to land on the canvas, where the user can resize it,
 * instead of the drop silently doing nothing.
 */
export async function readImageSize(src: string, file?: File): Promise<ImageDimensions> {
  if (file && typeof createImageBitmap === "function" && file.type !== "image/svg+xml") {
    try {
      const bitmap = await createImageBitmap(file)
      const size = { w: bitmap.width, h: bitmap.height }
      bitmap.close()
      return size
    } catch {
      // Unsupported type — fall through to the element path.
    }
  }
  if (typeof Image === "undefined") return FALLBACK_IMAGE_SIZE
  return new Promise<ImageDimensions>((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || FALLBACK_IMAGE_SIZE.w, h: img.naturalHeight || FALLBACK_IMAGE_SIZE.h })
    img.onerror = () => resolve(FALLBACK_IMAGE_SIZE)
    img.src = src
  })
}

/** The default ceiling {@link notifyIfFileNotAllowed} applies when none is configured. */
const DEFAULT_MAX_ASSET_SIZE_BYTES = 10 * 1024 * 1024

/**
 * Whether `file` may be turned into an asset — and if not, say so on screen.
 *
 * Returns `true` when the file is allowed. The toast is the point: a file that
 * is silently ignored looks like a broken drop target, so every rejection here
 * produces one, with the reason spelled out.
 */
export function notifyIfFileNotAllowed(editor: Editor, file: File, options: TLDefaultExternalContentHandlerOpts): boolean {
  const { toasts, msg, maxAssetSize = DEFAULT_MAX_ASSET_SIZE_BYTES, acceptedImageMimeTypes, acceptedVideoMimeTypes } = options

  if (maxAssetSize !== undefined && file.size > maxAssetSize) {
    toasts.addToast({
      title: msg("assets.files.size-too-big"),
      severity: "error",
    })
    return false
  }

  // An accept list is only consulted when the caller supplied one: leaving it
  // out means "whatever an asset util claims", which is the sensible default
  // once an app has registered utils of its own.
  const accepted = [...(acceptedImageMimeTypes ?? []), ...(acceptedVideoMimeTypes ?? [])]
  const isKnown = accepted.length > 0 ? accepted.some((type) => type.toLowerCase() === file.type.toLowerCase()) : editor.getAssetUtilForMimeType(file.type) !== undefined

  if (!isKnown) {
    toasts.addToast({
      title: msg("assets.files.type-not-allowed"),
      severity: "error",
    })
    return false
  }

  return true
}

/**
 * Store `assets` and create the shape each one calls for, centred on
 * `position` and stacked so several dropped files do not land exactly on top
 * of one another.
 *
 * Which shape an asset becomes is the asset util's answer, via
 * `editor.getShapeUtilForAssetType` — so an app that registered a util for its
 * own asset type gets its own shape here without changing this function.
 */
export async function createShapesForAssets(editor: Editor, assets: Asset[], position: VecLike): Promise<ShapeId[]> {
  if (assets.length === 0) return []
  const ids: ShapeId[] = []
  const stackOffset = 20

  editor.run(() => {
    editor.createAssets(assets.map((asset) => ({ id: asset.id, type: asset.type, props: asset.props, meta: asset.meta })))
    const shapes = assets.flatMap((asset, index) => {
      const shapeType = editor.getShapeUtilForAssetType?.(asset.type)?.type ?? shapeTypeForAsset(asset)
      if (!shapeType) return []
      const id = createShapeId()
      ids.push(id)
      const { w, h } = sizeOfAsset(asset)
      return [
        {
          id,
          type: shapeType,
          x: position.x - w / 2 + index * stackOffset,
          y: position.y - h / 2 + index * stackOffset,
          props: { w, h, assetId: asset.id },
        },
      ]
    })
    if (shapes.length > 0) {
      editor.createShapes(shapes as never)
      editor.setSelectedShapes(ids)
    }
  })

  return ids
}

/** The shape type a built-in asset becomes, when no util claims it. */
function shapeTypeForAsset(asset: Asset): string | undefined {
  if (asset.type === "image") return "image"
  if (asset.type === "video") return "video"
  if (asset.type === "bookmark") return "bookmark"
  return undefined
}

/** The size a new shape for `asset` should start at. */
function sizeOfAsset(asset: Asset): ImageDimensions {
  const props = asset.props as { w?: number; h?: number }
  if (typeof props.w === "number" && typeof props.h === "number" && props.w > 0 && props.h > 0) return { w: props.w, h: props.h }
  // A bookmark has no intrinsic size; this is the card the bookmark shape draws.
  return { w: 300, h: 320 }
}
