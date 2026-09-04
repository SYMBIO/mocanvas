/**
 * The built-in typefaces.
 *
 * mocanvas ships no font files: every default face names a family that is
 * already on the machine, so a board renders identically with nothing loaded.
 * An app that wants real webfonts replaces the theme's `fonts` stacks and
 * registers its own {@link TLFontFace} entries with the font manager.
 */
import type { DefaultFontStyle } from "../records/styles"
import type { TLFontFace, TLFontFaceSet, TLThemeFonts } from "./types"

// SEMANTICS-ASSUMED: the `tldraw_` family prefix, and `src` as a CSS `src`
// descriptor string. The consumer looks its preview faces up by
// `DefaultFontFaces["tldraw_" + font]`, and `FontManager` hands `src` straight
// to `new FontFace(family, src, descriptors)`.
/**
 * CSS stacks per font style — the value a shape's `font` prop resolves to.
 *
 * The family names are prefixed `tldraw_` so that a stylesheet or a font
 * picker written against the classic canvas keeps resolving; the stacks
 * themselves are local families, listed after it as the real fallback.
 */
export const DEFAULT_FONT_FAMILIES: TLThemeFonts = {
  draw: 'tldraw_draw, "Comic Sans MS", "Segoe Print", "Bradley Hand", "Chalkboard SE", cursive',
  sans: 'tldraw_sans, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'tldraw_serif, Georgia, "Times New Roman", Times, serif',
  mono: 'tldraw_mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
}

/** The local family each built-in face borrows its glyphs from. */
const LOCAL_SOURCES: Record<DefaultFontStyle, string> = {
  draw: "Comic Sans MS",
  sans: "Helvetica",
  serif: "Georgia",
  mono: "Menlo",
}

/** The four faces of one family: upright and italic, normal and bold. */
function faceSet(font: DefaultFontStyle): TLFontFaceSet {
  const family = `tldraw_${font}`
  const local = LOCAL_SOURCES[font]
  const face = (style: string, weight: string): TLFontFace => ({
    family,
    src: `local("${local}")`,
    style,
    weight,
    display: "swap",
  })
  return {
    normal: { normal: face("normal", "normal"), bold: face("normal", "bold") },
    italic: { normal: face("italic", "normal"), bold: face("italic", "bold") },
  }
}

/**
 * Every built-in face, keyed by family then `[style][weight]` — the shape a
 * font picker reads one preview face out of:
 *
 * ```ts
 * DefaultFontFaces["tldraw_serif"]?.normal?.normal
 * ```
 */
export const DefaultFontFaces: Record<string, TLFontFaceSet> = {
  tldraw_draw: faceSet("draw"),
  tldraw_sans: faceSet("sans"),
  tldraw_serif: faceSet("serif"),
  tldraw_mono: faceSet("mono"),
}
