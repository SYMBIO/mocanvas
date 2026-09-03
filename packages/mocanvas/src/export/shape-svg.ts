/**
 * Per-type SVG renderers for the built-in shapes, keyed by shape type. Every
 * renderer returns markup in shape-local space; the exporter wraps it in a
 * `<g transform>` carrying the page transform. Types without an entry fall
 * back to their geometry outline drawn with their render style.
 */
import {
  FONT_SIZES,
  LIGHT_THEME,
  hexToRgba,
  type Editor,
  type StyleWords,
  type UnknownShape,
} from "@mocanvas/editor"
import { ARROW_LABEL_PADDING, type ArrowShape } from "../shapes/ArrowShapeUtil"
import { FRAME_FILL, FRAME_STROKE, type FrameShape } from "../shapes/FrameShapeUtil"
import { GEO_LABEL_PADDING, type GeoShape } from "../shapes/GeoShapeUtil"
import { getNoteFontSize, NOTE_PADDING, NOTE_SIZE, type NoteShape } from "../shapes/NoteShapeUtil"
import { getFontFamily, getNoteTextCssColor, getTextCssColor } from "../shapes/shape-theme"
import { type TextShape } from "../shapes/TextShapeUtil"
import { attrs, geometryLabels, geometryToSvgPaths, rgbaToHex } from "./svg-utils"
import { textToSvg } from "./text-svg"

/** Export-wide settings a renderer may consult. */
export interface SvgExportContext {
  darkMode: boolean
  /** Page background colour used for the export (`#rrggbb`). */
  background: string
}

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

const FRAME_NAME_COLOR = "#5c6470"
const FRAME_NAME_FONT_SIZE = 12
const FRAME_NAME_OFFSET = 24

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

const noteSvg: ShapeSvgRenderer<NoteShape> = (editor, shape) => {
  const { text, font, color, labelColor, align, verticalAlign, scale, growY } = shape.props
  const w = NOTE_SIZE * scale
  const h = NOTE_SIZE * scale + growY
  const style = editor.getShapeUtil(shape).getRenderStyle(shape)
  const fill = (style && rgbaToHex(style.fill)) ?? LIGHT_THEME[color].note.fill
  let out = `<rect ${attrs({ x: 0, y: 0, width: w, height: h, fill })}/>`
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
  let out = `<rect ${attrs({ x: 0, y: 0, width: w, height: h, fill: FRAME_FILL, stroke: FRAME_STROKE, "stroke-width": 1 })}/>`
  if (name) {
    // The single-line name sits in a strip just above the frame, like the DOM label.
    const [firstLine = ""] = name.split("\n")
    out += textToSvg(firstLine, { x: 0, y: -FRAME_NAME_OFFSET, w, h: FRAME_NAME_OFFSET - 4 }, {
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
])

/** Register (or replace) the SVG renderer for a shape type. */
export function registerShapeSvgRenderer<T extends UnknownShape>(type: T["type"], renderer: ShapeSvgRenderer<T>): void {
  shapeSvgRenderers.set(type, renderer as ShapeSvgRenderer)
}

/** Render a shape to SVG markup in shape-local space using the registry. */
export function shapeToSvg(editor: Editor, shape: UnknownShape, ctx: SvgExportContext): string {
  const renderer = shapeSvgRenderers.get(shape.type) ?? defaultShapeSvgRenderer
  return renderer(editor, shape, ctx)
}
