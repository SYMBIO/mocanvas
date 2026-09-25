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

export interface TextMeasureHtmlOptions {
  fontFamily: string
  fontSize: number
  fontWeight?: string | number
  /** CSS `font-style`, e.g. `"italic"`. */
  fontStyle?: string
  /** Unitless line height (multiplier of the font size). */
  lineHeight: number
  /** Wrap width in CSS px, including `padding`. Omit (or `null`) for no wrapping. */
  maxWidth?: number | null
  /** CSS padding, as a number of px or any padding shorthand (`"0px"`, `"4px 8px"`). */
  padding?: number | string
  /**
   * Also report `scrollWidth`, with the DOM property's meaning: the width the
   * content *cannot* be made to fit in. Text that wraps reports the wrap width;
   * only something unbreakable — one long word, a URL — reports more.
   *
   * That distinction is the whole point of asking: a shrink-to-fit pass tells
   * "wraps" (fine, keep this size) from "overflows" (too big, shrink) by
   * comparing it against the wrap width.
   */
  measureScrollWidth?: boolean
  /** Extra CSS declarations applied to the probe, e.g. `{ "font-variant": "small-caps" }`. */
  otherStyles?: Record<string, string>
}

export interface TextHtmlMeasurement extends TextMeasurement {
  /**
   * The DOM's `scrollWidth`: the width below which the content overflows rather
   * than wraps. Equal to `w` for text that wraps, larger only when an
   * unbreakable run is wider than the box. Equals `w` unless
   * `measureScrollWidth` was set.
   */
  scrollWidth: number
}

/**
 * The longest run of text that cannot be broken across lines — a word, a URL —
 * which is the only thing that makes a box overflow rather than wrap.
 *
 * Whitespace is where a line may break. This does not know the finer rules
 * (soft hyphens, CJK, `overflow-wrap`), which is why it only stands in for the
 * DOM when there is no DOM to ask.
 */
/**
 * Whether the probe still breaks long words, which is its default and the
 * label's. A caller overriding `overflow-wrap` or `word-break` through
 * `otherStyles` is asking for the opposite, and then a long word can overflow.
 */
function breaksWords(otherStyles: Record<string, string> | undefined): boolean {
  const wrap = otherStyles?.["overflow-wrap"] ?? otherStyles?.["overflowWrap"]
  const brk = otherStyles?.["word-break"] ?? otherStyles?.["wordBreak"]
  if (wrap !== undefined && wrap !== "break-word" && wrap !== "anywhere") return false
  if (brk === "keep-all") return false
  return true
}

function longestUnbreakableRun(text: string): string {
  let longest = ""
  for (const run of text.split(/\s+/)) if (run.length > longest.length) longest = run
  return longest
}

/**
 * The probe's own layout rules, mirroring the CSS `<TextLabel>` renders with. Written once, when the
 * element is created, so `otherStyles` from a `measureHtml` call must put back any it overwrites.
 */
const PROBE_BASE_STYLE = {
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
} satisfies Partial<CSSStyleDeclaration>

/** The same rules keyed by CSS property name, to look up the value an `otherStyles` entry overwrote. */
const PROBE_BASE_DECLARATIONS: Record<string, string> = Object.fromEntries(
  Object.entries(PROBE_BASE_STYLE).map(([name, value]) => [cssPropertyName(name), value]),
)

