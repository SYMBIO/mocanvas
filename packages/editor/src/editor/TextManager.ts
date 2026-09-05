import type { BoxLike } from "../geometry"
import { EditorManager } from "./EditorManager"
import type {
  EditorTextHtmlMeasurement,
  EditorTextMeasureHtmlOptions,
  EditorTextMeasureOptions,
} from "./Editor"

/**
 * How a run of text should be laid out before it is measured.
 *
 * Mirrors the CSS the canvas will eventually paint with, because a measurement
 * that does not match the paint is worse than no measurement at all.
 */
export interface TLMeasureTextOpts extends EditorTextMeasureOptions {
  /** Never report a width below this, whatever the text measures. */
  minWidth?: number
}

/** What a measurement comes back as. */
export interface TLMeasuredTextSize {
  w: number
  h: number
  /** The width the text would take if it were never wrapped. */
  scrollWidth: number
}

/** One entry in a {@link TextManager.measureHtmlBatch} call. */
export interface BatchMeasurementRequest {
  html: string
  opts: EditorTextMeasureHtmlOptions
}

/**
 * Options for splitting text into positioned spans.
 *
 * Unlike {@link TLMeasureTextOpts} the box is given, not derived: spans are
 * laid out inside a shape whose size is already decided, and `overflow` says
 * what happens to text that does not fit.
 */
export interface TLMeasureTextSpanOpts extends TLMeasureTextOpts {
  /** Content width the text wraps inside, in page units. */
  width: number
  /** Content height available. Only consulted when `overflow` is `"truncate"`. */
  height: number
  /** Horizontal placement of each line inside `width`. */
  textAlign?: "start" | "middle" | "end"
  /** Vertical placement of the block inside `height`. */
  verticalTextAlign?: "start" | "middle" | "end"
  /** What to do with text that overflows `height`. Defaults to `"wrap"`. */
  overflow?: "wrap" | "truncate"
}

/** One laid-out run of text, positioned relative to the text block's origin. */
export interface TLTextSpan {
  box: BoxLike
  text: string
}

/**
 * Text measurement, as the editor's own manager.
 *
 * Measuring text needs a DOM — a font has to be resolved, applied and laid out
 * before anything can say how wide a word is — and the DOM lives in the
 * flagship package, not here. So this manager does not measure: it *routes*,
 * to whatever `registerTextMeasureImplementation` installed, reachable as
 * {@link Editor.textMeasure}. Everything it adds on top (span layout, wrapping,
 * truncation) is arithmetic over that one primitive, so a host with an unusual
 * measurer only implements the primitive and gets the rest.
 *
 * Reach it as `editor.text`.
 */
export class TextManager extends EditorManager {
  /** Measure one run of text. */
  measureText(text: string, opts: TLMeasureTextOpts): TLMeasuredTextSize {
    const measured = this.editor.textMeasure.measureText(text, opts)
    const unwrapped = this.editor.textMeasure.measureText(text, { ...opts, maxWidth: null })
    return {
      w: Math.max(measured.w, opts.minWidth ?? 0),
      h: measured.h,
      scrollWidth: unwrapped.w,
    }
  }

  /** Measure one block of rich text, as a label is laid out. */
  measureHtml(html: string, opts: EditorTextMeasureHtmlOptions): EditorTextHtmlMeasurement {
    return this.editor.textMeasure.measureHtml(html, opts)
  }

  /**
   * Measure many blocks in one layout pass.
   *
   * The point is the *one* pass: measuring N labels one at a time forces N
   * reflows, which is what makes a page of sticky notes slow to open.
   */
  measureHtmlBatch(items: readonly BatchMeasurementRequest[]): EditorTextHtmlMeasurement[] {
    return this.editor.textMeasure.measureHtmlBatch(items)
  }

