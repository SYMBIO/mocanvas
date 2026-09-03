import {
  BaseBoxShapeUtil,
  hexToRgba,
  Rectangle2d,
  type BaseShape,
  type DefaultColorStyle,
  type Geometry2d,
  type StyleWords,
  type UnknownShape,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { getFontFamily } from "./shape-theme"

export interface FrameShapeProps {
  w: number
  h: number
  name: string
  color?: DefaultColorStyle
}

export type FrameShape = BaseShape<"frame", FrameShapeProps>

export const FRAME_FILL = "#ffffff"
export const FRAME_STROKE = "#9fa8b2"

export class FrameShapeUtil extends BaseBoxShapeUtil<FrameShape> {
  static override type = "frame" as const

  getDefaultProps(): FrameShapeProps {
    return { w: 160, h: 90, name: "" }
  }

  getGeometry(shape: FrameShape): Geometry2d {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override getRenderStyle(_shape: FrameShape): StyleWords {
    return { fill: hexToRgba(FRAME_FILL), stroke: hexToRgba(FRAME_STROKE), strokeWidth: 1, dash: 0, opacity: 1 }
  }

  component(shape: FrameShape): ReactNode {
    const { name, w } = shape.props
    return (
      <div
        style={{
          position: "absolute",
          top: -24,
          left: 0,
          maxWidth: w,
          height: 20,
          lineHeight: "20px",
          fontFamily: getFontFamily("sans"),
          fontSize: 12,
          color: "#5c6470",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          pointerEvents: "none",
        }}
      >
        {name || "Frame"}
      </div>
    )
  }

  indicator(shape: FrameShape): ReactNode {
    return <rect width={shape.props.w} height={shape.props.h} />
  }

  override hasOverlayLabel(_shape: FrameShape): boolean {
    return true
  }

  override canEdit(_shape: FrameShape): boolean {
    return true
  }

  override canReceiveNewChildrenOfType(_shape: FrameShape, _type: string): boolean {
    return true
  }

  override canDropShapes(_shape: FrameShape, _shapes: UnknownShape[]): boolean {
    return true
  }

  override getText(shape: FrameShape): string {
    return shape.props.name
  }
}
