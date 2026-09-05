/**
 * Rich text in and out of the two formats the world outside the canvas speaks:
 * HTML and plain text.
 *
 * The canonical form is always the ProseMirror document in `props.richText`
 * (see `rich-text.ts`). These three functions are the boundary: they take an
 * `editor` first because the conversion depends on the editor's configured
 * extension set — an app that registered a node type mocanvas has never heard
 * of should get that node rendered, not dropped.
 */

import type { Editor } from "@mocanvas/editor"
import { getRichTextExtensions } from "./measure-html"
import { asRichText, richTextToHtml, richTextToText, type RichText, type RichTextMark, type RichTextNode, type RichTextSource } from "./rich-text"

/**
 * A rich-text document as HTML.
 *
 * Safe to hand to `innerHTML`: text is escaped and link hrefs are
 * scheme-checked on the way out. Useful for rendering a label outside the
 * canvas, and for exporting a document to somewhere that speaks HTML.
 */
export function renderHtmlFromRichText(editor: Editor, richText: RichTextSource): string {
  return richTextToHtml(richText, { extensions: getRichTextExtensions(editor) })
}

/**
 * A rich-text document as plain text.
 *
 * Formatting is dropped, structure is not: a hard break and a block boundary
 * both become a newline, so the result has the same number of lines the label
 * shows.
 */
export function renderPlaintextFromRichText(_editor: Editor, richText: RichTextSource): string {
  return richTextToText(richText)
}

/* ---- HTML → rich text ----------------------------------------------------- */

const MARK_BY_TAG: Readonly<Record<string, string>> = {
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  u: "underline",
  s: "strike",
  strike: "strike",
  del: "strike",
  code: "code",
  mark: "highlight",
}

const BLOCK_BY_TAG: Readonly<Record<string, string>> = {
  p: "paragraph",
  div: "paragraph",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  ul: "bulletList",
  ol: "orderedList",
  li: "listItem",
  blockquote: "blockquote",
  pre: "codeBlock",
}

const SAFE_HREF = /^(?:https?:|mailto:|tel:|#|\/|\.{1,2}\/)/i

/**
 * Parse HTML into a rich-text document.
 *
 * The inverse of {@link renderHtmlFromRichText}, and the path a paste from a
 * browser or a word processor takes. Unknown elements are *descended into*
 * rather than dropped, so text inside a `<section>` or a `<font>` survives even
 * though the wrapper does not; unknown attributes are ignored entirely, which
 * is what keeps a paste from carrying a stylesheet onto the canvas.
 *
 * Returns a one-empty-paragraph document when there is nothing to parse, so the
 * result is always a valid document with a caret line.
 */
export function renderRichTextFromHTML(_editor: Editor, html: string): RichText {
  if (typeof DOMParser === "undefined") {
    // Without a parser the honest reading of arbitrary HTML is "text I cannot
    // interpret". Stripping tags with a regex would be worse than useless: it
    // would silently mangle content that has any angle bracket in it.
    return asRichText("")
  }

  const document_ = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")
  const blocks: RichTextNode[] = []
  walkBlocks(document_.body, blocks, [])
  const nonEmpty = blocks.filter((block) => block.content?.length || block.type === "paragraph")
  if (nonEmpty.length === 0) return asRichText("")
  return { type: "doc", content: nonEmpty }
}

/** Collect block-level nodes out of `element`, in document order. */
function walkBlocks(element: Node, out: RichTextNode[], marks: RichTextMark[]): void {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3 /* text */) {
      const text = child.nodeValue ?? ""
      if (!text.trim()) continue
      appendInline(currentParagraph(out), text, marks)
      continue
    }
    if (child.nodeType !== 1 /* element */) continue

    const el = child as Element
    const tag = el.tagName.toLowerCase()
    if (tag === "br") {
      currentParagraph(out).content?.push({ type: "hardBreak" })
      continue
    }
    if (tag === "hr") {
      out.push({ type: "horizontalRule" })
      continue
    }

    const mark = markFor(tag, el)
    if (mark) {
      walkBlocks(el, out, [...marks, mark])
      continue
    }

    const block = BLOCK_BY_TAG[tag]
    if (block) {
      const node: RichTextNode = { type: block, content: [] }
      if (block === "heading") node.attrs = { level: Number(tag.slice(1)) || 1 }
      const inner: RichTextNode[] = []
      walkBlocks(el, inner, marks)
      // A list wraps other blocks; everything else holds inline content, which
      // the recursion has already collected into paragraphs of its own.
      if (block === "bulletList" || block === "orderedList") node.content = inner
      else node.content = inner.flatMap((child_) => child_.content ?? [])
      out.push(node)
      continue
    }

    // An element we have no node type for: keep its text, lose its wrapper.
    walkBlocks(el, out, marks)
  }
}

/** The paragraph in progress, starting one when there is none. */
function currentParagraph(out: RichTextNode[]): RichTextNode {
  const last = out[out.length - 1]
  if (last && last.content && last.type !== "bulletList" && last.type !== "orderedList") return last
  const paragraph: RichTextNode = { type: "paragraph", content: [] }
  out.push(paragraph)
  return paragraph
}

function appendInline(node: RichTextNode, text: string, marks: RichTextMark[]): void {
  node.content ??= []
  node.content.push(marks.length > 0 ? { type: "text", text, marks } : { type: "text", text })
}

/** The mark an inline tag contributes, or `null` when it is not one. */
function markFor(tag: string, element: Element): RichTextMark | null {
  if (tag === "a") {
    const href = element.getAttribute("href")?.trim()
    // A link whose scheme could execute contributes no mark, and so falls
    // through to the unknown-element branch: its text survives, its link does
    // not.
    if (!href || !SAFE_HREF.test(href)) return null
    return { type: "link", attrs: { href } }
  }
  const mark = MARK_BY_TAG[tag]
  return mark ? { type: mark } : null
}
