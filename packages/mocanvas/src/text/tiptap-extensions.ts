/**
 * The default rich-text schema, and the seam an app uses to bring its own
 * TipTap along.
 *
 * ## Why TipTap is optional here
 *
 * `tipTapDefaultExtensions` is the list a host passes to
 * `textOptions.tipTapConfig.extensions`. It describes the node and mark types a
 * mocanvas label understands, and everything mocanvas does with rich text —
 * measure it, lay it out, rasterize it, export it to SVG, round-trip it through
 * a `.tldr` file — is derived from the document JSON, not from a live editor.
 * So the default list carries *descriptions* of those types and pulls in no
 * dependency at all.
 *
 * TipTap and ProseMirror are only needed to *edit* rich text in a WYSIWYG
 * surface. They are therefore declared as **optional peer dependencies**:
 *
 * - ProseMirror schemas are instance-identity sensitive. An app that already
 *   ships TipTap (the way `@molekula/editor` does) and a bundled copy inside
 *   mocanvas would be two ProseMirror instances in one page, which breaks in
 *   ways that are hard to diagnose. A peer dependency forces the single copy.
 * - A consumer that only wants plain-text labels should not pay several hundred
 *   kilobytes for an editor it never opens.
 *
 * When TipTap is absent the DOM overlay falls back to a plain `<textarea>` over
 * the text projection of the document (see `TextEditor.tsx`); marks the user did
 * not touch survive, marks they edit through do not. When it is present, an app
 * installs its own editor factory through {@link registerRichTextEditorFactory}
 * and gets the full surface.
 */

import type { RichTextMark, RichTextNode } from "./rich-text"

/**
 * The minimum an entry of the extension list has to be.
 *
 * A real TipTap `Node`, `Mark` or `Extension` instance satisfies this, so
 * `[...tipTapDefaultExtensions, MyTipTapExtension]` is well typed and an app can
 * extend the default set without mocanvas depending on TipTap's types.
 */
export interface RichTextExtension {
  readonly name: string
}

/** A node type mocanvas knows how to render, measure and export. */
export interface RichTextNodeExtension extends RichTextExtension {
  readonly kind: "node"
  /** HTML tag the node serializes to. `null` renders the children with no wrapper. */
  readonly tag: string | null
  /** Void nodes (`<br>`, `<hr>`) render no children and no closing tag. */
  readonly void?: boolean
  /** Per-node tag, for a type whose tag depends on its attrs (a heading's level). */
  readonly tagFor?: (node: RichTextNode) => string | null
  /** Rendered inside the tag when the node has no content, so an empty block still occupies a line. */
  readonly emptyHtml?: string
}

/** A formatting mark mocanvas knows how to render, measure and export. */
export interface RichTextMarkExtension extends RichTextExtension {
  readonly kind: "mark"
  readonly tag: string
  /** Attributes for the rendered tag, or `null` to drop the mark (an unsafe `href`, say). */
  readonly attributesFor?: (mark: RichTextMark) => Record<string, string> | null
}

/** Keeps an empty paragraph one line tall in a measuring probe and in the static label. */
const ZERO_WIDTH_SPACE = "​"

function level(node: RichTextNode): number {
  const value = node.attrs?.["level"]
  return typeof value === "number" && value >= 1 && value <= 6 ? Math.floor(value) : 1
}

/** The block and inline node types a mocanvas label understands out of the box. */
export const RICH_TEXT_NODES: readonly RichTextNodeExtension[] = [
  { name: "paragraph", kind: "node", tag: "p", emptyHtml: ZERO_WIDTH_SPACE },
  { name: "heading", kind: "node", tag: "h1", tagFor: (node) => `h${level(node)}`, emptyHtml: ZERO_WIDTH_SPACE },
  { name: "bulletList", kind: "node", tag: "ul" },
  { name: "orderedList", kind: "node", tag: "ol" },
  { name: "listItem", kind: "node", tag: "li", emptyHtml: ZERO_WIDTH_SPACE },
  { name: "blockquote", kind: "node", tag: "blockquote" },
  { name: "codeBlock", kind: "node", tag: "pre" },
  { name: "hardBreak", kind: "node", tag: "br", void: true },
  { name: "horizontalRule", kind: "node", tag: "hr", void: true },
]

