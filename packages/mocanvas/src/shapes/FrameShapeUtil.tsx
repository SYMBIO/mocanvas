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
import { TextLabel } from "../text/TextEditor"

export interface FrameShapeProps {
  w: number
  h: number
  name: string
  color?: DefaultColorStyle
}

export type FrameShape = BaseShape<"frame", FrameShapeProps>

export const FRAME_FILL = "#ffffff"
export const FRAME_STROKE = "#9fa8b2"
const FRAME_NAME_COLOR = "#5c6470"
const FRAME_NAME_FONT_SIZE = 12
const FRAME_NAME_OFFSET = 24

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
          top: -FRAME_NAME_OFFSET,
          left: 0,
          width: w,
          height: FRAME_NAME_OFFSET - 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          pointerEvents: "none",
        }}
      >
        <TextLabel
          shape={shape}
          text={name}
          isEditing={this.editor.getEditingShapeId() === shape.id}
          font="sans"
          fontSize={FRAME_NAME_FONT_SIZE}
          color={FRAME_NAME_COLOR}
          align="start"
          verticalAlign="end"
          wrap={false}
          width={w}
          height={FRAME_NAME_OFFSET - 4}
          placeholder="Frame"
          singleLine
          onChange={(next) => this.editor.updateShape<FrameShape>({ id: shape.id, type: "frame", props: { name: next } })}
        />
      </div>
    )
  }

  indicator(shape: FrameShape): ReactNode {
    return <rect width={shape.props.w} height={shape.props.h} />
  }

  /** The GPU draws the frame body while its name is edited. */
  override needsOverlay(_shape: FrameShape): boolean {
    return false
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

  override onEditEnd(shape: FrameShape): void {
    const trimmed = shape.props.name.trim()
    if (trimmed !== shape.props.name) this.editor.updateShape<FrameShape>({ id: shape.id, type: "frame", props: { name: trimmed } })
  }
}
