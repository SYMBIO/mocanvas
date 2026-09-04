import {
  BaseBoxShapeUtil,
  FONT_SIZES,
  Group2d,
  Rectangle2d,
  STROKE_SIZES,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultLabelColorStyle,
  DefaultSizeStyle,
  DefaultVerticalAlignStyle,
  GeoShapeGeoStyle,
  type BaseShape,
  type GeoShapeKind,
  type Geometry2d,
  type StyleWords,
} from "@mocanvas/editor"
import type { CSSProperties, ReactNode } from "react"
import { alignToJustify, alignToTextAlign, TextLabel, verticalAlignToAlignItems } from "../text/TextEditor"
import { computeGrowY, measureLabel, trimTrailingWhitespace } from "../text/text-layout"
import { getGeoGeometry } from "./geo-helpers"
import { propsOf, readNumber, readString, readStyle, readText } from "./prop-access"
import { getDashId, getFillRgba, getStrokeRgba, getTextCssColor } from "./shape-theme"
import { pathWordsToSvgD } from "./svg-path"

export interface GeoShapeProps {
  geo: GeoShapeKind
  w: number
  h: number
  color: DefaultColorStyle
  labelColor: DefaultColorStyle
  fill: DefaultFillStyle
  dash: DefaultDashStyle
  size: DefaultSizeStyle
  font: DefaultFontStyle
  align: DefaultHorizontalAlignStyle
  verticalAlign: DefaultVerticalAlignStyle
  growY: number
  url: string
  text: string
  scale: number
}

export type GeoShape = BaseShape<"geo", GeoShapeProps>

export const GEO_LABEL_PADDING = 16
const LABEL_PADDING = GEO_LABEL_PADDING

export function horizontalAlignToFlex(align: DefaultHorizontalAlignStyle): CSSProperties["justifyContent"] {
  return alignToJustify(align)
}

export function horizontalAlignToTextAlign(align: DefaultHorizontalAlignStyle): CSSProperties["textAlign"] {
  return alignToTextAlign(align)
}

export function verticalAlignToFlex(align: DefaultVerticalAlignStyle): CSSProperties["alignItems"] {
  return verticalAlignToAlignItems(align)
}

/**
 * `shape.props` with every declared prop present and of the declared type.
 * Geometry and rendering read through this so a record that arrived without a
 * prop (or with a value from another editor's vocabulary) still draws.
 */
export function readGeoProps(shape: { props?: unknown }): GeoShapeProps {
  const p = propsOf(shape)
  return {
    geo: readStyle(p, "geo", GeoShapeGeoStyle),
    w: readNumber(p, "w", 100),
    h: readNumber(p, "h", 100),
    color: readStyle(p, "color", DefaultColorStyle),
    labelColor: readStyle(p, "labelColor", DefaultLabelColorStyle),
    fill: readStyle(p, "fill", DefaultFillStyle),
    dash: readStyle(p, "dash", DefaultDashStyle),
    size: readStyle(p, "size", DefaultSizeStyle),
    font: readStyle(p, "font", DefaultFontStyle),
    align: readStyle(p, "align", DefaultHorizontalAlignStyle),
    verticalAlign: readStyle(p, "verticalAlign", DefaultVerticalAlignStyle),
    growY: readNumber(p, "growY", 0),
    url: readString(p, "url", ""),
    text: readText(p),
    scale: readNumber(p, "scale", 1),
  }
}

/** Measured size of a geo label (padding included), wrapped at the shape width. */
export function measureGeoLabel(props: Pick<GeoShapeProps, "text" | "font" | "size" | "scale" | "w">) {
  const text = readText(props)
  const font = readStyle(props, "font", DefaultFontStyle)
  const size = readStyle(props, "size", DefaultSizeStyle)
  const scale = readNumber(props, "scale", 1)
  const w = readNumber(props, "w", 100)
  return measureLabel(text, { font, fontSize: FONT_SIZES[size] * scale, maxWidth: Math.max(1, w), padding: LABEL_PADDING * scale })
}

/** `growY` a geo shape needs so its label fits inside `h`. Empty labels never grow the shape. */
export function getGeoGrowY(props: Pick<GeoShapeProps, "text" | "font" | "size" | "scale" | "w" | "h">): number {
  if (!readText(props)) return 0
  return computeGrowY(measureGeoLabel(props).h, readNumber(props, "h", 100))
}

