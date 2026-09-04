/**
 * Per-type SVG renderers for the built-in shapes, keyed by shape type. Every
 * renderer returns markup in shape-local space; the exporter wraps it in a
 * `<g transform>` carrying the page transform.
 *
 * The registry is the middle rung of `shapeToSvg`'s precedence: a util's own
 * `toSvg` outranks it, and a type with neither falls back to its geometry
 * outline drawn with its render style.
 */
import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  FONT_SIZES,
  LIGHT_THEME,
  hexToRgba,
  type Editor,
  type ShapeSvgContext,
  type ShapeSvgResult,
  type StyleWords,
  type UnknownShape,
} from "@mocanvas/editor"
import { ARROW_LABEL_PADDING, type ArrowShape } from "../shapes/ArrowShapeUtil"
import {
  BOOKMARK_BANNER_FILL,
  BOOKMARK_FILL,
  BOOKMARK_META_COLOR,
  BOOKMARK_META_FONT_SIZE,
  BOOKMARK_RADIUS,
  BOOKMARK_STROKE,
  BOOKMARK_STROKE_WIDTH,
  BOOKMARK_TEXT_COLOR,
  BOOKMARK_TEXT_FONT_SIZE,
  BOOKMARK_TITLE_COLOR,
  BOOKMARK_TITLE_FONT_SIZE,
  getBookmarkCard,
  getBookmarkLayout,
  type BookmarkShape,
} from "../shapes/BookmarkShapeUtil"
import {
  EMBED_PLACEHOLDER_FILL,
  EMBED_PLACEHOLDER_FONT_SIZE,
  EMBED_PLACEHOLDER_PADDING,
  EMBED_PLACEHOLDER_STROKE,
  EMBED_PLACEHOLDER_TEXT,
  EMBED_RADIUS,
  getEmbedDefinition,
  type EmbedShape,
} from "../shapes/EmbedShapeUtil"
import { type FrameShape } from "../shapes/FrameShapeUtil"
import { GEO_LABEL_PADDING, type GeoShape } from "../shapes/GeoShapeUtil"
import { getNoteFontSize, NOTE_PADDING, NOTE_SIZE, type NoteShape } from "../shapes/NoteShapeUtil"
import {
  FRAME_FILL,
  FRAME_NAME_COLOR,
  FRAME_NAME_FONT_SIZE,
  FRAME_NAME_HEIGHT,
  FRAME_NAME_OFFSET,
  FRAME_STROKE,
  FRAME_STROKE_WIDTH,
  NOTE_SHADOW_COLOR,
  NOTE_SHADOW_OPACITY,
  getFontFamily,
  getNoteFillCssColor,
  getNoteGradientTopFrom,
  getNoteShadowSvgRect,
  getNoteTextCssColor,
  getTextCssColor,
} from "../shapes/shape-theme"
import { type TextShape } from "../shapes/TextShapeUtil"
import {
  getVideoPlayTriangle,
  getVideoSource,
  VIDEO_PLACEHOLDER_FILL,
  VIDEO_PLACEHOLDER_STROKE,
  VIDEO_PLAY_COLOR,
  type VideoShape,
} from "../shapes/VideoShapeUtil"
import { attrs, escapeXml, geometryLabels, geometryToSvgPaths, rgbaToHex, svgNum } from "./svg-utils"
import { textToSvg } from "./text-svg"

/**
 * Export-wide settings a renderer may consult. Same shape as the context a
 * `ShapeUtil.toSvg` receives, so the two paths cannot drift apart.
 */
export interface SvgExportContext extends ShapeSvgContext {}

/** Renders one shape to SVG markup in shape-local coordinates. */
export type ShapeSvgRenderer<T extends UnknownShape = UnknownShape> = (editor: Editor, shape: T, ctx: SvgExportContext) => string

/** Outline drawn with the render style, or a hairline in the theme text colour when the shape has none. */
export function geometryFallbackSvg(editor: Editor, shape: UnknownShape): string {
  const geometry = editor.getShapeGeometry(shape)
  const style: StyleWords = editor.getShapeUtil(shape).getRenderStyle(shape) ?? {
    fill: 0,
    stroke: hexToRgba(LIGHT_THEME.text),
    strokeWidth: 1,
    dash: 0,
    opacity: 1,
  }
  return geometryToSvgPaths(geometry, style)
}

/** Fallback renderer applied to shape types without a registry entry. */
export const defaultShapeSvgRenderer: ShapeSvgRenderer = (editor, shape) => geometryFallbackSvg(editor, shape)

/** A shape id reduced to characters that are safe inside an SVG `id`. */
function svgId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "-")
}

function labelBox(editor: Editor, shape: UnknownShape): { x: number; y: number; w: number; h: number } | undefined {
  const label = geometryLabels(editor.getShapeGeometry(shape))[0]
  if (!label) return undefined
  const b = label.bounds
  return { x: b.x, y: b.y, w: b.w, h: b.h }
}

