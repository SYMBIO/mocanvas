/**
 * The canonical rich-text document mocanvas stores in a shape's `richText`
 * prop, plus the pure conversions around it.
 *
 * The value is a ProseMirror/TipTap document: `{ type: "doc", content: [...] }`
 * where every node is `{ type, attrs?, content?, marks?, text? }`. That is the
 * shape TipTap's `editor.getJSON()` produces and `.tldr` files already carry
 * (see `src/__fixtures__/compare.tldr`), so a document written by mocanvas
 * loads in a TipTap editor and vice versa.
 *
 * Nothing in this module imports TipTap. The document is plain JSON, and every
 * thing mocanvas itself needs — store round trip, measurement, layout, the GPU
 * texture and SVG export — is derived from that JSON. TipTap is only needed to
 * *edit* rich text in a WYSIWYG surface, which is why it is an optional peer
 * dependency; see `tiptap-extensions.ts`.
 */

import { richTextToPlainText } from "@mocanvas/editor"
import { RICH_TEXT_MARKS, RICH_TEXT_NODES, type RichTextExtension, type RichTextMarkExtension, type RichTextNodeExtension } from "./tiptap-extensions"

/** A formatting mark on a text node: `{ type: "bold" }`, `{ type: "link", attrs: { href } }`. */
export interface RichTextMark {
  type: string
  attrs?: Record<string, unknown>
}

/** One node of a rich-text document. Text nodes carry `text`; everything else carries `content`. */
export interface RichTextNode {
  type: string
  attrs?: Record<string, unknown>
  content?: RichTextNode[]
  marks?: RichTextMark[]
  text?: string
}

/** A rich-text document — the value stored in a shape's `richText` prop. */
export interface RichText {
  type: "doc"
  content: RichTextNode[]
}

/**
 * Anything a label may be given: a rich-text document, a plain string, or
 * nothing. Every function in the text pipeline takes this, so the store is free
 * to hold either `props.richText` or `props.text`.
 */
export type RichTextSource = RichText | string | null | undefined

/**
 * Convert a plain string into a rich-text document.
 *
 * Each line becomes a paragraph; an empty line becomes a paragraph with no
 * content (`{ type: "paragraph" }`), which is exactly how the format spells an
 * empty label. `toRichText("")` is therefore a one-empty-paragraph document
 * rather than an empty one, so a shape created from it still has a caret line.
 */
export function toRichText(text: string): RichText {
  const source = typeof text === "string" ? text : ""
  return {
    type: "doc",
    content: source.split("\n").map((line) => (line.length === 0 ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] })),
  }
}

/** Whether `value` is a rich-text document rather than a string or junk. */
export function isRichText(value: unknown): value is RichText {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const doc = value as { type?: unknown; content?: unknown }
  return doc.type === "doc" && (doc.content === undefined || Array.isArray(doc.content))
}

/**
 * The plain string a label reads as, whatever it was given.
 *
 * Marks and unknown wrappers are flattened away; `hardBreak` becomes a newline
 * and top-level blocks are joined by newlines. Delegates to the editor's
 * `richTextToPlainText` so the load path and the render path agree character
 * for character.
 */
export function richTextToText(source: RichTextSource): string {
  if (source === null || source === undefined) return ""
  if (typeof source === "string") return source
  return richTextToPlainText(source)
}

/** The rich-text document form of any label source; a string is converted, a document passed through. */
export function asRichText(source: RichTextSource): RichText {
  if (isRichText(source)) return source
  return toRichText(typeof source === "string" ? source : "")
}

/** Structural equality of two documents, by value. */
export function richTextEquals(a: RichTextSource, b: RichTextSource): boolean {
  if (a === b) return true
  return JSON.stringify(asRichText(a)) === JSON.stringify(asRichText(b))
}

/**
 * Fold a plain-text edit back into a rich-text document.
 *
 * The plain-text editing surface (the `<textarea>` the DOM overlay falls back
 * to when no TipTap editor is installed) can only express text, not marks. When
 * the text did not actually change, the original document is returned unchanged
 * so opening and closing the editor never silently strips formatting. When it
 * did change, the document is rebuilt from the new text — the honest outcome for
 * an editor that cannot represent the marks it would have to preserve.
 *
 * SEMANTICS-ASSUMED: mocanvas owns this seam (it exists because TipTap is
 * optional here), so there is no upstream behaviour to match. "Keep formatting
 * on a no-op, drop it on a real plain-text edit" is the conservative choice: it
 * never loses formatting the user did not touch, and never claims to preserve
 * marks it cannot place.
 */
