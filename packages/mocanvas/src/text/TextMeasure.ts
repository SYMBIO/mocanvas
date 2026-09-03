import { estimateTextSize } from "../shapes/text-helpers"

export interface TextMeasureOptions {
  fontFamily: string
  fontSize: number
  fontWeight?: string | number
  /** Unitless line height (multiplier of the font size). */
  lineHeight: number
  /** Wrap width in CSS px, including `padding`. Omit for a single unwrapped run per paragraph. */
  maxWidth?: number
  /** Padding applied on every side; included in the returned `w`/`h`. */
  padding?: number
}

export interface TextMeasurement {
  w: number
  h: number
  lineCount: number
}

const MAX_CACHE_ENTRIES = 2000

/** Placeholder so an empty text (or a trailing newline) still occupies one line. */
const ZERO_WIDTH_SPACE = "\u200b"

/** Text exactly as the static label / measuring element must render it to occupy the right box. */
export function toDisplayText(text: string): string {
  if (text.length === 0) return ZERO_WIDTH_SPACE
  return text.endsWith("\n") ? text + ZERO_WIDTH_SPACE : text
}

/**
 * Measures runs of text with a hidden DOM element, mirroring the CSS the
 * `<TextLabel>` component uses (pre-wrap + break-word, border-box padding).
 * Falls back to `estimateTextSize` where no `document` exists (tests, SSR).
 */
export class TextMeasure {
  private element: HTMLDivElement | null = null
  private readonly cache = new Map<string, TextMeasurement>()

  measureText(text: string, opts: TextMeasureOptions): TextMeasurement {
    const key = cacheKey(text, opts)
    const hit = this.cache.get(key)
    if (hit) return hit
    const result = typeof document === "undefined" ? this.estimate(text, opts) : this.measureDom(text, opts)
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(key, result)
    return result
  }

  /** Number of cached measurements (for tests and debugging). */
  get cacheSize(): number {
    return this.cache.size
  }

  clearCache(): void {
    this.cache.clear()
  }

  dispose(): void {
    this.cache.clear()
    this.element?.remove()
    this.element = null
  }

  private estimate(text: string, opts: TextMeasureOptions): TextMeasurement {
    const padding = opts.padding ?? 0
    const inner = opts.maxWidth === undefined ? Infinity : Math.max(1, opts.maxWidth - padding * 2)
    const est = estimateTextSize(text, opts.fontSize, inner)
    return {
      w: est.w + padding * 2,
      h: est.lines * opts.fontSize * opts.lineHeight + padding * 2,
      lineCount: est.lines,
    }
  }

  private measureDom(text: string, opts: TextMeasureOptions): TextMeasurement {
    const el = this.getElement()
    const padding = opts.padding ?? 0
    const s = el.style
    s.fontFamily = opts.fontFamily
    s.fontSize = `${opts.fontSize}px`
    s.fontWeight = opts.fontWeight === undefined ? "normal" : String(opts.fontWeight)
    s.lineHeight = String(opts.lineHeight)
    s.padding = `${padding}px`
    s.maxWidth = opts.maxWidth === undefined ? "none" : `${Math.max(1, opts.maxWidth)}px`
    el.textContent = toDisplayText(text)
    const rect = el.getBoundingClientRect()
    const lineHeightPx = opts.fontSize * opts.lineHeight
    const contentH = Math.max(0, rect.height - padding * 2)
    const lineCount = lineHeightPx > 0 ? Math.max(1, Math.round(contentH / lineHeightPx)) : 1
    // Round up so a label sized from the result never wraps differently than the probe.
    return { w: Math.ceil(rect.width * 100) / 100, h: Math.ceil(rect.height * 100) / 100, lineCount }
  }

  private getElement(): HTMLDivElement {
    if (this.element && this.element.isConnected) return this.element
    const el = document.createElement("div")
    el.setAttribute("aria-hidden", "true")
    el.className = "mocanvas-text-measure"
    Object.assign(el.style, {
      position: "fixed",
      top: "-10000px",
      left: "-10000px",
      visibility: "hidden",
      pointerEvents: "none",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      wordBreak: "normal",
      width: "max-content",
      boxSizing: "border-box",
      margin: "0",
      border: "0",
      zIndex: "-1",
    } satisfies Partial<CSSStyleDeclaration>)
    document.body.appendChild(el)
    this.element = el
    return el
  }
}

function cacheKey(text: string, o: TextMeasureOptions): string {
  return `${o.fontFamily}|${o.fontSize}|${o.fontWeight ?? ""}|${o.lineHeight}|${o.maxWidth ?? ""}|${o.padding ?? 0}|${text}`
}

let singleton: TextMeasure | null = null

/** The shared measurer. */
export function getTextMeasure(): TextMeasure {
  if (!singleton) singleton = new TextMeasure()
  return singleton
}
