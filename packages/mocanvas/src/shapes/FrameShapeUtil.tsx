import {
  BaseFrameLikeShapeUtil,
  hexToRgba,
  Rectangle2d,
  type BaseShape,
  type DefaultColorStyle,
  type Geometry2d,
  type StyleWords,
} from "@mocanvas/editor"
import type { ReactNode } from "react"
import { TextLabel } from "../text/TextEditor"
import { propsOf, readNumber, readString } from "./prop-access"
import {
  FRAME_FILL,
  FRAME_NAME_COLOR,
  FRAME_NAME_FONT_SIZE,
  FRAME_NAME_HEIGHT,
  FRAME_NAME_OFFSET,
  FRAME_STROKE,
  FRAME_STROKE_WIDTH,
} from "./shape-theme"
import { rectPath } from "./indicator-paths"

export interface FrameShapeProps {
  w: number
  h: number
  name: string
  color?: DefaultColorStyle
}

export type FrameShape = BaseShape<"frame", FrameShapeProps>

/**
 * The artboard: a container that both groups and **crops**.
 *
 * Everything that makes it a container — adoption on drag-in, release on
 * drag-out, the lock gates, the ancestor-cycle guard — comes from
 * {@link BaseFrameLikeShapeUtil}; the frame itself only adds its chrome (the
 * body fill, the editable name strip) and keeps the base's clipping box.
 */
export class FrameShapeUtil extends BaseFrameLikeShapeUtil<FrameShape> {
  static override type = "frame" as const

  getDefaultProps(): FrameShapeProps {
    return { w: 160, h: 90, name: "" }
  }

  getGeometry(shape: FrameShape): Geometry2d {
    const p = propsOf(shape)
    return new Rectangle2d({ width: readNumber(p, "w", 160), height: readNumber(p, "h", 90), isFilled: true })
  }

  override getRenderStyle(_shape: FrameShape): StyleWords {
    return { fill: hexToRgba(FRAME_FILL), stroke: hexToRgba(FRAME_STROKE), strokeWidth: FRAME_STROKE_WIDTH, dash: 0, opacity: 1 }
  }

  component(shape: FrameShape): ReactNode {
    const p = propsOf(shape)
    const name = readString(p, "name", "")
    const w = readNumber(p, "w", 160)
    return (
      <div
        style={{
          position: "absolute",
          top: -FRAME_NAME_OFFSET,
          left: 0,
          width: w,
          height: FRAME_NAME_HEIGHT,
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
          height={FRAME_NAME_HEIGHT}
          placeholder="Frame"
          singleLine
          onChange={(next) => this.editor.updateShape<FrameShape>({ id: shape.id, type: "frame", props: { name: next } })}
        />
      </div>
    )
  }

  override getIndicatorPath(shape: FrameShape): Path2D {
    const p = propsOf(shape)
    return rectPath(readNumber(p, "w", 160), readNumber(p, "h", 90))
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

  override getText(shape: FrameShape): string {
    return readString(propsOf(shape), "name", "")
  }

  override onEditEnd(shape: FrameShape): void {
    const name = readString(propsOf(shape), "name", "")
    const trimmed = name.trim()
    if (trimmed !== name) this.editor.updateShape<FrameShape>({ id: shape.id, type: "frame", props: { name: trimmed } })
  }
}
