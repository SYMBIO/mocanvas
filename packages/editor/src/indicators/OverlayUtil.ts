/**
 * The seam the v5 canvas overlays hang off.
 *
 * v5 replaces the React overlay components (brush, scribble, snap lines,
 * handles, indicators) with utils that paint into one 2D canvas layered over
 * the scene. {@link OverlayManager} owns them; this is the base every one of
 * them extends — construct with the editor, answer `render(ctx)`.
 *
 * Only `render` is required. Everything a *pointable* overlay also does —
 * naming its overlays, describing their geometry, saying whether it is active
 * this frame, taking a pointer down — is declared optional here rather than
 * abstract, so a util that only paints stays two members long and the manager
 * can tell "did not implement" from "implemented and answered nothing".
 */
import type { Geometry2d } from "../geometry"
import type { OverlayOptionsWithDisplayValues } from "./overlayDisplayValues"

/** What an overlay util needs from the host. Structural so tests can pass a stub. */
export interface OverlayHost {
  /** Camera zoom, used to keep screen-space measurements zoom-independent. */
  getZoomLevel(): number
}

/**
 * The minimum an overlay record has to carry for the base class to talk about
 * it without importing {@link TLOverlay} from the editor directory — which
 * would be a cycle, since the overlay manager imports this file.
 */
export interface OverlayLike {
  id: string
  type: string
}

/**
 * Base class for a canvas overlay.
 *
 * `render` is called once per frame with a context whose transform is already
 * the *screen* transform (CSS pixels, y down, origin at the canvas corner —
 * the device-pixel ratio is applied by the host). Applying the camera is the
 * util's own job, because some overlays (a brush, a handle) live in screen
 * space and some (an indicator) live in page space.
 *
 * The two type arguments are the host it reads from and the shape of its
 * static `options`. Options live on the *class*, not the instance, so that
 * {@link OverlayUtil.configure} can hand back a restyled subclass which is
 * still a constructor the manager can register.
 */
export abstract class OverlayUtil<H extends OverlayHost = OverlayHost, O extends object = object> {
  /** The id this overlay is registered under. */
  static type: string

  /**
   * Painting order; higher paints later, and so wins a hit test. A util that
   * says nothing paints at 0, in registration order.
   */
  static zIndex?: number

  /**
   * Configuration for this class. A subclass narrows the type by redeclaring
   * it; {@link configure} replaces it wholesale on a fresh subclass.
   */
  static options: object = {}

  constructor(readonly editor: H) {}

  /**
   * A subclass of this util with different options.
   *
   * Returns a *class*, not an instance, because overlay utils are registered by
   * constructor: `overlayUtils: [BrushOverlayUtil.configure({ lineWidth: 2 })]`.
   * Omitted keys keep the value they had, so configuring a subclass twice
   * layers rather than resets, and the class it was called on is untouched.
   */
  static configure<T extends { options: object }>(this: T, options: Partial<T["options"]>): T {
    const merged = { ...(this as { options: object }).options, ...options }
    // `this` is cast to a bare constructor because a *class expression* cannot
    // be abstract, and extending the abstract base directly would make this one
    // an illegal concrete class. The statics still chain at runtime, and the
    // cast on the way out restores the type the caller asked for.
    const base = this as unknown as new (editor: never) => object
    return class extends base {
      static options = merged
    } as unknown as T
  }

  get type(): string {
    return (this.constructor as typeof OverlayUtil).type
  }

  /** This util's options, read off the class it was constructed from. */
  get options(): O {
    return (this.constructor as unknown as { options: O }).options
  }

  /**
   * Paint this overlay. Implementations must leave `ctx` in the state they
   * found it.
   *
   * `overlays` is what {@link getOverlays} returned this frame, handed over so
   * a subclass can paint a subset and delegate the rest:
   *
   * ```ts
   * override render(ctx: CanvasRenderingContext2D, overlays = this.getOverlays()) {
   *   const [mine, theirs] = partition(overlays, isMine)
   *   this.paintMine(ctx, mine)
   *   super.render(ctx, theirs)
   * }
   * ```
   *
   * Without it the only way to narrow what gets painted was to override
   * `getOverlays()` — which also narrows what hit-testing, the cursor lookup
   * and `onPointerDown` see, for every caller and not just the painter.
   *
   * A util that ignores the parameter is unaffected: a one-argument `render`
   * still satisfies this signature, and the manager passes what it already
   * computed either way.
   */
  abstract render(ctx: CanvasRenderingContext2D, overlays?: OverlayLike[]): void

  /**
   * Whether this util has anything to contribute this frame. A util that does
   * not implement it is always active.
   */
  isActive?(): boolean

  /**
   * The individual overlays this util is drawing — one per snap line, one per
   * collaborator cursor, one per handle. A util that does not implement it
   * counts as a single overlay named after its own type, which is all a
   * paint-only util ever needs.
   */
  getOverlays?(): OverlayLike[]

  /** Page-space geometry an overlay can be pointed at through, if any. */
  getGeometry?(overlay: OverlayLike): Geometry2d | undefined

  /** Cursor to show while the pointer is over this overlay. */
  getCursor?(overlay: OverlayLike): string | undefined

  /** The pointer went down on this overlay. */
  onPointerDown?(overlay: OverlayLike): void

  /** The minimap pass. Only utils that opt in by implementing it are called. */
  renderMinimap?(ctx: CanvasRenderingContext2D): void

  /** Release anything held. Called when the util is replaced or the editor closes. */
  dispose?(): void
}

/**
 * The options shape of an overlay util that resolves paint from the theme —
 * the common case, and the reason {@link OverlayOptionsWithDisplayValues} is
 * re-exported through this module's barrel next to the class it configures.
 */
export type OverlayUtilOptions<D extends object = object> = OverlayOptionsWithDisplayValues<D>
