import { Rectangle2d, ShapeUtil, type BaseShape, type Geometry2d, type StyleWords, type TLIndicatorPath } from "@mocanvas/editor"
import { boxPath } from "./indicator-paths"

/** Dash pattern of a group's outline, in screen px: 4 on, 4 off. */
const GROUP_INDICATOR_DASH = [4, 4] as const

export type GroupShape = BaseShape<"group", Record<string, never>>

/** A container with no visuals of its own; its bounds are the union of its children. */
export class GroupShapeUtil extends ShapeUtil<GroupShape> {
  static override type = "group" as const

  getDefaultProps(): GroupShape["props"] {
    return {}
  }

  getGeometry(shape: GroupShape): Geometry2d {
    const editor = this.editor
    const children = editor.getSortedChildIdsForParent(shape.id)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const id of children) {
      const child = editor.getShape(id)
      if (!child) continue
      const b = editor.getShapeGeometryBounds(child)
      if (!b) continue
      // child bounds in group space
      for (const c of b.corners) {
        const r = child.rotation
        const x = child.x + c.x * Math.cos(r) - c.y * Math.sin(r)
        const y = child.y + c.x * Math.sin(r) + c.y * Math.cos(r)
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    if (!Number.isFinite(minX)) return new Rectangle2d({ width: 1, height: 1, isFilled: false })
    return new Rectangle2d({ x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), isFilled: false })
  }

  override getRenderStyle(_shape: GroupShape): StyleWords {
    // Invisible on the GPU; hit-testing goes through children.
    return { fill: 0, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }

  override canResize(): boolean {
    return false
  }
  override hideResizeHandles(): boolean {
    return true
  }
  override hideSelectionBoundsBg(): boolean {
    return true
  }
  override canReceiveNewChildrenOfType(): boolean {
    return true
  }

  component() {
    return null
  }

  /** Dashed, so a group's outline is never mistaken for a shape of its own. */
  override getIndicatorPath(shape: GroupShape): TLIndicatorPath {
    return { path: boxPath(this.getGeometry(shape).bounds), lineDash: GROUP_INDICATOR_DASH }
  }
}
