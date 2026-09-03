import {
  BindingUtil,
  Vec,
  type BaseBinding,
  type BindingOnShapeChangeOptions,
  type BindingOnShapeDeleteOptions,
  type BindingOnShapeIsolateOptions,
  type VecLike,
} from "@mocanvas/editor"
import type { ArrowShape } from "../shapes/ArrowShapeUtil"
import { getArrowTerminalsInArrowSpace } from "./arrow-terminals"

export type ArrowTerminal = "start" | "end"

/**
 * Props of an `arrow` binding. The record layout matches what `.tldr` files
 * store for arrow bindings so documents round-trip.
 */
export interface ArrowBindingProps {
  /** Which end of the arrow (`fromId`) is attached to the bound shape (`toId`). */
  terminal: ArrowTerminal
  /** Anchor inside the bound shape's geometry bounds, normalized to `[0, 1]`. */
  normalizedAnchor: { x: number; y: number }
  /** When true the terminal sits exactly on the anchor instead of on the shape's outline. */
  isExact: boolean
  /** When true the anchor was placed deliberately (Alt or a lingering drag) rather than snapped to the center. */
  isPrecise: boolean
}

export type ArrowBinding = BaseBinding<"arrow", ArrowBindingProps>

const EPS = 1e-6

function samePoint(a: VecLike, b: VecLike): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
}

/**
 * Keeps arrows attached to the shapes their terminals are bound to.
 *
 * - When the bound shape changes, the arrow is rewritten so its geometry is
 *   re-derived (and its static fallback stays current).
 * - When the bound shape goes away, or the binding is deleted with
 *   `isolateShapes`, the terminal is frozen at its current page position.
 */
export class ArrowBindingUtil extends BindingUtil<ArrowBinding> {
  static override type = "arrow" as const

  getDefaultProps(): ArrowBindingProps {
    return { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
  }

  override onAfterChangeToShape({ binding }: BindingOnShapeChangeOptions<ArrowBinding>): void {
    this.refreshArrow(binding)
  }

  override onAfterChangeFromShape({ binding, shapeBefore, shapeAfter }: BindingOnShapeChangeOptions<ArrowBinding>): void {
    // Moving the arrow itself does not change where its bound terminal resolves
    // to in page space; only a re-parent changes the arrow's local frame.
    if (shapeBefore.parentId !== shapeAfter.parentId) this.refreshArrow(binding)
  }

  override onBeforeDeleteToShape({ binding }: BindingOnShapeDeleteOptions<ArrowBinding>): void {
    this.freezeTerminal(binding)
  }

  override onBeforeIsolateFromShape({ binding }: BindingOnShapeIsolateOptions<ArrowBinding>): void {
    this.freezeTerminal(binding)
  }

  override onBeforeIsolateToShape({ binding }: BindingOnShapeIsolateOptions<ArrowBinding>): void {
    this.freezeTerminal(binding)
  }

  /** Write the resolved terminals into the arrow so its geometry is rebuilt. */
  private refreshArrow(binding: ArrowBinding): void {
    const arrow = this.editor.getShape<ArrowShape>(binding.fromId)
    if (!arrow || arrow.type !== "arrow") return
    const { start, end } = getArrowTerminalsInArrowSpace(this.editor, arrow)
    if (samePoint(start, arrow.props.start) && samePoint(end, arrow.props.end)) return
    this.editor.updateShape<ArrowShape>({ id: arrow.id, type: "arrow", props: { start: start.toJson(), end: end.toJson() } })
  }

  /**
   * Convert the bound terminal into a static point at its current resolved
   * position. Idempotent: calling it twice for the same binding is a no-op the
   * second time.
   */
  private freezeTerminal(binding: ArrowBinding): void {
    const arrow = this.editor.getShape<ArrowShape>(binding.fromId)
    if (!arrow || arrow.type !== "arrow") return
    if (!this.editor.getShape(binding.toId)) return
    const terminal = binding.props.terminal
    const resolved = getArrowTerminalsInArrowSpace(this.editor, arrow)[terminal]
    if (samePoint(resolved, arrow.props[terminal])) return
    this.editor.updateShape<ArrowShape>({ id: arrow.id, type: "arrow", props: { [terminal]: Vec.From(resolved).toJson() } })
  }
}
