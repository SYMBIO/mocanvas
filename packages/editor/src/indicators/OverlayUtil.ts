/**
 * The seam the v5 canvas overlays hang off.
 *
 * v5 replaces the React overlay components (brush, scribble, snap lines,
 * handles, indicators) with utils that paint into one 2D canvas layered over
 * the scene. mocanvas ships only {@link ShapeIndicatorOverlayUtil} today — that
 * is the one the consumer overrides — but every overlay it grows later is the
 * same shape: construct with the editor, answer `render(ctx)`.
 *
 * Keeping the base class here now means adding the rest is additive: an
 * `OverlayManager` iterating `OverlayUtil[]` can be introduced without changing
 * anything an app already wrote.
 */

/** What an overlay util needs from the host. Structural so tests can pass a stub. */
export interface OverlayHost {
  /** Camera zoom, used to keep screen-space measurements zoom-independent. */
  getZoomLevel(): number
}

/**
 * Base class for a canvas overlay.
 *
 * `render` is called once per frame with a context whose transform is already
 * the *screen* transform (device pixels, y down, origin at the canvas corner).
 * Applying the camera is the util's own job, because some overlays (a brush, a
 * handle) live in screen space and some (an indicator) live in page space.
 */
export abstract class OverlayUtil<H extends OverlayHost = OverlayHost> {
  /** The id this overlay is registered under. */
  static type: string

  constructor(readonly editor: H) {}

  get type(): string {
    return (this.constructor as typeof OverlayUtil).type
  }

  /** Paint this overlay. Implementations must leave `ctx` in the state they found it. */
  abstract render(ctx: CanvasRenderingContext2D): void
}