export function applyPlainTextToRichText(previous: RichTextSource, nextText: string): RichText {
  const doc = asRichText(previous)
  if (richTextToText(doc) === nextText) return doc
  return toRichText(nextText)
}

/* ---- HTML ---------------------------------------------------------------- */

export interface RichTextHtmlOptions {
  /**
   * The node and mark extensions the document is serialized with. Defaults to
   * {@link tipTapDefaultExtensions}; pass an app's own list to render nodes
   * mocanvas does not know about.
   */
  extensions?: readonly RichTextExtension[]
  /** Collects the node and mark types no extension covered, for warnings. */
  unknownTypes?: Set<string>
}

/** URL schemes a link mark may carry through to the rendered HTML. */
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/|\.{1,2}\/)/i

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }

/** Escape text for insertion into HTML/XML character data or an attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!)
}

interface ResolvedExtensions {
  nodes: Map<string, RichTextNodeExtension>
  marks: Map<string, RichTextMarkExtension>
}

function resolve(extensions: readonly RichTextExtension[] | undefined): ResolvedExtensions {
  const nodes = new Map<string, RichTextNodeExtension>()
  const marks = new Map<string, RichTextMarkExtension>()
  for (const extension of extensions ?? [...RICH_TEXT_NODES, ...RICH_TEXT_MARKS]) {
    const kind = (extension as { kind?: unknown }).kind
    if (kind === "node") nodes.set(extension.name, extension as RichTextNodeExtension)
    else if (kind === "mark") marks.set(extension.name, extension as RichTextMarkExtension)
    // Anything else (a real TipTap extension, say) describes no HTML mapping of
    // its own; the built-in table below still covers the standard node types.
  }
  if (nodes.size === 0) for (const node of RICH_TEXT_NODES) nodes.set(node.name, node)
  if (marks.size === 0) for (const mark of RICH_TEXT_MARKS) marks.set(mark.name, mark)
  return { nodes, marks }
}

/**
 * Serialize a rich-text document to HTML.
 *
 * The output is generated here from a known set of node and mark types — text
 * is escaped, link hrefs are scheme-checked — so it is safe to hand to
 * `innerHTML`. Unknown node types are recursed into rather than dropped, so
 * their text survives even when their formatting cannot.
 *
 * No whitespace is emitted between tags: the measuring probe renders the result
 * with `white-space: pre-wrap`, where an indenting newline would measure as a
 * space.
 */
export function richTextToHtml(source: RichTextSource, options: RichTextHtmlOptions = {}): string {
  const { nodes, marks } = resolve(options.extensions)
  const doc = asRichText(source)
  return (doc.content ?? []).map((node) => nodeToHtml(node, nodes, marks, options.unknownTypes)).join("")
}

function nodeToHtml(node: RichTextNode, nodes: ResolvedExtensions["nodes"], marks: ResolvedExtensions["marks"], unknown?: Set<string>): string {
  if (typeof node !== "object" || node === null) return ""
  if (node.type === "text") return textNodeToHtml(node, marks, unknown)

  const extension = nodes.get(node.type)
  if (!extension) {
    unknown?.add(node.type)
    // Keep the text: render the children with no wrapper of their own.
    return (node.content ?? []).map((child) => nodeToHtml(child, nodes, marks, unknown)).join("")
  }

  const tag = extension.tagFor ? extension.tagFor(node) : extension.tag
  if (extension.void) return tag === null ? "" : `<${tag}>`
  const inner = (node.content ?? []).map((child) => nodeToHtml(child, nodes, marks, unknown)).join("")
  if (tag === null) return inner
  // An empty block still occupies a line, exactly as the plain-text path does.
  return `<${tag}>${inner.length === 0 && extension.emptyHtml !== undefined ? extension.emptyHtml : inner}</${tag}>`
}

function textNodeToHtml(node: RichTextNode, marks: ResolvedExtensions["marks"], unknown?: Set<string>): string {
  let html = escapeHtml(node.text ?? "")
  // Innermost mark first, so the outermost mark in `marks` ends up outermost.
  for (const mark of node.marks ?? []) {
    const extension = marks.get(mark.type)
    if (!extension) {
      unknown?.add(mark.type)
      continue
    }
    const attributes = extension.attributesFor?.(mark) ?? null
    if (attributes === null && extension.attributesFor) continue
    const rendered = attributes === null ? "" : Object.entries(attributes).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join("")
    html = `<${extension.tag}${rendered}>${html}</${extension.tag}>`
  }
  return html
}

/** A link `href` that is safe to render, or `null` when the scheme is not allowed. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return SAFE_URL.test(trimmed) ? trimmed : null
}

/* ---- styled runs --------------------------------------------------------- */