const geoSvg: ShapeSvgRenderer<GeoShape> = (editor, shape) => {
  const { text, font, size, scale, labelColor, align, verticalAlign } = shape.props
  let out = geometryFallbackSvg(editor, shape)
  if (!text) return out
  const box = labelBox(editor, shape)
  if (!box) return out
  out += textToSvg(text, box, {
    fontFamily: getFontFamily(font),
    fontSize: FONT_SIZES[size] * scale,
    color: getTextCssColor(labelColor),
    align,
    verticalAlign,
    padding: GEO_LABEL_PADDING * scale,
    wrap: true,
  })
  return out
}

const drawSvg: ShapeSvgRenderer = (editor, shape) => geometryFallbackSvg(editor, shape)
const lineSvg: ShapeSvgRenderer = (editor, shape) => geometryFallbackSvg(editor, shape)

const arrowSvg: ShapeSvgRenderer<ArrowShape> = (editor, shape, ctx) => {
  const { text, font, size, scale, labelColor } = shape.props
  let out = geometryFallbackSvg(editor, shape)
  if (!text) return out
  const box = labelBox(editor, shape)
  if (!box) return out
  // Knock the line out behind the label so the text stays legible.
  out += `<rect ${attrs({ x: box.x, y: box.y, width: box.w, height: box.h, rx: 4, fill: ctx.background })}/>`
  out += textToSvg(text, box, {
    fontFamily: getFontFamily(font),
    fontSize: FONT_SIZES[size] * scale,
    color: getTextCssColor(labelColor),
    align: "middle",
    verticalAlign: "middle",
    padding: ARROW_LABEL_PADDING * scale,
    wrap: false,
  })
  return out
}

const textSvg: ShapeSvgRenderer<TextShape> = (editor, shape) => {
  const { text, font, size, scale, color, textAlign, autoSize } = shape.props
  const b = editor.getShapeGeometry(shape).bounds
  return textToSvg(text, { x: b.x, y: b.y, w: b.w, h: b.h }, {
    fontFamily: getFontFamily(font),
    fontSize: FONT_SIZES[size] * scale,
    color: getTextCssColor(color),
    align: textAlign,
    verticalAlign: "start",
    wrap: !autoSize,
  })
}

/**
 * A note's trim as SVG: a `<linearGradient>` for the body and an
 * `feDropShadow` under it, so an export carries the same trim the DOM overlay
 * paints over the GPU quad. Ids are namespaced by the shape id so several
 * notes in one document do not collide.
 */
function noteTrimDefs(shape: NoteShape, bottom: string, ids: { gradient: string; shadow: string }): string {
  const scale = shape.props.scale
  const gradient =
    `<linearGradient ${attrs({ id: ids.gradient, x1: 0, y1: 0, x2: 0, y2: 1 })}>` +
    `<stop ${attrs({ offset: 0, "stop-color": getNoteGradientTopFrom(bottom) })}/>` +
    `<stop ${attrs({ offset: 1, "stop-color": bottom })}/>` +
    `</linearGradient>`
  // A generous filter region: the default -10%/120% box clips a soft shadow.
  // `feDropShadow` has no spread, so the shadow is its own inset, offset rect
  // (see `getNoteShadowSvgRect`) and the filter only blurs it.
  const filter =
    `<filter ${attrs({ id: ids.shadow, x: "-50%", y: "-50%", width: "200%", height: "200%" })}>` +
    `<feGaussianBlur ${attrs({ stdDeviation: getNoteShadowSvgRect(0, 0, scale).stdDeviation })}/>` +
    `</filter>`
  return `<defs>${gradient}${filter}</defs>`
}