/** `overflowWrap` and `overflow-wrap` name one declaration; `setProperty` only takes the latter. */
function cssPropertyName(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
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
 *
 * `measureHtml` measures a rich-text label the same way, from the HTML
 * `renderHtmlFromRichTextForMeasurement` produces. Both paths share the cache
 * and the probe element, so a rich-text label and the plain-text label it
 * flattens to are measured by the same code.
 */
export class TextMeasure {
  private element: HTMLDivElement | null = null
  private htmlElement: HTMLDivElement | null = null
  private readonly cache = new Map<string, TextMeasurement>()
  private readonly htmlCache = new Map<string, TextHtmlMeasurement>()

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

  /**
   * Measure a run of HTML — a rich-text label — laid out the way the DOM
   * overlay renders it.
   *
   * Only pass HTML this package generated (`richTextToHtml` escapes text and
   * scheme-checks link hrefs); the probe is inert but it is still a live DOM
   * subtree.
   */
  measureHtml(html: string, opts: TextMeasureHtmlOptions): TextHtmlMeasurement {
    const key = htmlCacheKey(html, opts)
    const hit = this.htmlCache.get(key)
    if (hit) return hit
    const result = typeof document === "undefined" ? this.estimateHtml(html, opts) : this.measureHtmlDom(html, opts)
    if (this.htmlCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.htmlCache.keys().next().value
      if (oldest !== undefined) this.htmlCache.delete(oldest)
    }
    this.htmlCache.set(key, result)
    return result
  }

  /**
   * Measure several HTML runs against one probe. Nothing is shared between the
   * items beyond the element itself; the win is one style write and one layout
   * flush per item instead of one per call site.
   */
  measureHtmlBatch(items: readonly { html: string; opts: TextMeasureHtmlOptions }[]): TextHtmlMeasurement[] {
    return items.map((item) => this.measureHtml(item.html, item.opts))
  }

  /** Number of cached measurements (for tests and debugging). */
  get cacheSize(): number {
    return this.cache.size
  }

  clearCache(): void {
    this.cache.clear()
    this.htmlCache.clear()
  }

  dispose(): void {
    this.cache.clear()
    this.htmlCache.clear()
    this.element?.remove()
    this.element = null
    this.htmlElement?.remove()
    this.htmlElement = null
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

  private estimateHtml(html: string, opts: TextMeasureHtmlOptions): TextHtmlMeasurement {
    const text = htmlToProbeText(html)
    const padding = paddingPx(opts.padding)
    const base = this.estimate(text, {
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      lineHeight: opts.lineHeight,
      ...(opts.fontWeight === undefined ? {} : { fontWeight: opts.fontWeight }),
      ...(opts.maxWidth === undefined || opts.maxWidth === null ? {} : { maxWidth: opts.maxWidth }),
      padding,
    })
    if (!opts.measureScrollWidth) return { ...base, scrollWidth: base.w }
    // The probe — and the label it stands for — wrap with `overflow-wrap:
    // break-word`, so a word longer than the line is broken rather than left
    // to overflow. Text therefore never exceeds the wrap width, and the DOM
    // path measured on a 80-character word agrees: `scrollWidth` stays at
    // `maxWidth` and the height grows.
    //
    // Unless the caller turned that off through `otherStyles`, which is the
    // one way to get a run that really cannot be broken.
    if (breaksWords(opts.otherStyles)) return { ...base, scrollWidth: base.w }
    const widestWord = longestUnbreakableRun(text)
    const unbreakable = this.estimate(widestWord, { fontFamily: opts.fontFamily, fontSize: opts.fontSize, lineHeight: opts.lineHeight, padding })
    return { ...base, scrollWidth: Math.max(base.w, unbreakable.w) }
  }

  private measureHtmlDom(html: string, opts: TextMeasureHtmlOptions): TextHtmlMeasurement {
    const el = this.getHtmlElement()
    const s = el.style
    s.fontFamily = opts.fontFamily
    s.fontSize = `${opts.fontSize}px`
    s.fontWeight = opts.fontWeight === undefined ? "normal" : String(opts.fontWeight)
    s.fontStyle = opts.fontStyle ?? "normal"
    s.lineHeight = String(opts.lineHeight)
    s.padding = typeof opts.padding === "number" ? `${opts.padding}px` : (opts.padding ?? "0px")
    s.maxWidth = opts.maxWidth === undefined || opts.maxWidth === null ? "none" : `${Math.max(1, opts.maxWidth)}px`
    // Clear the last call's styles first, so a probe reused with fewer of them is not measured with
    // them still on. One that overwrote a rule of the probe's own goes back to that rule: removing it
    // would leave the CSS initial value (`overflow-wrap: normal`) and change every later measurement.
    for (const name of readCustomStyleNames(el)) {
      const property = cssPropertyName(name)
      const base = PROBE_BASE_DECLARATIONS[property]
      if (base === undefined) s.removeProperty(property)
      else s.setProperty(property, base)
    }
    for (const [name, value] of Object.entries(opts.otherStyles ?? {})) s.setProperty(name, value)
    writeCustomStyleNames(el, Object.keys(opts.otherStyles ?? {}))
    el.innerHTML = html

    const rect = el.getBoundingClientRect()
    const padding = paddingPx(opts.padding)
    const lineHeightPx = opts.fontSize * opts.lineHeight
    const contentH = Math.max(0, rect.height - padding * 2)
    const lineCount = lineHeightPx > 0 ? Math.max(1, Math.round(contentH / lineHeightPx)) : 1
    // The property itself, with the wrap width still applied: an integer, never
    // below the client width, and above it only when something could not be
    // broken to fit. Re-measuring unwrapped instead — which is what this did
    // until 4.11.1 — reports the whole paragraph laid out on one line, so every
    // label that wraps reads as an overflow.
    const scrollWidth = opts.measureScrollWidth ? Math.max(rect.width, el.scrollWidth) : rect.width
    return {
      w: Math.ceil(rect.width * 100) / 100,
      h: Math.ceil(rect.height * 100) / 100,
      lineCount,
      scrollWidth: Math.ceil(scrollWidth * 100) / 100,
    }
  }

  private getHtmlElement(): HTMLDivElement {
    if (this.htmlElement && this.htmlElement.isConnected) return this.htmlElement
    installHtmlProbeStyles()
    const el = document.createElement("div")
    el.setAttribute("aria-hidden", "true")
    el.className = "mocanvas-text-measure-html"
    Object.assign(el.style, PROBE_BASE_STYLE)
    document.body.appendChild(el)
    this.htmlElement = el
    return el
  }

  private getElement(): HTMLDivElement {
    if (this.element && this.element.isConnected) return this.element
    const el = document.createElement("div")
    el.setAttribute("aria-hidden", "true")
    el.className = "mocanvas-text-measure"
    Object.assign(el.style, PROBE_BASE_STYLE)
    document.body.appendChild(el)
    this.element = el
    return el
  }
}

function cacheKey(text: string, o: TextMeasureOptions): string {
  return `${o.fontFamily}|${o.fontSize}|${o.fontWeight ?? ""}|${o.lineHeight}|${o.maxWidth ?? ""}|${o.padding ?? 0}|${text}`
}

function htmlCacheKey(html: string, o: TextMeasureHtmlOptions): string {
  const other = Object.entries(o.otherStyles ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${v}`)
    .join(";")
  return `${o.fontFamily}|${o.fontSize}|${o.fontWeight ?? ""}|${o.fontStyle ?? ""}|${o.lineHeight}|${o.maxWidth ?? ""}|${o.padding ?? 0}|${o.measureScrollWidth ? 1 : 0}|${other}|${html}`
}

/** Padding as a single number of px; a shorthand contributes its first value. */
function paddingPx(padding: number | string | undefined): number {
  if (typeof padding === "number") return Number.isFinite(padding) ? padding : 0
  if (typeof padding !== "string") return 0
  const first = padding.trim().split(/\s+/)[0] ?? ""
  const value = Number.parseFloat(first)
  return Number.isFinite(value) ? value : 0
}

/** Block-level tags whose boundaries read as a line break when HTML is flattened for the estimate. */
const BLOCK_TAG = /<\/?(?:p|div|li|ul|ol|h[1-6]|blockquote|pre|tr|br|hr)\b[^>]*>/gi

/** The text an HTML run lays out as, for the `document`-less estimate. */
function htmlToProbeText(html: string): string {
  return html
    .replace(BLOCK_TAG, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{2,}/g, "\n")
    .replace(/^\n|\n$/g, "")
}

/** Custom property names set on the probe by the previous call, so they can be cleared. */
function readCustomStyleNames(el: HTMLElement): string[] {
  const raw = el.dataset["mocanvasOtherStyles"]
  return raw === undefined || raw.length === 0 ? [] : raw.split(",")
}

function writeCustomStyleNames(el: HTMLElement, names: readonly string[]): void {
  if (names.length === 0) delete el.dataset["mocanvasOtherStyles"]
  else el.dataset["mocanvasOtherStyles"] = names.join(",")
}

let htmlProbeStylesInstalled = false

/**
 * Zero the browser's default block margins inside the HTML probe. A `<p>`'s
 * 1em margin would otherwise measure as extra height that the label — which
 * renders with the same rules — never has.
 */
function installHtmlProbeStyles(): void {
  if (htmlProbeStylesInstalled || typeof document === "undefined") return
  htmlProbeStylesInstalled = true
  const style = document.createElement("style")
  style.setAttribute("data-mocanvas", "text-measure")
  style.textContent = RICH_TEXT_BLOCK_CSS.replace(/__SCOPE__/g, ".mocanvas-text-measure-html")
  document.head.appendChild(style)
}

/**
 * The CSS a rich-text label lays out under, in both the measuring probe and the
 * DOM overlay. `__SCOPE__` is replaced with the selector of the container.
 *
 * Exported so the overlay renders under exactly the rules the measurer used —
 * one copy of the numbers, not two.
 */
export const RICH_TEXT_BLOCK_CSS = [
  "__SCOPE__ p,__SCOPE__ h1,__SCOPE__ h2,__SCOPE__ h3,__SCOPE__ h4,__SCOPE__ h5,__SCOPE__ h6,__SCOPE__ blockquote,__SCOPE__ pre,__SCOPE__ ul,__SCOPE__ ol{margin:0;padding:0;font-size:inherit;font-weight:inherit;line-height:inherit;}",
  "__SCOPE__ ul,__SCOPE__ ol{padding-inline-start:1.4em;}",
  "__SCOPE__ li{margin:0;}",
  "__SCOPE__ pre,__SCOPE__ code{font-family:inherit;white-space:pre-wrap;}",
  "__SCOPE__ hr{margin:0;border:0;border-top:1px solid currentColor;}",
  "__SCOPE__ a{color:inherit;}",
].join("")

let singleton: TextMeasure | null = null

/** The shared measurer. */
export function getTextMeasure(): TextMeasure {
  if (!singleton) singleton = new TextMeasure()
  return singleton
}