/** The typographic effect of the marks on one run of text. */
export interface RichTextRunStyle {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  code: boolean
  /** The `href` of an enclosing link mark, when there is one. */
  href?: string
}

/** A run of text sharing one style — the unit the canvas raster and SVG export draw. */
export interface RichTextRun extends RichTextRunStyle {
  text: string
}

/** A block of the document flattened to styled runs. One block renders as one wrapped paragraph. */
export interface RichTextBlock {
  runs: RichTextRun[]
}

const PLAIN_STYLE: RichTextRunStyle = { bold: false, italic: false, underline: false, strike: false, code: false }

const BOLD_MARKS = new Set(["bold", "strong"])
const ITALIC_MARKS = new Set(["italic", "em"])
const UNDERLINE_MARKS = new Set(["underline"])
const STRIKE_MARKS = new Set(["strike", "strikethrough", "s", "del"])
const CODE_MARKS = new Set(["code"])

function styleOf(marks: readonly RichTextMark[] | undefined): RichTextRunStyle {
  const style: RichTextRunStyle = { ...PLAIN_STYLE }
  for (const mark of marks ?? []) {
    if (BOLD_MARKS.has(mark.type)) style.bold = true
    else if (ITALIC_MARKS.has(mark.type)) style.italic = true
    else if (UNDERLINE_MARKS.has(mark.type)) style.underline = true
    else if (STRIKE_MARKS.has(mark.type)) style.strike = true
    else if (CODE_MARKS.has(mark.type)) style.code = true
    else if (mark.type === "link") {
      const href = safeHref(mark.attrs?.["href"])
      if (href !== null) style.href = href
    }
  }
  return style
}

/**
 * Flatten a document to the blocks the renderers draw: one block per top-level
 * block node (a paragraph, a heading, a list item), each a list of styled runs.
 *
 * A `hardBreak` starts a new block, so blocks and the lines of
 * {@link richTextToText} line up one for one.
 */
export function richTextToBlocks(source: RichTextSource): RichTextBlock[] {
  if (typeof source === "string") return source.split("\n").map((text) => ({ runs: text.length === 0 ? [] : [{ text, ...PLAIN_STYLE }] }))
  const doc = asRichText(source)
  const blocks: RichTextBlock[] = []
  for (const node of doc.content ?? []) collectBlocks(node, blocks)
  if (blocks.length === 0) blocks.push({ runs: [] })
  return blocks
}

function collectBlocks(node: RichTextNode, out: RichTextBlock[]): void {
  if (typeof node !== "object" || node === null) return
  if (node.type === "text" || node.type === "hardBreak") {
    // A bare text node at block level (or a break) belongs to the block in progress.
    appendInline(node, out)
    return
  }
  const children = node.content ?? []
  if (children.some((child) => isBlockNode(child))) {
    for (const child of children) collectBlocks(child, out)
    return
  }
  out.push({ runs: [] })
  for (const child of children) appendInline(child, out)
}

const BLOCK_NODE_TYPES = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "horizontalRule", "taskList", "taskItem", "table", "tableRow", "tableCell", "tableHeader"])

function isBlockNode(node: RichTextNode): boolean {
  if (typeof node !== "object" || node === null) return false
  if (node.type === "text" || node.type === "hardBreak") return false
  // Marks only ever apply to inline content, so a marked wrapper is inline
  // whatever its type — its runs inherit the mark rather than starting a block.
  if (Array.isArray(node.marks) && node.marks.length > 0) return false
  return BLOCK_NODE_TYPES.has(node.type) || Array.isArray(node.content)
}

function appendInline(node: RichTextNode, out: RichTextBlock[], inherited?: RichTextRunStyle): void {
  if (typeof node !== "object" || node === null) return
  if (out.length === 0) out.push({ runs: [] })
  if (node.type === "hardBreak") {
    out.push({ runs: [] })
    return
  }
  const style = mergeStyle(inherited, styleOf(node.marks))
  if (node.type === "text") {
    const text = node.text ?? ""
    if (text.length > 0) out[out.length - 1]!.runs.push({ text, ...style })
    return
  }
  for (const child of node.content ?? []) appendInline(child, out, style)
}

function mergeStyle(base: RichTextRunStyle | undefined, next: RichTextRunStyle): RichTextRunStyle {
  if (!base) return next
  return {
    bold: base.bold || next.bold,
    italic: base.italic || next.italic,
    underline: base.underline || next.underline,
    strike: base.strike || next.strike,
    code: base.code || next.code,
    ...(next.href ?? base.href ? { href: next.href ?? base.href } : {}),
  }
}
