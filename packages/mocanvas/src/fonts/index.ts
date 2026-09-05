/**
 * The typefaces the built-in shapes draw with, and the two seams around them:
 * loading one into a document, and deciding which faces a rich-text document
 * needs.
 *
 * The face *table* lives in the editor package (`DefaultFontFaces`), because
 * the canvas has to measure text with or without the flagship. What lives here
 * is what the flagship adds on top: the flattened list a preloader iterates,
 * the loader itself, and the default rich-text font visitor.
 *
 * mocanvas ships no font files. Every built-in face names a family already on
 * the machine, so a board renders identically with nothing loaded; an app that
 * wants real webfonts registers its own {@link TLTypeFace}s through
 * {@link preloadFont} and replaces the theme's stacks.
 */

import { DefaultFontFaces, type TLFontFace } from "@mocanvas/editor"

/**
 * The four faces of one family: upright and italic, each normal and bold.
 *
 * Four rather than a weight axis because that is what a label can actually ask
 * for — a rich-text mark is bold or it is not — and because a face has to be
 * loadable individually.
 */
export interface TLDefaultFont {
  normal: { normal: TLFontFace; bold: TLFontFace }
  italic: { normal: TLFontFace; bold: TLFontFace }
}

/** The built-in families, keyed by the `font-family` a shape's `font` prop resolves to. */
export interface TLDefaultFonts {
  tldraw_draw: TLDefaultFont
  tldraw_mono: TLDefaultFont
  tldraw_sans: TLDefaultFont
  tldraw_serif: TLDefaultFont
}

/**
 * A font file to load, as {@link preloadFont} takes it.
 *
 * Distinct from {@link TLFontFace}, which carries a ready-made CSS `src`
 * descriptor: this one names a URL and a format and lets the loader build the
 * descriptor, which is what an app that just wants to point at a `.woff2`
 * needs.
 */
export interface TLTypeFace {
  /** Where the font file is. */
  url: string
  /** `font-display` descriptor. */
  display?: FontDisplay
  /** `font-feature-settings` descriptor. */
  featureSettings?: string
  /** Font format hint, e.g. `"woff2"`. Appended to the `src` descriptor when given. */
  format?: string
  /** `font-stretch` descriptor. */
  stretch?: string
  /** `font-style` descriptor. */
  style?: string
  /** `unicode-range` descriptor. */
  unicodeRange?: string
  /** `font-variant` descriptor. */
  variant?: string
  /** `font-weight` descriptor. */
  weight?: string
}

/** The built-in families, as {@link TLDefaultFonts}. */
export const defaultFonts = DefaultFontFaces as unknown as TLDefaultFonts

/**
 * Every built-in face as a flat list.
 *
 * The form a preloader wants: "load everything the default shapes might draw
 * with" is one `Promise.all` over this, where walking the nested table would be
 * four loops and an ordering question.
 */
export const allDefaultFontFaces: readonly TLFontFace[] = Object.values(DefaultFontFaces).flatMap((family) =>
  Object.values(family).flatMap((byWeight) => Object.values(byWeight)),
)

/**
 * Load a font into a document and register it under `id`.
 *
 * Resolves once the file is available for layout, so a caller can render text
 * knowing it will not reflow underneath. Where the CSS Font Loading API is
 * missing — a server render, a test environment — it rejects rather than
 * pretending: a caller that wants "load if you can" should catch, and one that
 * is measuring text needs to know it did not happen.
 */
export async function preloadFont(id: string, font: TLTypeFace, targetDocument?: Document): Promise<FontFace> {
  const doc = targetDocument ?? (typeof document === "undefined" ? undefined : document)
  if (!doc || typeof FontFace === "undefined") {
    throw new Error(`mocanvas: cannot preload font "${id}" — this environment has no CSS Font Loading API.`)
  }
  const source = font.format ? `url(${JSON.stringify(font.url)}) format(${JSON.stringify(font.format)})` : `url(${JSON.stringify(font.url)})`
  const descriptors: FontFaceDescriptors = {}
  if (font.display !== undefined) descriptors.display = font.display
  if (font.featureSettings !== undefined) descriptors.featureSettings = font.featureSettings
  if (font.stretch !== undefined) descriptors.stretch = font.stretch
  if (font.style !== undefined) descriptors.style = font.style
  if (font.unicodeRange !== undefined) descriptors.unicodeRange = font.unicodeRange
  if (font.variant !== undefined) (descriptors as { variant?: string }).variant = font.variant
  if (font.weight !== undefined) descriptors.weight = font.weight

  const face = new FontFace(id, source, descriptors)
  const loaded = await face.load()
  doc.fonts.add(loaded)
  return loaded
}

/**
 * The font a rich-text node is drawn in, carried down the document tree.
 *
 * A visitor gets its parent's state, may change it, and returns what its own
 * children should inherit — which is how a `<strong>` inside a paragraph ends
 * up bold without the paragraph knowing anything about it.
 *
 * SEMANTICS-ASSUMED: the documented spelling is `@tldraw/editor`'s
 * `RichTextFontVisitorState`, which mocanvas does not export yet. The three
 * fields below are the ones the documented usage passes
 * (`{ family: "tldraw_draw", weight: "normal", style: "normal" }`), so the two
 * are structurally the same object.
 */
export interface RichTextFontState {
  family: string
  weight: string
  style: string
}

/** The subset of a ProseMirror node this visitor reads. Structural, so a real TipTap node fits. */
interface VisitedNode {
  type?: { name?: string } | string
  marks?: readonly { type?: { name?: string } | string }[]
}

function nameOf(value: { name?: string } | string | undefined): string {
  return typeof value === "string" ? value : (value?.name ?? "")
}

const BOLD_MARKS = new Set(["bold", "strong"])
const ITALIC_MARKS = new Set(["italic", "em"])
const CODE_MARKS = new Set(["code", "codeBlock"])

/**
 * The built-in rich-text font visitor: work out which face a node needs,
 * register it, and pass the resulting state to the node's children.
 *
 * Bold and italic marks switch weight and style; a code mark switches the whole
 * family to the monospace one, because that is what the mark means. An app that
 * adds a mark of its own wraps this — handle the mark, then delegate — rather
 * than reimplementing the standard cases.
 */
export function defaultAddFontsFromNode(
  node: Node | VisitedNode,
  state: RichTextFontState,
  addFont: (font: TLFontFace) => void,
): RichTextFontState {
  const visited = node as VisitedNode
  let next = state
  for (const mark of visited.marks ?? []) {
    const name = nameOf(mark.type)
    if (BOLD_MARKS.has(name)) next = { ...next, weight: "bold" }
    else if (ITALIC_MARKS.has(name)) next = { ...next, style: "italic" }
    else if (CODE_MARKS.has(name)) next = { ...next, family: "tldraw_mono" }
  }
  if (CODE_MARKS.has(nameOf(visited.type))) next = { ...next, family: "tldraw_mono" }

  const face = DefaultFontFaces[next.family]?.[next.style]?.[next.weight]
  if (face) addFont(face)
  return next
}