  /**
   * Lay `text` out inside a box and report where each run of it lands.
   *
   * Word-wrapping is greedy: words are added to a line until the next one would
   * not fit, and a single word wider than the box gets a line of its own rather
   * than being broken mid-word.
   *
   * SEMANTICS-ASSUMED: a span is one line. The docs do not say whether a line is
   * one span or several (per word, per style run); one span per line is what
   * the positions are *for* — placing a caret, drawing a selection rectangle,
   * exporting `<tspan>`s — and a caller wanting words can split a line's text
   * without re-measuring.
   */
  measureTextSpans(text: string, opts: TLMeasureTextSpanOpts): TLTextSpan[] {
    const lineHeightPx = opts.fontSize * opts.lineHeight
    const lines = this.wrap(text, opts)

    const overflow = opts.overflow ?? "wrap"
    const visible =
      overflow === "truncate" && opts.height > 0
        ? lines.slice(0, Math.max(1, Math.floor(opts.height / lineHeightPx)))
        : lines

    const blockHeight = visible.length * lineHeightPx
    const top =
      opts.verticalTextAlign === "middle"
        ? (opts.height - blockHeight) / 2
        : opts.verticalTextAlign === "end"
          ? opts.height - blockHeight
          : 0

    return visible.map((line, i) => {
      const w = line === "" ? 0 : this.editor.textMeasure.measureText(line, { ...opts, maxWidth: null }).w
      const x =
        opts.textAlign === "middle"
          ? (opts.width - w) / 2
          : opts.textAlign === "end"
            ? opts.width - w
            : 0
      return { box: { x, y: top + i * lineHeightPx, w, h: lineHeightPx }, text: line }
    })
  }

  /**
   * The same spans, but for text already in the DOM.
   *
   * Where {@link measureTextSpans} predicts a layout, this one reads the layout
   * the browser actually performed — which is what an exporter needs, because
   * the browser's line breaking is the ground truth for what the user saw.
   * Uses `Range` rectangles over the element's text nodes, grouped into lines by
   * their vertical position.
   *
   * Returns an empty list where there is no DOM at all (node, SSR).
   */
  measureElementTextNodeSpans(
    element: Element,
    opts: { padding?: number } = {},
  ): { spans: TLTextSpan[]; didTruncate: boolean } {
    const doc = this.editor.getContainerDocument()
    const win = this.editor.getContainerWindow()
    if (!doc || !win || typeof (win as { document?: unknown }).document === "undefined") {
      return { spans: [], didTruncate: false }
    }
    const makeRange = (doc as unknown as { createRange?: () => Range }).createRange
    if (typeof makeRange !== "function") return { spans: [], didTruncate: false }

    const padding = opts.padding ?? 0
    const origin = element.getBoundingClientRect()
    const spans: TLTextSpan[] = []
    const lines = new Map<number, { box: BoxLike; text: string }>()

    for (const node of textNodesOf(element)) {
      const value = node.nodeValue ?? ""
      for (let i = 0; i < value.length; i++) {
        const range = makeRange.call(doc)
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        // Round the line's top so sub-pixel differences inside one line — a
        // taller glyph, a superscript — do not split it into two.
        const key = Math.round(rect.top)
        const existing = lines.get(key)
        const x = rect.left - origin.left + padding
        const y = rect.top - origin.top + padding
        if (existing) {
          const right = Math.max(existing.box.x + existing.box.w, x + rect.width)
          existing.box.w = right - existing.box.x
          existing.box.h = Math.max(existing.box.h, rect.height)
          existing.text += value[i]
        } else {
          lines.set(key, { box: { x, y, w: rect.width, h: rect.height }, text: value[i]! })
        }
      }
    }

    for (const line of [...lines.entries()].sort((a, b) => a[0] - b[0])) spans.push(line[1])

    const didTruncate = element.scrollHeight > element.clientHeight + 1
    return { spans, didTruncate }
  }

  /** Greedy word wrap against the measurer. */
  private wrap(text: string, opts: TLMeasureTextSpanOpts): string[] {
    const out: string[] = []
    const widthOf = (s: string): number =>
      s === "" ? 0 : this.editor.textMeasure.measureText(s, { ...opts, maxWidth: null }).w

    for (const paragraph of text.split("\n")) {
      if (paragraph === "") {
        out.push("")
        continue
      }
      let line = ""
      for (const word of paragraph.split(/(\s+)/)) {
        if (word === "") continue
        const candidate = line + word
        if (line !== "" && widthOf(candidate) > opts.width) {
          out.push(line.trimEnd())
          line = word.trimStart()
        } else {
          line = candidate
        }
      }
      out.push(line.trimEnd())
    }
    return out
  }
}

/** Every text node under `element`, in document order. */
function textNodesOf(element: Element): Text[] {
  const out: Text[] = []
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      out.push(node as Text)
      return
    }
    for (const child of Array.from(node.childNodes)) visit(child)
  }
  visit(element)
  return out
}
