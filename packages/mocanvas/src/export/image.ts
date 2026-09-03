/**
 * Export shapes to a `Blob` (SVG or raster), plus small browser helpers to
 * download or copy the result. Raster export needs a DOM; the functions guard
 * for Node and fail with a clear error instead of a reference error.
 */
import type { Editor, ShapeId } from "@mocanvas/editor"
import { getSvgString, type SvgExportOptions } from "./svg"

export type ExportFormat = "svg" | "png" | "jpeg" | "webp"

export interface ExportToBlobOptions extends SvgExportOptions {
  ids?: readonly ShapeId[]
  format: ExportFormat
  /** Encoder quality for lossy formats (0..1). */
  quality?: number
  /** Device pixel ratio multiplier for raster output. Defaults to `window.devicePixelRatio`. */
  pixelRatio?: number
}

const MIME: Record<ExportFormat, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
}

function hasDom(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined"
}

/** Render the export to a `Blob`. SVG works anywhere; raster formats need a browser. */
export async function exportToBlob(editor: Editor, opts: ExportToBlobOptions): Promise<Blob> {
  const { ids, format, quality, pixelRatio, ...svgOpts } = opts
  const result = getSvgString(editor, ids, svgOpts)
  if (!result) throw new Error("Nothing to export")
  const svgBlob = new Blob([result.svg], { type: MIME.svg })
  if (format === "svg") return svgBlob

  if (!hasDom()) {
    throw new Error(`Raster export ("${format}") needs a browser environment; only "svg" is available here`)
  }

  const ratio = pixelRatio ?? (window.devicePixelRatio || 1)
  const url = URL.createObjectURL(svgBlob)
  try {
    const image = await loadImage(url)
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(result.width * ratio))
    canvas.height = Math.max(1, Math.round(result.height * ratio))
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Could not create a 2D canvas context")
    if (format === "jpeg" && !svgOpts.background) {
      // JPEG has no alpha; paint the page colour so transparent areas do not turn black.
      ctx.fillStyle = svgOpts.darkMode ? "#101011" : "#f9fafb"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await canvasToBlob(canvas, MIME[format], quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = "sync"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Could not rasterize the SVG"))
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error(`Canvas could not encode "${type}"`))
      },
      type,
      quality,
    )
  })
}

/** Trigger a download of `blob` as `filename`. No-op outside a browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (!hasDom()) return
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.rel = "noopener"
  anchor.style.display = "none"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Give the browser a tick to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Copy `blob` to the system clipboard. Images go through `ClipboardItem`;
 * SVG (which clipboards do not accept as an image) is copied as text.
 */
export async function copyBlobToClipboard(blob: Blob): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (!clipboard) throw new Error("Clipboard API is not available")
  if (blob.type === MIME.svg || !("write" in clipboard) || typeof ClipboardItem === "undefined") {
    if (blob.type !== MIME.svg && !("writeText" in clipboard)) throw new Error("Clipboard does not accept images")
    await clipboard.writeText(await blob.text())
    return
  }
  await clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}
