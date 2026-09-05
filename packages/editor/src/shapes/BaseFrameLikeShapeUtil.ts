/**
 * The container base class: frames, artboards, sections, phases — anything that
 * adopts the shapes dragged onto it and carries them when it moves.
 */
import type { UnknownShape } from "../records/base"
import type { VecLike } from "../geometry"
import { BaseBoxShapeUtil } from "./ShapeUtil"

/** A box shape, as far as this base class is concerned. */
export type FrameLikeShape = UnknownShape & { props: { w: number; h: number } }

/**
 * Container behaviour, complete, for a `w`/`h` shape.
 *
 * What you get by extending it: the shape answers {@link ShapeUtil.isFrameLike}
 * `true`, clips its descendants to its own box, admits and releases children
 * unless it is locked, and reparents shapes dragged in and out — including the
 * ancestor-cycle guard that stops a container being dropped into its own
 * descendant.
 *
 * What a subclass typically changes:
 *
 * - `getClipPath` → `undefined` turns an artboard into a *region*: it still
 *   groups, but stops cropping what hangs over its edge. Clipping is derived
 *   from this method, so the one override is enough.
 * - `canReceiveNewChildrenOfType` narrows what may be dropped in.
 * - `canRemoveChildrenOfType` is separate on purpose, so admission can be
 *   strict while removal stays permissive.
 */
export abstract class BaseFrameLikeShapeUtil<T extends FrameLikeShape = FrameLikeShape> extends BaseBoxShapeUtil<T> {
  override isFrameLike(_shape: T): boolean {
    return true
  }

  /** A container paints the surface its children sit on. */
  override providesBackgroundForChildren(_shape?: T): boolean {
    return true
  }

  /**
   * The container's own box, as a polygon. Return `undefined` to stop clipping.
   *
   * `shape` is optional to match the base signature — a subclass that clips
   * nothing overrides this with a no-argument method — and a call without it
   * has no box to describe.
   */
  override getClipPath(shape?: T): VecLike[] | undefined {
    if (shape === undefined) return undefined
    const { w, h } = shape.props
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ]
  }

  /**
   * Clipping is *derived* from {@link BaseFrameLikeShapeUtil.getClipPath}, so a
   * subclass that returns `undefined` from that one method stops cropping
   * without having to know this hook exists.
   */
  override isClipShape(shape: T): boolean {
    return this.getClipPath(shape) !== undefined
  }

  override canReceiveNewChildrenOfType(shape: T, _type: string): boolean {
    return !shape.isLocked
  }

  override canRemoveChildrenOfType(shape: T, _type: string): boolean {
    return !shape.isLocked
  }

  override canDropShapes(shape: T, _shapes: UnknownShape[]): boolean {
    return !shape.isLocked
  }

  /**
   * Adopt the shapes dragged onto this container.
   *
   * A shape is adopted only if the container admits its type, the shape is not
   * locked, and the container is not one of the shape's own descendants —
   * reparenting into a descendant would make a cycle in the shape tree.
   */
  override onDragShapesIn(shape: T, shapes: UnknownShape[]): void {
    const adopt = shapes.filter((child) => this.canAdopt(shape, child))
    if (adopt.length === 0) return
    this.editor.reparentShapes(
      adopt.map((s) => s.id),
      shape.id,
    )
  }

  /** Release the shapes dragged out of this container, back onto the container's own parent. */
  override onDragShapesOut(shape: T, shapes: UnknownShape[]): void {
    const release = shapes.filter((child) => child.parentId === shape.id && this.canRemoveChildrenOfType(shape, child.type))
    if (release.length === 0) return
    this.editor.reparentShapes(
      release.map((s) => s.id),
      shape.parentId,
    )
  }

  /** Whether `child` may become a child of `shape`. @see onDragShapesIn */
  protected canAdopt(shape: T, child: UnknownShape): boolean {
    if (child.id === shape.id) return false
    if (child.isLocked) return false
    if (!this.canReceiveNewChildrenOfType(shape, child.type)) return false
    // The cycle guard: `shape` sitting anywhere under `child` means adopting
    // `child` would make `shape` its own ancestor.
    return !this.editor.getShapeAncestors(shape).some((a) => a.id === child.id)
  }
}