const noteSvg: ShapeSvgRenderer<NoteShape> = (editor, shape) => {
  const { text, font, color, labelColor, align, verticalAlign, scale, growY } = shape.props
  const w = NOTE_SIZE * scale
  const h = NOTE_SIZE * scale + growY
  const style = editor.getShapeUtil(shape).getRenderStyle(shape)
  // The engine's flat quad is the gradient's *bottom* colour; the top stop is
  // derived from it, so a custom fill still gradates.
  const bottom = (style && rgbaToHex(style.fill)) ?? getNoteFillCssColor(color)
  const suffix = svgId(shape.id)
  const ids = { gradient: `mc-note-fill-${suffix}`, shadow: `mc-note-shadow-${suffix}` }
  let out = noteTrimDefs(shape, bottom, ids)
  // The shadow first, as its own blurred rect behind the body: the body inset
  // by the spread and pushed down, which is what CSS `box-shadow` draws.
  const sh = getNoteShadowSvgRect(w, h, scale)
  if (sh.w > 0 && sh.h > 0) {
    out += `<rect ${attrs({
      x: sh.x,
      y: sh.y,
      width: sh.w,
      height: sh.h,
      fill: NOTE_SHADOW_COLOR,
      "fill-opacity": NOTE_SHADOW_OPACITY,
      filter: `url(#${ids.shadow})`,
    })}/>`
  }
  out += `<rect ${attrs({ x: 0, y: 0, width: w, height: h, fill: `url(#${ids.gradient})` })}/>`
  if (!text) return out
  const textColor = labelColor === "black" ? getNoteTextCssColor(color) : LIGHT_THEME[labelColor].solid
  out += textToSvg(text, { x: 0, y: 0, w, h }, {
    fontFamily: getFontFamily(font),
    fontSize: getNoteFontSize(shape),
    color: textColor,
    align,
    verticalAlign,
    padding: NOTE_PADDING * scale,
    wrap: true,
  })
  return out
}

const frameSvg: ShapeSvgRenderer<FrameShape> = (_editor, shape) => {
  const { w, h, name } = shape.props
  let out = `<rect ${attrs({ x: 0, y: 0, width: w, height: h, fill: FRAME_FILL, stroke: FRAME_STROKE, "stroke-width": FRAME_STROKE_WIDTH })}/>`
  if (name) {
    // The single-line name sits in a strip just above the frame, like the DOM label.
    const [firstLine = ""] = name.split("\n")
    out += textToSvg(firstLine, { x: 0, y: -FRAME_NAME_OFFSET, w, h: FRAME_NAME_HEIGHT }, {
      fontFamily: getFontFamily("sans"),
      fontSize: FRAME_NAME_FONT_SIZE,
      color: FRAME_NAME_COLOR,
      align: "start",
      verticalAlign: "end",
      wrap: false,
    })
  }
  return out
}

/**
 * A bookmark's card, drawn with rects and text. The banner is a plain block
 * rather than the scraped image: an export has to stand on its own, and a
 * remote `<image href>` would either fail to load or leak a request when the
 * file is opened somewhere else.
 */
const bookmarkSvg: ShapeSvgRenderer<BookmarkShape> = (editor, shape) => {
  const { w, h } = shape.props
  const card = getBookmarkCard(editor, shape)
  const layout = getBookmarkLayout(w, h)
  const sans = getFontFamily("sans")
  let out = `<rect ${attrs({
    x: 0,
    y: 0,
    width: w,
    height: h,
    rx: BOOKMARK_RADIUS,
    fill: BOOKMARK_FILL,
    stroke: BOOKMARK_STROKE,
    "stroke-width": BOOKMARK_STROKE_WIDTH,
  })}/>`
  if (layout.banner.h > 0) {
    out += `<rect ${attrs({ x: 0, y: 0, width: layout.banner.w, height: layout.banner.h, fill: BOOKMARK_BANNER_FILL })}/>`
  }
  const title = card.hasAsset ? card.title : card.hostname || card.url
  out += textToSvg(title, layout.title, {
    fontFamily: sans,
    fontSize: BOOKMARK_TITLE_FONT_SIZE,
    color: card.hasAsset ? BOOKMARK_TITLE_COLOR : BOOKMARK_META_COLOR,
    align: "start",
    verticalAlign: "start",
    ...(card.hasAsset ? { fontWeight: 600 } : {}),
    wrap: true,
  })
  if (!card.hasAsset) return out
  out += textToSvg(card.description, layout.description, {
    fontFamily: sans,
    fontSize: BOOKMARK_TEXT_FONT_SIZE,
    color: BOOKMARK_TEXT_COLOR,
    align: "start",
    verticalAlign: "start",
    wrap: true,
  })
  if (card.favicon) {
    // The favicon's block, for the same reason the banner is one.
    out += `<rect ${attrs({ ...boxAttrs(layout.favicon), rx: 2, fill: BOOKMARK_BANNER_FILL })}/>`
  }
  out += textToSvg(card.hostname, layout.hostname, {
    fontFamily: sans,
    fontSize: BOOKMARK_META_FONT_SIZE,
    color: BOOKMARK_META_COLOR,
    align: "start",
    verticalAlign: "middle",
    wrap: false,
  })
  return out
}

/** `x`/`y`/`width`/`height` attributes for a shape-local rect. */
function boxAttrs(box: { x: number; y: number; w: number; h: number }): Record<string, number> {
  return { x: box.x, y: box.y, width: box.w, height: box.h }
}

/**
 * An embed as a placeholder card: an `<iframe>` cannot go in an SVG, so the
 * export carries the frame and the url it pointed at.
 */
const embedSvg: ShapeSvgRenderer<EmbedShape> = (_editor, shape) => {
  const { w, h, url } = shape.props
  const match = getEmbedDefinition(url)
  const label = match ? `${match.definition.title}\n${url}` : url
  let out = `<rect ${attrs({
    x: 0,
    y: 0,
    width: w,
    height: h,
    rx: EMBED_RADIUS,
    fill: EMBED_PLACEHOLDER_FILL,
    stroke: EMBED_PLACEHOLDER_STROKE,
    "stroke-width": 1,
    "stroke-dasharray": "4 4",
  })}/>`
  out += textToSvg(label, { x: 0, y: 0, w, h }, {
    fontFamily: getFontFamily("sans"),
    fontSize: EMBED_PLACEHOLDER_FONT_SIZE,
    color: EMBED_PLACEHOLDER_TEXT,
    align: "middle",
    verticalAlign: "middle",
    padding: EMBED_PLACEHOLDER_PADDING,
    wrap: true,
  })
  return out
}

/** A video as its poster frame's stand-in: the box and a play triangle. */
const videoSvg: ShapeSvgRenderer<VideoShape> = (editor, shape) => {
  const { w, h, altText } = shape.props
  const hasSource = getVideoSource(editor, shape) !== null
  let out = `<rect ${attrs({
    x: 0,
    y: 0,
    width: w,
    height: h,
    fill: VIDEO_PLACEHOLDER_FILL,
    stroke: VIDEO_PLACEHOLDER_STROKE,
    "stroke-width": 1,
    "stroke-dasharray": hasSource ? undefined : "4 4",
  })}/>`
  const points = getVideoPlayTriangle(w, h)
    .map((p) => `${svgNum(p.x)},${svgNum(p.y)}`)
    .join(" ")
  out += `<polygon ${attrs({ points, fill: VIDEO_PLAY_COLOR })}/>`
  if (altText) {
    out += `<title>${escapeXml(altText)}</title>`
  }
  return out
}

/**
 * Registry of per-type renderers. Custom shapes can register their own entry;
 * anything missing falls back to `defaultShapeSvgRenderer`.
 */
export const shapeSvgRenderers = new Map<string, ShapeSvgRenderer>([
  ["geo", geoSvg as ShapeSvgRenderer],
  ["draw", drawSvg],
  ["line", lineSvg],
  ["arrow", arrowSvg as ShapeSvgRenderer],
  ["text", textSvg as ShapeSvgRenderer],
  ["note", noteSvg as ShapeSvgRenderer],
  ["frame", frameSvg as ShapeSvgRenderer],
  ["bookmark", bookmarkSvg as ShapeSvgRenderer],
  ["embed", embedSvg as ShapeSvgRenderer],
  ["video", videoSvg as ShapeSvgRenderer],
])

/** Register (or replace) the SVG renderer for a shape type. */
export function registerShapeSvgRenderer<T extends UnknownShape>(type: T["type"], renderer: ShapeSvgRenderer<T>): void {
  shapeSvgRenderers.set(type, renderer as ShapeSvgRenderer)
}

/**
 * Markup for a value returned by `toSvg` / `toBackgroundSvg`: a string is used
 * verbatim, a React node is serialized, and React's empty values become
 * `undefined` so the caller can fall through to the next renderer.
 */
export function svgResultToMarkup(value: ShapeSvgResult): string | undefined {
  if (value === undefined || value === null || typeof value === "boolean") return undefined
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  return renderToStaticMarkup(value as ReactElement)
}

/**
 * Render a shape to SVG markup in shape-local space.
 *
 * Precedence, highest first:
 *
 *  1. `ShapeUtil.toSvg` — the shape's own opinion about itself. A custom shape
 *     is exportable by implementing one method, with nothing to register.
 *  2. `shapeSvgRenderers` — the registry, which carries the built-in shapes and
 *     lets an app override a type whose util it does not own (see
 *     `registerShapeSvgRenderer`).
 *  3. The shape's geometry stroked with its render style — the last resort, so
 *     an unknown type still exports as something rather than as nothing.
 */
export function shapeToSvg(editor: Editor, shape: UnknownShape, ctx: SvgExportContext): string {
  const util = editor.getShapeUtil(shape)
  const own = svgResultToMarkup(util.toSvg?.(shape, ctx))
  if (own !== undefined) return own
  const renderer = shapeSvgRenderers.get(shape.type) ?? defaultShapeSvgRenderer
  return renderer(editor, shape, ctx)
}

/**
 * A shape's backdrop in shape-local space, drawn behind *every* exported
 * shape. Only `ShapeUtil.toBackgroundSvg` produces one; there is no registry
 * behind it and no geometry fallback, because a shape that says nothing here
 * wants nothing drawn.
 */
export function shapeToBackgroundSvg(editor: Editor, shape: UnknownShape, ctx: SvgExportContext): string | undefined {
  return svgResultToMarkup(editor.getShapeUtil(shape).toBackgroundSvg?.(shape, ctx))
}
