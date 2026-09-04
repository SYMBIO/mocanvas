/**
 * The bridge between a rich-text document and the text measurer: HTML in, a box
 * out.
 *
 * `renderHtmlFromRichTextForMeasurement` produces the markup, and the measurer
 * installed through `registerTextMeasureImplementation` (see the "Installing
 * the editor's optional members" section of `docs/COMPAT.md`) turns it into a
 * size via `editor.textMeasure.measureHtml`. There is one measurer and one
 * probe element for both the plain and the rich path, so a rich-text label and
 * the plain-text label it flattens to never disagree about their size.
 */

import type { Editor } from "@mocanvas/editor"
import { richTextToHtml, type RichTextSource } from "./rich-text"
import { getTextMeasure, type TextHtmlMeasurement, type TextMeasureHtmlOptions } from "./TextMeasure"
import { tipTapDefaultExtensions, type RichTextExtension } from "./tiptap-extensions"

/** The editor members this module reads, none of which it requires to exist. */
interface EditorWithTextOptions {
  options?: { text?: { tipTapConfig?: { extensions?: readonly RichTextExtension[] } } }
  /** The pre-consolidation spelling; v5 moved `textOptions` under `options.text`. */
  textOptions?: { tipTapConfig?: { extensions?: readonly RichTextExtension[] } }
}

/**
 * The rich-text extension list an editor is configured with, or the default set.
 *
 * Reads both the v5 `options.text.tipTapConfig` location and the older
 * top-level `textOptions`, and tolerates an editor that carries neither — an
 * editor built before the text options landed still measures rich text.
 */
export function getRichTextExtensions(editor: Editor | null | undefined): readonly RichTextExtension[] {
  const host = editor as EditorWithTextOptions | null | undefined
  const configured = host?.options?.text?.tipTapConfig?.extensions ?? host?.textOptions?.tipTapConfig?.extensions
  return configured && configured.length > 0 ? configured : tipTapDefaultExtensions
}

/**
 * Render a rich-text value to the HTML the text measurer sizes.
 *
 * The markup is generated from the document JSON with the editor's configured
 * extensions: text is escaped, link hrefs are scheme-checked, and no whitespace
 * is emitted between tags (the probe lays out with `white-space: pre-wrap`,
 * where an indenting newline would measure as a space). A plain string is
 * accepted too and renders as the paragraphs it splits into, so a caller does
 * not have to know which of `props.richText` and `props.text` the store holds.
 *
 * The result is only meant for measurement and for mocanvas's own label
 * rendering. It is not a general-purpose export format — use
 * `richTextToSvg` for SVG.
 */
export function renderHtmlFromRichTextForMeasurement(editor: Editor | null | undefined, richText: RichTextSource): string {
  return richTextToHtml(richText, { extensions: getRichTextExtensions(editor) })
}

/**
 * Measure a rich-text value directly: render it, then hand it to the shared
 * measurer. The convenience form of the two calls above.
 */
export function measureRichText(editor: Editor | null | undefined, richText: RichTextSource, opts: TextMeasureHtmlOptions): TextHtmlMeasurement {
  return getTextMeasure().measureHtml(renderHtmlFromRichTextForMeasurement(editor, richText), opts)
}
