/**
 * Turning the canvas into a picture: the options an export takes, the
 * definitions shapes contribute to it, and the raster conversion at the end.
 *
 * An exported SVG has to be *self-contained* — it will be opened somewhere that
 * has none of this app's stylesheets, fonts or assets — which is why shapes
 * contribute `<defs>` rather than referencing anything, and why the raster
 * stage draws the SVG through an `Image` rather than screenshotting the canvas.
 */
import type { ReactNode } from "react"
import type { BoxLike } from "../geometry"
import type { EditorSvgExportOptions } from "./Editor"

/** The formats an export can be asked for. `"svg"` returns the markup itself. */
export type TLExportType = "svg" | "png" | "jpeg" | "webp"

/**
 * Options for a raster export (`toImage`, `toImageDataUrl`).
 *
 * Extends the SVG options because a raster export *is* an SVG export with one
 * more stage: everything that decides what the picture contains is shared, and
 * only the encoding is not.
 */
export interface TLImageExportOptions extends EditorSvgExportOptions {
  /** Output format. Defaults to `"png"`. */
  format?: TLExportType
  /** Encoder quality for the lossy formats, `0`–`1`. Ignored by PNG and SVG. */
  quality?: number
  /**
   * Multiplier on the output's pixel dimensions. Defaults to `2`, which is
   * sharp on the high-DPI display most people are looking at; raise it for
   * print.
   *
   * Distinct from `scale`, which changes the *logical* size — the coordinate
   * system the shapes are drawn in. Doubling the scale makes a 100pt shape
   * 200pt; doubling the pixel ratio leaves it 100pt and gives it four times as
   * many pixels.
   */
  pixelRatio?: number
  /** The page-space rectangle to export. Defaults to the bounds of the shapes. */
  bounds?: BoxLike
  /**
   * Space left around the shapes.
   *
   * `"auto"` renders with the editor's default padding and then trims back to
   * the visual content, which is what catches a thick stroke or an arrowhead
   * that overhangs its shape's bounds without leaving a margin of empty space.
   * A number is fixed padding, and clips anything past it; `0` is neither.
   */
  padding?: number | "auto"
  /** The SVG `preserveAspectRatio` attribute, verbatim. */
  preserveAspectRatio?: string
}

/**
 * A `<defs>` entry a shape needs present in the exported SVG — a gradient, a
 * marker, a filter, a pattern.
 *
 * Collected across every shape being exported and de-duplicated by `key`, so
 * ten thousand arrows share one arrowhead marker rather than carrying one each.
 * `key` is therefore the identity of the *definition*, not of the shape: two
 * shapes returning the same key must mean the same thing by it.
 *
 * `getElement` may be async because a definition can need something fetched —
 * an embedded font, an inlined image — and the export waits for all of them
 * before it serializes.
 */
export interface SvgExportDef {
  key: string
  getElement(): ReactNode | Promise<ReactNode>
}

/** Options for {@link getSvgAsImage}. */
export interface GetSvgAsImageOptions {
  /** Output format. Defaults to `"png"`. */
  type?: Exclude<TLExportType, "svg">
  /** Encoder quality for the lossy formats, `0`–`1`. */
  quality?: number
  /** Multiplier on the output's pixel dimensions. Defaults to `2`. */
  pixelRatio?: number
  /** The SVG's logical width in CSS pixels. */
  width: number
  /** The SVG's logical height in CSS pixels. */
  height: number
}

/**
 * The widest canvas most browsers will allocate, per side.
 *
 * Past it, `getContext("2d")` returns a context that silently draws nothing —
 * not an error, a blank image — so an oversized export has to be scaled down
 * rather than attempted. 8192 is the smallest limit in current use, and being
 * conservative here costs resolution on an export that would otherwise fail
 * completely.
 */
const MAX_CANVAS_DIMENSION = 8192

/**
 * Rasterise an SVG.
 *
 * The SVG is loaded into an `Image` and drawn to a canvas, which is the only
 * way to get the browser's own SVG renderer to produce pixels. That means the
 * markup must already be self-contained: an `Image` loading an SVG gets no
 * access to the page's stylesheets, fonts or cookies, so anything left as an
 * external reference simply does not appear.
 *
 * Resolves `null` when there is no DOM to do it in, or when the browser refuses
 * the image — a caller that wanted a picture and got nothing can fall back to
 * offering the SVG itself.
 */
export async function getSvgAsImage(svgString: string, options: GetSvgAsImageOptions): Promise<Blob | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null

  const { width, height, type = "png", quality, pixelRatio = 2 } = options
  if (!(width > 0) || !(height > 0)) return null

  // Clamp *before* allocating: a canvas over the limit fails silently, and a
  // slightly small export is much better than a blank one.
  const ratio = Math.min(pixelRatio, MAX_CANVAS_DIMENSION / width, MAX_CANVAS_DIMENSION / height)
  const pixelWidth = Math.max(1, Math.floor(width * ratio))
  const pixelHeight = Math.max(1, Math.floor(height * ratio))

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
  const image = await loadImage(url)
  if (!image) return null

  const canvas = document.createElement("canvas")
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(image, 0, 0, pixelWidth, pixelHeight)

  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), `image/${type}`, quality)
  })
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    // A decode failure is a normal outcome — malformed markup, a data URL past
    // the browser's length limit — and the caller has a fallback.
    image.onerror = () => resolve(null)
    image.src = url
  })
}
