/**
 * Rasterizes a text label to an offscreen canvas so the engine can draw it as a
 * textured quad instead of a DOM node.
 *
 * This is the pragmatic version of the phase-3 glyph atlas: one texture per
 * distinct label instead of one atlas of glyphs. Line breaking goes through the
 * shared `TextMeasure`, so a rasterized label wraps exactly where the DOM label
 * it replaces would.
 */
import { getTextMeasure } from "./TextMeasure"

export type TextTextureAlign = "start" | "middle" | "end"

export interface TextTextureSpec {
  text: string
  fontFamily: string
  fontSize: number
  /** Any CSS color string. */
  color: string
  align: TextTextureAlign
  verticalAlign: TextTextureAlign
  /** Unitless line-height multiplier. */
  lineHeight: number
  /** The box the texture covers, in page units — the shape's local geometry bounds. */
  width: number
  height: number
  /** Soft-wrap width in page units. Omit for no wrapping (one line per paragraph). */
  maxWidth?: number
  /**
   * Device pixels per page unit the canvas is rasterized at, i.e.
   * `dpr × min(4, zoom)`. Callers bucket it to a power of two
   * (`bucketTextureResolution` / `editor.getTextureResolution()`) so zooming
   * does not re-rasterize every frame.
   */
  resolution: number
  /** Padding inside the box, in page units. */
  padding?: number
}

/** Hard cap on either canvas dimension, so a huge label cannot blow up the GPU. */
export const MAX_TEXT_TEXTURE_PX = 4096

/**
 * Cache key for a spec. Stable for equal specs and different for every field
 * that changes the pixels — the resolution bucket included.
 */
export function getTextTextureKey(spec: TextTextureSpec): string {
  return [
    "text",
    spec.fontFamily,
    spec.fontSize,
    spec.lineHeight,
    spec.color,
    spec.align,
    spec.verticalAlign,
    round(spec.width),
    round(spec.height),
    spec.maxWidth === undefined ? "" : round(spec.maxWidth),
    spec.padding ?? 0,
    spec.resolution,
    spec.text,
  ].join("|")
}

/** Width of one unwrapped run, through the shared measurer (cached). */
function runWidth(text: string, spec: TextTextureSpec): number {
  if (text.length === 0) return 0
  return getTextMeasure().measureText(text, {
    fontFamily: spec.fontFamily,
    fontSize: spec.fontSize,
    lineHeight: spec.lineHeight,
  }).w
}

/**
 * Break `spec.text` into the lines the label renders as: hard newlines always,
 * plus greedy word wrapping at `maxWidth` (breaking inside a word only when a
 * single word does not fit), mirroring `overflow-wrap: break-word`. Unlike the
 * SVG exporter's `wrapTextLines`, widths come from the shared `TextMeasure`, so
 * the raster matches the DOM label it replaces.
 */
export function wrapTextTextureLines(spec: TextTextureSpec): string[] {
  const padding = spec.padding ?? 0
  const max = spec.maxWidth === undefined ? undefined : Math.max(1, spec.maxWidth - padding * 2)
  const out: string[] = []
  for (const paragraph of spec.text.split("\n")) {
    if (max === undefined || paragraph.length === 0) {
      out.push(paragraph)
      continue
    }
    let line = ""
    for (const word of paragraph.split(" ")) {
      const candidate = line.length === 0 ? word : `${line} ${word}`
      if (runWidth(candidate, spec) <= max || line.length === 0) {
        line = candidate
        // A single word wider than the box is split by characters.
        if (line.length > 0 && runWidth(line, spec) > max) {
          const parts = breakLongWord(line, spec, max)
          out.push(...parts.slice(0, -1))
          line = parts[parts.length - 1] ?? ""
        }
        continue
      }
      out.push(line)
      line = word
    }
    out.push(line)
  }
  return out
}

function breakLongWord(word: string, spec: TextTextureSpec, max: number): string[] {
  const parts: string[] = []
  let current = ""
  for (const char of word) {
    const next = current + char
    if (current.length > 0 && runWidth(next, spec) > max) {
      parts.push(current)
      current = char
    } else {
      current = next
    }
  }
  parts.push(current)
  return parts
}

/** Effective resolution after clamping the canvas to `MAX_TEXT_TEXTURE_PX`. */
export function getTextTextureScale(spec: TextTextureSpec): number {
  const longest = Math.max(1, spec.width, spec.height)
  return Math.max(0.05, Math.min(spec.resolution, MAX_TEXT_TEXTURE_PX / longest))
}

/**
 * Draw the label onto a canvas covering the whole `width × height` box, so the
 * engine's uv `0..1` quad over the shape's local bounds lands pixel-for-pixel.
 * Throws where there is no `document` (Node, SSR) — callers keep the DOM path.
 */
export function renderTextToCanvas(spec: TextTextureSpec): HTMLCanvasElement {
  if (typeof document === "undefined") throw new Error("mocanvas: no document to rasterize text with")
  const scale = getTextTextureScale(spec)
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.ceil(spec.width * scale))
  canvas.height = Math.max(1, Math.ceil(spec.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("mocanvas: no 2d context to rasterize text with")

  const padding = spec.padding ?? 0
  const lines = wrapTextTextureLines(spec)
  const lineHeightPx = spec.fontSize * spec.lineHeight
  const blockHeight = lines.length * lineHeightPx

  ctx.scale(scale, scale)
  ctx.font = `${spec.fontSize}px ${spec.fontFamily}`
  ctx.fillStyle = spec.color
  ctx.textBaseline = "middle"
  ctx.textAlign = spec.align === "start" ? "left" : spec.align === "end" ? "right" : "center"

  const innerH = Math.max(0, spec.height - padding * 2)
  const x = spec.align === "start" ? padding : spec.align === "end" ? spec.width - padding : spec.width / 2
  const top = padding + (spec.verticalAlign === "start" ? 0 : spec.verticalAlign === "end" ? innerH - blockHeight : (innerH - blockHeight) / 2)

  for (let i = 0; i < lines.length; i++) {
    // CSS centres a run inside its line box; the canvas baseline does the same.
    ctx.fillText(lines[i]!, x, top + i * lineHeightPx + lineHeightPx / 2)
  }
  return canvas
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}