const LABEL_KEYS: readonly (keyof GeoShapeProps)[] = ["text", "font", "size", "scale", "w", "h"]

export class GeoShapeUtil extends BaseBoxShapeUtil<GeoShape> {
  static override type = "geo" as const
  static override props = {
    geo: GeoShapeGeoStyle,
    color: DefaultColorStyle,
    labelColor: DefaultLabelColorStyle,
    fill: DefaultFillStyle,
    dash: DefaultDashStyle,
    size: DefaultSizeStyle,
    font: DefaultFontStyle,
    align: DefaultHorizontalAlignStyle,
    verticalAlign: DefaultVerticalAlignStyle,
  }

  getDefaultProps(): GeoShapeProps {
    return {
      geo: "rectangle",
      w: 100,
      h: 100,
      color: "black",
      labelColor: "black",
      fill: "none",
      dash: "draw",
      size: "m",
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      growY: 0,
      url: "",
      text: "",
      scale: 1,
    }
  }

  getGeometry(shape: GeoShape): Geometry2d {
    const props = readGeoProps(shape)
    const { geo, w, h, growY, fill, text } = props
    const height = h + growY
    const body = getGeoGeometry(geo, w, height, fill !== "none")
    if (!text) return body
    return new Group2d({ children: [body, this.getLabelRect(props)] })
  }

  /** Where the text label sits inside the body, in shape-local space. */
  private getLabelRect(props: GeoShapeProps): Rectangle2d {
    const { w, h, growY, align, verticalAlign } = props
    const height = h + growY
    const m = measureGeoLabel(props)
    const lw = Math.min(w, m.w)
    const lh = Math.min(height, m.h)
    const x = align === "start" || align === "start-legacy" ? 0 : align === "end" || align === "end-legacy" ? w - lw : (w - lw) / 2
    const y = verticalAlign === "start" ? 0 : verticalAlign === "end" ? height - lh : (height - lh) / 2
    return new Rectangle2d({ x, y, width: lw, height: lh, isFilled: false, isLabel: true })
  }

  override getRenderStyle(shape: GeoShape): StyleWords {
    const { color, fill, dash, size, scale } = readGeoProps(shape)
    return {
      stroke: getStrokeRgba(color),
      strokeWidth: STROKE_SIZES[size] * scale,
      fill: getFillRgba(color, fill),
      dash: getDashId(dash),
      opacity: 1,
    }
  }

  component(shape: GeoShape): ReactNode {
    const { text, font, size, scale, labelColor, align, verticalAlign, w, h, growY } = readGeoProps(shape)
    const isEditing = this.editor.getEditingShapeId() === shape.id
    if (!text && !isEditing) return null
    return (
      <TextLabel
        shape={shape}
        text={text}
        isEditing={isEditing}
        font={font}
        fontSize={FONT_SIZES[size] * scale}
        color={getTextCssColor(labelColor)}
        align={align}
        verticalAlign={verticalAlign}
        wrap
        width={w}
        height={h + growY}
        padding={LABEL_PADDING * scale}
        onChange={(next) => this.editor.updateShape<GeoShape>({ id: shape.id, type: "geo", props: { text: next } })}
      />
    )
  }

  indicator(shape: GeoShape): ReactNode {
    return <path d={pathWordsToSvgD(this.getGeometry(shape).toPathWords())} />
  }

  /** The GPU keeps drawing the body while editing; only the label lives in the DOM. */
  override needsOverlay(_shape: GeoShape): boolean {
    return false
  }

  override hasOverlayLabel(shape: GeoShape): boolean {
    return readText(shape.props).trim().length > 0 || this.editor.getEditingShapeId() === shape.id
  }

  override canEdit(_shape: GeoShape): boolean {
    return true
  }

  override getText(shape: GeoShape): string {
    return readText(shape.props)
  }

  override onBeforeCreate(next: GeoShape): GeoShape | void {
    const growY = getGeoGrowY(next.props)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onBeforeUpdate(prev: GeoShape, next: GeoShape): GeoShape | void {
    if (!LABEL_KEYS.some((k) => propsOf(prev)[k] !== propsOf(next)[k])) return
    const growY = getGeoGrowY(next.props)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onEditEnd(shape: GeoShape): void {
    const text = readText(shape.props)
    const trimmed = trimTrailingWhitespace(text)
    if (trimmed !== text) this.editor.updateShape<GeoShape>({ id: shape.id, type: "geo", props: { text: trimmed } })
  }
}
