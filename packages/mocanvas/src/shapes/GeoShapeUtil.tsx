import {
  BaseBoxShapeUtil,
  FONT_SIZES,
  Group2d,
  Rectangle2d,
  STROKE_SIZES,
  type BaseShape,
  type DefaultColorStyle,
  type DefaultDashStyle,
  type DefaultFillStyle,
  type DefaultFontStyle,
  type DefaultHorizontalAlignStyle,
  type DefaultSizeStyle,
  type DefaultVerticalAlignStyle,
  type GeoShapeKind,
  type Geometry2d,
  type StyleWords,
} from "@mocanvas/editor"
import type { CSSProperties, ReactNode } from "react"
import { alignToJustify, alignToTextAlign, TextLabel, verticalAlignToAlignItems } from "../text/TextEditor"
import { computeGrowY, measureLabel, trimTrailingWhitespace } from "../text/text-layout"
import { getGeoGeometry } from "./geo-helpers"
import { getFillRgba, getStrokeRgba, getTextCssColor } from "./shape-theme"
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

/** Measured size of a geo label (padding included), wrapped at the shape width. */
export function measureGeoLabel(props: Pick<GeoShapeProps, "text" | "font" | "size" | "scale" | "w">) {
  const { text, font, size, scale, w } = props
  return measureLabel(text, { font, fontSize: FONT_SIZES[size] * scale, maxWidth: Math.max(1, w), padding: LABEL_PADDING * scale })
}

/** `growY` a geo shape needs so its label fits inside `h`. Empty labels never grow the shape. */
export function getGeoGrowY(props: Pick<GeoShapeProps, "text" | "font" | "size" | "scale" | "w" | "h">): number {
  if (!props.text) return 0
  return computeGrowY(measureGeoLabel(props).h, props.h)
}

const LABEL_KEYS: readonly (keyof GeoShapeProps)[] = ["text", "font", "size", "scale", "w", "h"]

export class GeoShapeUtil extends BaseBoxShapeUtil<GeoShape> {
  static override type = "geo" as const

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
    const { geo, w, h, growY, fill, text } = shape.props
    const height = h + growY
    const body = getGeoGeometry(geo, w, height, fill !== "none")
    if (!text) return body
    return new Group2d({ children: [body, this.getLabelRect(shape)] })
  }

  /** Where the text label sits inside the body, in shape-local space. */
  private getLabelRect(shape: GeoShape): Rectangle2d {
    const { w, h, growY, align, verticalAlign } = shape.props
    const height = h + growY
    const m = measureGeoLabel(shape.props)
    const lw = Math.min(w, m.w)
    const lh = Math.min(height, m.h)
    const x = align === "start" || align === "start-legacy" ? 0 : align === "end" || align === "end-legacy" ? w - lw : (w - lw) / 2
    const y = verticalAlign === "start" ? 0 : verticalAlign === "end" ? height - lh : (height - lh) / 2
    return new Rectangle2d({ x, y, width: lw, height: lh, isFilled: false, isLabel: true })
  }

  override getRenderStyle(shape: GeoShape): StyleWords {
    const { color, fill, size, scale } = shape.props
    return {
      stroke: getStrokeRgba(color),
      strokeWidth: STROKE_SIZES[size] * scale,
      fill: getFillRgba(color, fill),
      dash: 0,
      opacity: 1,
    }
  }

  component(shape: GeoShape): ReactNode {
    const { text, font, size, scale, labelColor, align, verticalAlign, w, h, growY } = shape.props
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
    return shape.props.text.trim().length > 0 || this.editor.getEditingShapeId() === shape.id
  }

  override canEdit(_shape: GeoShape): boolean {
    return true
  }

  override getText(shape: GeoShape): string {
    return shape.props.text
  }

  override onBeforeCreate(next: GeoShape): GeoShape | void {
    const growY = getGeoGrowY(next.props)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onBeforeUpdate(prev: GeoShape, next: GeoShape): GeoShape | void {
    if (!LABEL_KEYS.some((k) => prev.props[k] !== next.props[k])) return
    const growY = getGeoGrowY(next.props)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onEditEnd(shape: GeoShape): void {
    const trimmed = trimTrailingWhitespace(shape.props.text)
    if (trimmed !== shape.props.text) this.editor.updateShape<GeoShape>({ id: shape.id, type: "geo", props: { text: trimmed } })
  }
}
