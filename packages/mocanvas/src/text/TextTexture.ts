/**
 * Rasterizes a text label to an offscreen canvas so the engine can draw it as a
 * textured quad instead of a DOM node.
 *
 * This is the pragmatic version of the phase-3 glyph atlas: one texture per
 * distinct label instead of one atlas of glyphs. Line breaking goes through the
 * shared `TextMeasure`, so a rasterized label wraps exactly where the DOM label
 * it replaces would.
 */
import { richTextToBlocks, richTextToText, type RichTextRun, type RichTextRunStyle, type RichTextSource } from "./rich-text"
import { getTextMeasure } from "./TextMeasure"

export type TextTextureAlign = "start" | "middle" | "end"

export interface TextTextureSpec {
  /**
   * The label as plain text. Ignored when {@link TextTextureSpec.richText} is
   * set; derived from it when only `richText` is given.
   */
  text: string
  /**
   * The label as a rich-text document. When present the raster is drawn run by
   * run, so bold, italic, underlined and struck-through spans keep their
   * formatting on the GPU path rather than only in the DOM overlay.
   */
  richText?: RichTextSource
  fontFamily: string
  fontSize: number
  /** Any CSS color string. */
  color: string
  /** Horizontal alignment. Named `align` before v5; `align` is still accepted. */
  textAlign?: TextTextureAlign
  /** @deprecated v5 renamed this to `textAlign`. */
  align?: TextTextureAlign
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

/** Horizontal alignment of a spec, from either spelling. */
export function textTextureAlign(spec: TextTextureSpec): TextTextureAlign {
  return spec.textAlign ?? spec.align ?? "start"
}

/** The plain text of a spec: the document's text when it has one, else `text`. */
export function textTextureText(spec: TextTextureSpec): string {
  return spec.richText === undefined || spec.richText === null ? spec.text : richTextToText(spec.richText)
}

/**
 * Cache key for a spec. Stable for equal specs and different for every field
 * that changes the pixels — the resolution bucket and the rich-text document
 * included.
 */
export function getTextTextureKey(spec: TextTextureSpec): string {
  return [
    "text",
    spec.fontFamily,
    spec.fontSize,
    spec.lineHeight,
    spec.color,
    textTextureAlign(spec),
    spec.verticalAlign,
    round(spec.width),
    round(spec.height),
    spec.maxWidth === undefined ? "" : round(spec.maxWidth),
    spec.padding ?? 0,
    spec.resolution,
    spec.richText === undefined || spec.richText === null ? spec.text : JSON.stringify(spec.richText),
  ].join("|")
}

/** Width of one unwrapped run, through the shared measurer (cached). */
function runWidth(text: string, spec: TextTextureSpec, style?: RichTextRunStyle): number {
  if (text.length === 0) return 0
  return getTextMeasure().measureText(text, {
    fontFamily: spec.fontFamily,
    fontSize: spec.fontSize,
    lineHeight: spec.lineHeight,
    ...(style?.bold ? { fontWeight: "bold" } : {}),
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
  for (const paragraph of textTextureText(spec).split("\n")) {
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

/** One rendered line of a rich-text raster: the styled runs it is made of, and their total width. */
export interface TextTextureLine {
  runs: RichTextRun[]
  width: number
}

function sameStyle(a: RichTextRunStyle, b: RichTextRunStyle): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike && a.code === b.code && a.href === b.href
}

/**
 * Break a spec's label into the lines the raster draws, keeping each run's
 * formatting.
 *
 * Same greedy word wrapping as {@link wrapTextTextureLines} — hard newlines
 * (here: block boundaries and `hardBreak` nodes) always break, a word that does
 * not fit is split by characters — but a line is a list of styled runs rather
 * than a string, so a bold word inside a sentence is measured and drawn bold.
 * A spec with no `richText` yields one unstyled run per line, so the two
 * functions agree line for line.
 */
export function wrapTextTextureRuns(spec: TextTextureSpec): TextTextureLine[] {
  const padding = spec.padding ?? 0
  const max = spec.maxWidth === undefined ? undefined : Math.max(1, spec.maxWidth - padding * 2)
  const source: RichTextSource = spec.richText === undefined || spec.richText === null ? spec.text : spec.richText
  const out: TextTextureLine[] = []

  for (const block of richTextToBlocks(source)) {
    let line: RichTextRun[] = []
    let width = 0
    const push = (): void => {
      // A line never keeps the space it broke at, so it aligns like the DOM
      // label and like `wrapTextTextureLines`.
      while (line.length > 0 && /^\s+$/u.test(line[line.length - 1]!.text)) {
        const dropped = line.pop()!
        width -= runWidth(dropped.text, spec, dropped)
      }
      out.push({ runs: mergeRuns(line), width: Math.max(0, width) })
      line = []
      width = 0
    }
    for (const run of block.runs) {
      // Keep the separators so a wrapped line does not lose or gain a space.
      for (const token of run.text.split(/(\s+)/u).filter((t) => t.length > 0)) {
        const isSpace = /^\s+$/u.test(token)
        const tokenWidth = runWidth(token, spec, run)
        if (max !== undefined && !isSpace && line.length > 0 && width + tokenWidth > max) {
          push()
        }
        // A leading space on a freshly wrapped line is dropped, as CSS does.
        if (isSpace && line.length === 0) continue
        if (max !== undefined && !isSpace && tokenWidth > max) {
          for (const piece of breakLongToken(token, spec, run, max, width, line.length > 0)) {
            if (piece === null) push()
            else {
              line.push({ ...run, text: piece })
              width += runWidth(piece, spec, run)
            }
          }
          continue
        }
        line.push({ ...run, text: token })
        width += tokenWidth
      }
    }
    push()
  }
  return out
}

/**
 * Split a token wider than the line into pieces, emitting `null` where the
 * caller must start a new line first.
 */
function breakLongToken(token: string, spec: TextTextureSpec, style: RichTextRunStyle, max: number, startWidth: number, canBreakFirst: boolean): (string | null)[] {
  const out: (string | null)[] = []
  if (canBreakFirst && startWidth > 0) out.push(null)
  let current = ""
  for (const char of token) {
    const next = current + char
    if (current.length > 0 && runWidth(next, spec, style) > max) {
      out.push(current, null)
      current = char
    } else {
      current = next
    }
  }
  if (current.length > 0) out.push(current)
  return out
}

/** Collapse neighbouring runs that share a style, so the renderer draws one `fillText` per style change. */
function mergeRuns(runs: readonly RichTextRun[]): RichTextRun[] {
  const out: RichTextRun[] = []
  for (const run of runs) {
    const last = out[out.length - 1]
    if (last && sameStyle(last, run)) last.text += run.text
    else out.push({ ...run })
  }
  return out
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
  const lines = wrapTextTextureRuns(spec)
  const lineHeightPx = spec.fontSize * spec.lineHeight
  const blockHeight = lines.length * lineHeightPx
  const align = textTextureAlign(spec)

  ctx.scale(scale, scale)
  ctx.fillStyle = spec.color
  ctx.textBaseline = "middle"
  // Runs are placed left to right by hand, so the context always draws from the
  // run's own left edge; the line's alignment is in `lineLeft` below.
  ctx.textAlign = "left"

  const innerH = Math.max(0, spec.height - padding * 2)
  const innerW = Math.max(0, spec.width - padding * 2)
  const top = padding + (spec.verticalAlign === "start" ? 0 : spec.verticalAlign === "end" ? innerH - blockHeight : (innerH - blockHeight) / 2)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // CSS centres a run inside its line box; the canvas baseline does the same.
    const baseline = top + i * lineHeightPx + lineHeightPx / 2
    let x = padding + (align === "start" ? 0 : align === "end" ? innerW - line.width : (innerW - line.width) / 2)
    for (const run of line.runs) {
      ctx.font = runFont(run, spec)
      ctx.fillText(run.text, x, baseline)
      const width = runWidth(run.text, spec, run)
      if (run.underline || run.strike) {
        const thickness = Math.max(1, spec.fontSize / 14)
        const y = run.underline ? baseline + spec.fontSize * 0.4 : baseline
        ctx.fillRect(x, y - thickness / 2, width, thickness)
      }
      x += width
    }
  }
  return canvas
}

/** The `ctx.font` shorthand a run draws with. */
function runFont(style: RichTextRunStyle, spec: TextTextureSpec): string {
  const parts: string[] = []
  if (style.italic) parts.push("italic")
  if (style.bold) parts.push("bold")
  parts.push(`${spec.fontSize}px`, spec.fontFamily)
  return parts.join(" ")
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}
