/**
 * Keeps the DOM elements that shape utils hand over through
 * {@link ShapeUtil.getContentElement} alive for longer than the React tree that
 * displays them.
 */
import type { ShapeId, UnknownShape } from "../records/base"

/** The half of a shape util this manager needs. Structural, so it is testable without an `Editor`. */
export interface ContentElementSource {
  getContentElement?(shape: UnknownShape): HTMLElement | undefined
  onReleaseContentElement?(shape: UnknownShape, element: HTMLElement): void
}

/** What the manager needs from the editor: a way to find a shape's util. */
export interface ContentElementHost {
  getShapeUtil(shape: UnknownShape): ContentElementSource
}

interface Entry {
  element: HTMLElement
  /** The last shape we saw, handed back to `onReleaseContentElement`. */
  shape: UnknownShape
}

/**
 * One element per shape, for as long as the shape exists.
 *
 * A shape's content element is created the first time it is asked for and is
 * then *the same node* for the life of the shape: mounting it somewhere else
 * moves it, which is what lets an iframe keep its session across a re-render,
 * a scroll out of view, or an unmount and remount of the whole editor UI. It
 * is torn down only when the shape is deleted or the editor is disposed —
 * both of which route through {@link release}.
 *
 * A util that does not implement `getContentElement` never appears here at all.
 */
export class ContentElementManager {
  private readonly entries = new Map<ShapeId, Entry>()

  constructor(private readonly host: ContentElementHost) {}

  /**
   * This shape's content element, creating it on first use. `undefined` when
   * the shape's util does not have one to give — the common case.
   */
  get(shape: UnknownShape): HTMLElement | undefined {
    const existing = this.entries.get(shape.id)
    if (existing) {
      // Keep the shape fresh so a release hands back something current.
      existing.shape = shape
      return existing.element
    }
    const util = this.host.getShapeUtil(shape)
    const element = util.getContentElement?.(shape)
    if (!element) return undefined
    this.entries.set(shape.id, { element, shape })
    return element
  }

  /** Whether this shape currently holds an element. */
  has(id: ShapeId): boolean {
    return this.entries.has(id)
  }

  /**
   * Give up this shape's element: detach it from wherever it is mounted and
   * tell the util it is gone. A no-op for a shape that never had one.
   */
  release(id: ShapeId): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    entry.element.remove()
    // FAIL-SOFT: one util throwing on the way out must not strand every other
    // element — release is called in a loop from `dispose()`.
    try {
      this.host.getShapeUtil(entry.shape).onReleaseContentElement?.(entry.shape, entry.element)
    } catch {
      // The util's teardown is its own problem; ours is not to leak the map.
    }
  }

  /** Release everything. Called when the editor is disposed. */
  dispose(): void {
    for (const id of [...this.entries.keys()]) this.release(id)
  }
}