/** The formatting marks a mocanvas label understands out of the box. */
export const RICH_TEXT_MARKS: readonly RichTextMarkExtension[] = [
  { name: "bold", kind: "mark", tag: "strong" },
  { name: "italic", kind: "mark", tag: "em" },
  { name: "underline", kind: "mark", tag: "u" },
  { name: "strike", kind: "mark", tag: "s" },
  { name: "code", kind: "mark", tag: "code" },
  { name: "highlight", kind: "mark", tag: "mark" },
  {
    name: "link",
    kind: "mark",
    tag: "a",
    attributesFor: (mark) => {
      const href = mark.attrs?.["href"]
      if (typeof href !== "string") return null
      const trimmed = href.trim()
      // Only schemes that cannot execute script; anything else drops the mark
      // and keeps the text.
      return /^(?:https?:|mailto:|tel:|#|\/|\.{1,2}\/)/i.test(trimmed) ? { href: trimmed, rel: "noopener noreferrer" } : null
    },
  },
]

/**
 * The default extension set the canvas text editor uses.
 *
 * Pass it to the editor as `textOptions: { tipTapConfig: { extensions:
 * tipTapDefaultExtensions } }`, or spread it to add your own:
 * `[...tipTapDefaultExtensions, MyExtension]`.
 *
 * Every entry describes one node or mark type. mocanvas reads the descriptions
 * when it serializes a document for measurement, rasterizes a label or writes
 * SVG. Real TipTap extension instances may be appended to the list; they are
 * handed to the editor factory an app registers with
 * {@link registerRichTextEditorFactory} and ignored by the description-driven
 * paths, which fall back to the built-in table for the standard types.
 */
export const tipTapDefaultExtensions: readonly RichTextExtension[] = [...RICH_TEXT_NODES, ...RICH_TEXT_MARKS]

/* ---- the optional live-editor seam --------------------------------------- */

/** What mocanvas hands a rich-text editor when the user starts editing a label. */
export interface RichTextEditorMountOptions {
  /** The element the editor should mount into. */
  container: HTMLElement
  /** The document to start from. */
  initialValue: RichTextNode & { type: "doc" }
  /** The extension list configured on the editor. */
  extensions: readonly RichTextExtension[]
  /** Whether typing should be constrained to one line (a frame's name). */
  singleLine: boolean
  /** Called with the new document as the user types. */
  onChange(value: RichTextNode & { type: "doc" }): void
  /** Called when the editor wants editing to stop (Escape, Enter on a single-line label). */
  onFinish(): void
}

/** A mounted rich-text editor. `destroy` must remove everything the factory added. */
export interface RichTextEditorHandle {
  focus(): void
  destroy(): void
}

/** Creates a rich-text editing surface — a TipTap editor, in practice. */
export type RichTextEditorFactory = (options: RichTextEditorMountOptions) => RichTextEditorHandle

let editorFactory: RichTextEditorFactory | null = null

/**
 * Install the WYSIWYG editing surface used when a label is being edited.
 *
 * An app that already depends on TipTap registers a factory that builds a
 * TipTap editor from `options.extensions`; without one, mocanvas edits labels
 * with a plain `<textarea>` over the text projection of the document. Returns a
 * function that removes the factory again (only if it is still the registered
 * one), so tests can install and undo one.
 */
export function registerRichTextEditorFactory(factory: RichTextEditorFactory | null): () => void {
  editorFactory = factory
  return () => {
    if (editorFactory === factory) editorFactory = null
  }
}

/** The registered rich-text editor factory, or `null` when labels edit as plain text. */
export function getRichTextEditorFactory(): RichTextEditorFactory | null {
  return editorFactory
}

/**
 * Load TipTap's own starter extensions, for an app that has the optional peer
 * dependency installed and wants the standard set rather than mocanvas's
 * descriptions.
 *
 * Rejects with an actionable message when the peer is missing. The import is
 * dynamic and built from a variable so a bundler does not try to resolve it at
 * build time in an app that never calls this.
 */
export async function loadTipTapStarterExtensions(): Promise<readonly RichTextExtension[]> {
  const moduleId = "@tiptap/starter-kit"
  let loaded: unknown
  try {
    loaded = await import(/* @vite-ignore */ /* webpackIgnore: true */ moduleId)
  } catch (cause) {
    throw new Error("mocanvas: `@tiptap/starter-kit` is an optional peer dependency and is not installed. Run `npm install @tiptap/starter-kit@^3 @tiptap/core@^3 @tiptap/pm@^3`, or use `tipTapDefaultExtensions` instead.", { cause })
  }
  const starterKit = (loaded as { default?: unknown }).default ?? loaded
  return [starterKit as RichTextExtension]
}
