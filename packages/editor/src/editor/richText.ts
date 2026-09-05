/**
 * Rich text as the editor sees it: a document tree it does not own.
 *
 * The tree is TipTap's / ProseMirror's, and the editor deliberately keeps it at
 * arm's length. It walks the tree for two things only — the text, and the fonts
 * the text needs — and carries the rest to whatever rich-text implementation an
 * app installed. Typing the nodes properly here would make this package depend
 * on a text stack it does not ship, and would break the moment an app added an
 * extension of its own.
 */
import { T } from "../validation/T"
import type { Validator } from "../validation/validator"
import type { TLFontFace, TLTheme } from "../theme/types"

/**
 * One node of a rich-text document.
 *
 * Structural and open: `type` is the only field anything here relies on, and
 * everything else is whatever the installed extensions put there.
 */
export interface TiptapNode {
  type?: string
  text?: string
  content?: TiptapNode[]
  marks?: { type?: string; attrs?: Record<string, unknown> }[]
  attrs?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * A live rich-text editing session, as the host's text stack exposes it.
 *
 * Deliberately opaque: `Editor.getRichTextEditor()` hands this straight back to
 * the app that installed the stack, and the canvas never calls into it. Typing
 * it as TipTap's `Editor` would be a lie in an app that installed something
 * else.
 */
export type TiptapEditor = unknown

/**
 * Validates a rich-text document.
 *
 * Only the envelope is checked — a `doc` node with a content array — because
 * the node types inside it are contributed by extensions the store knows
 * nothing about. Validating them here would reject any app that added its own,
 * which is the opposite of what a validator is for. The envelope is still worth
 * checking: it is what tells a `richText` prop from a plain string during a
 * migration.
 */
export const richTextValidator: Validator<{ type: "doc"; content: unknown[] }> = T.object({
  type: T.literal("doc"),
  content: T.arrayOf(T.unknown),
}) as unknown as Validator<{ type: "doc"; content: unknown[] }>

/**
 * The font a piece of text is currently in, as the walk carries it down the
 * tree.
 *
 * Threaded rather than recomputed because formatting nests: a bold run inside
 * an italic paragraph needs both, and the only place that is known is on the
 * way down.
 */
export interface RichTextFontVisitorState {
  /** The CSS family in force, e.g. `tldraw_draw`. */
  family: string
  /** The weight in force, as a CSS `font-weight` value. */
  weight: string
  /** The style in force, as a CSS `font-style` value. */
  style: string
}

/**
 * Called for each node while collecting fonts.
 *
 * Call `addFont` for every face the node needs, and return the state its
 * children should inherit. Returning the state unchanged is the common case —
 * most nodes are structural and change no formatting.
 */
export type RichTextFontVisitor = (
  node: TiptapNode,
  state: RichTextFontVisitorState,
  addFont: (font: TLFontFace) => void,
) => RichTextFontVisitorState

/** What {@link getFontsFromRichText} needs of an editor. Structural, so this module stays small. */
export interface TLRichTextFontSource {
  getCurrentTheme(): TLTheme
  readonly textOptions?: { addFontsFromNode?: RichTextFontVisitor } | undefined
}

/**
 * Every font face a rich-text document needs, in first-seen order.
 *
 * Fonts have to be loaded *before* the text is painted, or the shape is
 * measured against a fallback and then reflows when the real face arrives —
 * which on a canvas means every shape below it moves. So the document is walked
 * ahead of render, and this is that walk.
 *
 * `initialState` is the base font, from the shape's own `font` and `size`
 * props; marks on the way down override it. An app that has added its own
 * formatting marks supplies a visitor through `options.text.addFontsFromNode`
 * and wraps {@link defaultAddFontsFromNode} to keep the built-in behaviour.
 */
export function getFontsFromRichText(
  editor: TLRichTextFontSource,
  richText: TiptapNode | null | undefined,
  initialState: RichTextFontVisitorState,
): TLFontFace[] {
  if (!richText) return []
  const theme = editor.getCurrentTheme()
  const visitor = editor.textOptions?.addFontsFromNode ?? defaultAddFontsFromNode

  const faces: TLFontFace[] = []
  const seen = new Set<string>()
  const addFont = (font: TLFontFace): void => {
    const key = `${font.family} ${String(font.src)} ${font.weight ?? ""} ${font.style ?? ""}`
    if (seen.has(key)) return
    seen.add(key)
    faces.push(font)
  }

  const visit = (node: TiptapNode, state: RichTextFontVisitorState): void => {
    const next = visitor(node, state, addFont)
    // The face for the state itself, so a run of plain text in the theme's
    // chosen family still asks for that family's face.
    addThemeFace(theme, next, addFont)
    for (const child of node.content ?? []) visit(child, next)
  }

  visit(richText, initialState)
  return faces
}

/**
 * The built-in font visitor: bold and italic marks change the weight and style,
 * a code mark switches to the monospace family.
 *
 * Exported so an app's own visitor can delegate to it rather than
 * reimplementing the three cases every rich-text document has.
 */
export function defaultAddFontsFromNode(
  node: TiptapNode,
  state: RichTextFontVisitorState,
  _addFont: (font: TLFontFace) => void,
): RichTextFontVisitorState {
  let next = state
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        next = { ...next, weight: "bold" }
        break
      case "italic":
        next = { ...next, style: "italic" }
        break
      case "code":
        next = { ...next, family: "tldraw_mono" }
        break
      default:
        break
    }
  }
  return next
}

/** Ask the theme for the face matching a font state, if it names one. */
function addThemeFace(theme: TLTheme, state: RichTextFontVisitorState, addFont: (font: TLFontFace) => void): void {
  const entry = (theme.fonts as Record<string, unknown>)[state.family]
  if (!entry || typeof entry === "string") return
  const faces = (entry as { faces?: readonly TLFontFace[] }).faces
  if (!faces) return
  for (const face of faces) {
    if (face.weight !== undefined && face.weight !== state.weight) continue
    if (face.style !== undefined && face.style !== state.style) continue
    addFont(face)
  }
}

/**
 * A line height in page units, from whatever the theme or a shape gave.
 *
 * Line height is the one text metric that is written two ways: as a unitless
 * multiplier (`1.4`, meaning "of the font size") and as an absolute length
 * (`"22px"`). Both are legal CSS and both turn up in themes and in pasted
 * content, and measuring text against the wrong reading is off by a factor of
 * the font size — which is not a subtle bug, but is a silent one.
 *
 * SEMANTICS-ASSUMED: a bare number, or a number-valued string with no unit, is
 * a multiplier; `px` is absolute; `em` and `%` are relative to the font size.
 * That is CSS's own rule for `line-height`, which is where every one of these
 * values came from.
 */
export function resolveLineHeightPx(lineHeight: number | string | undefined, fontSizePx: number): number {
  if (lineHeight === undefined) return fontSizePx
  if (typeof lineHeight === "number") return lineHeight * fontSizePx

  const trimmed = lineHeight.trim()
  const value = Number.parseFloat(trimmed)
  if (!Number.isFinite(value)) return fontSizePx
  if (trimmed.endsWith("px")) return value
  if (trimmed.endsWith("em")) return value * fontSizePx
  if (trimmed.endsWith("%")) return (value / 100) * fontSizePx
  return value * fontSizePx
}
