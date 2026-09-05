import type { Geometry2d, VecLike } from "../geometry"
import { OverlayUtil } from "../indicators"
import { EditorManager } from "./EditorManager"
import type { Editor } from "./Editor"

/**
 * One thing an overlay wants drawn this frame.
 *
 * An overlay util is not one drawing — a snap-line util paints several lines, a
 * collaborator util one cursor per person. Each of those is an overlay, with an
 * id of its own so the manager can say which one the pointer is over.
 */
export interface TLOverlay {
  /** Unique within the util that produced it. */
  id: string
  /** The util's `type`, filled in by the manager. */
  type: string
  /** Page-space geometry, when this overlay can be pointed at. */
  geometry?: Geometry2d
  /** Cursor to show while the pointer is over it. */
  cursor?: string
  /** Anything the util needs to paint it. Opaque to the manager. */
  meta?: unknown
}

/** An overlay paired with the util that produced it. */
export interface OverlayEntry {
  util: OverlayUtil<Editor>
  overlay: TLOverlay
}

/** The documented spelling of {@link OverlayEntry}. */
export type TLOverlayEntry = OverlayEntry

/** A constructor the {@link OverlayManager} can register. */
export interface TLOverlayUtilConstructor<U extends OverlayUtil<Editor> = OverlayUtil<Editor>> {
  new (editor: Editor): U
  /** The id the util is registered under. */
  type: string
  /** Painting order; higher paints later, and so wins a hit test. Defaults to 0. */
  zIndex?: number
}

/** Any overlay util constructor, whatever it produces. */
export type TLAnyOverlayUtilConstructor = TLOverlayUtilConstructor<OverlayUtil<Editor>>

/**
 * The optional half of the overlay contract.
 *
 * {@link OverlayUtil} requires only `render`; everything a *pointable* overlay
 * also does — describing its geometry, saying whether it is active this frame,
 * taking a pointer down — is optional, so a util that just paints stays two
 * methods long. The manager asks for these by duck typing rather than widening
 * the base class, which would make every existing util incomplete.
 */
interface InteractiveOverlayUtil {
  isActive?(): boolean
  getOverlays?(): TLOverlay[]
  getGeometry?(overlay: TLOverlay): Geometry2d | undefined
  getCursor?(overlay: TLOverlay): string | undefined
  onPointerDown?(overlay: TLOverlay): void
  renderMinimap?(ctx: CanvasRenderingContext2D): void
  dispose?(): void
}

/**
 * The registry of canvas overlays.
 *
 * v5 draws the brush, the scribbles, the snap lines, the handles and the shape
 * indicators into one 2D canvas above the scene rather than as React elements.
 * This manager is what owns those painters: it holds the utils, decides the
 * order they paint in, and answers which overlay the pointer is over — the
 * thing a tool needs in order to let a click land on a handle rather than on
 * the shape behind it.
 *
 * Reach it as `editor.overlays`. Utils are ordinary {@link OverlayUtil}
 * subclasses; register them at construction or with {@link register}.
 */
export class OverlayManager extends EditorManager {
  private readonly utils = new Map<string, OverlayUtil<Editor>>()
  private readonly order: string[] = []
  private hoveredId: string | null = null

  constructor(editor: Editor, utils: readonly TLAnyOverlayUtilConstructor[] = []) {
    super(editor)
    for (const Util of utils) this.registerUtil(Util)
  }

  /**
   * Add an overlay util. Registering a `type` that is already present replaces
   * it — which is how an app overrides one of the built-ins — and disposes the
   * one it displaced.
   */
  registerUtil(Util: TLAnyOverlayUtilConstructor): OverlayUtil<Editor> {
    const existing = this.utils.get(Util.type)
    if (existing) (existing as InteractiveOverlayUtil).dispose?.()
    else this.order.push(Util.type)
    const util = new Util(this.editor)
    this.utils.set(Util.type, util)
    this.sort()
    return util
  }

  /** Remove an overlay util by type. */
  unregisterUtil(type: string): void {
    const util = this.utils.get(type)
    if (!util) return
    ;(util as InteractiveOverlayUtil).dispose?.()
    this.utils.delete(type)
    const at = this.order.indexOf(type)
    if (at >= 0) this.order.splice(at, 1)
    if (this.hoveredId?.startsWith(`${type}:`)) this.hoveredId = null
  }

  /** The util registered under `type`, or `undefined`. */
  getOverlayUtil<U extends OverlayUtil<Editor> = OverlayUtil<Editor>>(type: string): U | undefined {
    return this.utils.get(type) as U | undefined
  }

