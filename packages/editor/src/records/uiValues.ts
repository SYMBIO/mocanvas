/**
 * Small closed value sets that records store but shapes do not own: the palette
 * the canvas *chrome* draws itself in, the opacity every shape carries, and the
 * kinds of handle a shape can expose.
 *
 * They are here rather than in `styles.ts` because none of them is a
 * {@link StyleProp}: they are not shared across a selection, and changing one
 * is not a style edit.
 */

import { T } from "../validation/T"

/**
 * Colours the canvas chrome is allowed to use.
 *
 * Deliberately a tiny, theme-resolved set rather than the shape palette:
 * selection outlines, scribbles and brushes have to stay legible against the
 * document whatever colours the document uses, so they name a *role*
 * (`accent`, `muted-1`) that the theme resolves, not a hue.
 */
export const TL_CANVAS_UI_COLOR_TYPES = [
  "accent",
  "white",
  "black",
  "selection-stroke",
  "selection-fill",
  "laser",
  "muted-1",
] as const

/** One of {@link TL_CANVAS_UI_COLOR_TYPES}. */
export type TLCanvasUiColor = (typeof TL_CANVAS_UI_COLOR_TYPES)[number]

export const canvasUiColorTypeValidator = T.literalEnum(...TL_CANVAS_UI_COLOR_TYPES)

/**
 * A shape's opacity: `0` to `1` inclusive.
 *
 * Not a style prop even though the style panel edits it — every shape has one,
 * whether or not its util declares any props at all, so it lives on the record
 * beside `x` and `rotation`.
 */
export type TLOpacityType = number

export const opacityValidator = T.number.check("opacity", (value) => {
  if (value < 0 || value > 1) throw new Error(`Expected an opacity between 0 and 1, got ${String(value)}`)
})

/**
 * What a handle on a shape does.
 *
 * `vertex` handles are real points a user can drag; `virtual` handles are the
 * midpoints shown between vertices that become real when dragged; `create`
 * handles add a point; `clone` duplicates the shape. The distinction matters
 * for hit-testing, since virtual handles must not be picked up as easily as
 * real ones.
 */
export const TL_HANDLE_TYPES = ["vertex", "virtual", "create", "clone"] as const

/** One of {@link TL_HANDLE_TYPES}. */
export type TLHandleType = (typeof TL_HANDLE_TYPES)[number]

export const handleTypeValidator = T.literalEnum(...TL_HANDLE_TYPES)