  /**
   * Every util, back to front. Painting in this order and hit-testing in the
   * reverse of it is what makes the topmost overlay the one you click.
   */
  getOverlayUtilsInZOrder(): OverlayUtil<Editor>[] {
    return this.order.map((type) => this.utils.get(type)!).filter(Boolean)
  }

  /**
   * The overlays that want drawing right now, back to front.
   *
   * A util that says it is not active contributes nothing, and one that names
   * no overlays contributes a single implicit overlay with its own type as the
   * id — enough for a util that only paints and is never pointed at.
   */
  getCurrentOverlays(): TLOverlay[] {
    return this.getActiveOverlayEntries().map((entry) => entry.overlay)
  }

  /** The same, paired with the util each one came from. */
  getActiveOverlayEntries(): OverlayEntry[] {
    const out: OverlayEntry[] = []
    for (const util of this.getOverlayUtilsInZOrder()) {
      const interactive = util as unknown as InteractiveOverlayUtil
      if (interactive.isActive && !interactive.isActive()) continue
      const overlays = interactive.getOverlays?.()
      if (!overlays) {
        out.push({ util, overlay: { id: util.type, type: util.type } })
        continue
      }
      for (const overlay of overlays) out.push({ util, overlay: { ...overlay, type: util.type } })
    }
    return out
  }

  /** The geometry an overlay can be pointed at through, if it has any. */
  getOverlayGeometry(overlay: TLOverlay): Geometry2d | undefined {
    const util = this.utils.get(overlay.type)
    if (!util) return undefined
    return (util as unknown as InteractiveOverlayUtil).getGeometry?.(overlay) ?? overlay.geometry
  }

  /**
   * The topmost overlay under a page-space point, or `undefined`.
   *
   * Front-to-back, so the overlay painted last is the one that answers — the
   * same rule the eye applies.
   */
  getOverlayAtPoint(point: VecLike, margin = 0): OverlayEntry | undefined {
    const entries = this.getActiveOverlayEntries()
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!
      const geometry = this.getOverlayGeometry(entry.overlay)
      if (geometry?.hitTestPoint(point, margin, true)) return entry
    }
    return undefined
  }

  /** Id of the hovered overlay, or `null`. */
  getHoveredOverlayId(): string | null {
    return this.hoveredId
  }

  /** The hovered overlay, or `undefined` when nothing is hovered. */
  getHoveredOverlay(): TLOverlay | undefined {
    if (this.hoveredId === null) return undefined
    return this.getCurrentOverlays().find((overlay) => overlay.id === this.hoveredId)
  }

  /** Set (or clear, with `null`) the hovered overlay. */
  setHoveredOverlay(overlay: TLOverlay | string | null): this {
    this.hoveredId = overlay === null ? null : typeof overlay === "string" ? overlay : overlay.id
    return this
  }

  /**
   * Paint every active overlay into `ctx`, back to front.
   *
   * `ctx` arrives in screen space; applying the camera is each util's own job,
   * because some overlays live in screen space (a handle, a brush outline) and
   * some in page space (a shape indicator).
   */
  render(ctx: CanvasRenderingContext2D): void {
    for (const util of this.getOverlayUtilsInZOrder()) {
      const interactive = util as unknown as InteractiveOverlayUtil
      if (interactive.isActive && !interactive.isActive()) continue
      util.render(ctx)
    }
  }

  /** The minimap pass: only utils that opt in by implementing `renderMinimap`. */
  renderMinimap(ctx: CanvasRenderingContext2D): void {
    for (const util of this.getOverlayUtilsInZOrder()) {
      ;(util as unknown as InteractiveOverlayUtil).renderMinimap?.(ctx)
    }
  }

  override dispose(): void {
    for (const util of this.utils.values()) (util as unknown as InteractiveOverlayUtil).dispose?.()
    this.utils.clear()
    this.order.length = 0
    this.hoveredId = null
    super.dispose()
  }

  /** Keep `order` in `zIndex` order, ties broken by registration order. */
  private sort(): void {
    const zOf = (type: string): number => {
      const util = this.utils.get(type)
      const ctor = util?.constructor as { zIndex?: number } | undefined
      return ctor?.zIndex ?? 0
    }
    const registered = new Map(this.order.map((type, i) => [type, i]))
    this.order.sort((a, b) => zOf(a) - zOf(b) || registered.get(a)! - registered.get(b)!)
  }
}
