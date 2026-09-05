/**
 * The shape indicator overlay, as the SDK exposes it.
 *
 * In 5.2 `ShapeIndicatorOverlayUtil` and `TLShapeIndicatorOverlay` stopped being
 * part of the editor package and became part of the SDK package — this one.
 *
 * Only the *names* could make the whole trip. `<Canvas>` in `@mocanvas/editor`
 * still has to draw selection outlines for an app that depends on the editor
 * alone, and the editor cannot import the package that depends on it, so the
 * machinery stays there as `ShapeIndicatorCompositor` (together with
 * `OverlayUtil`, `TLIndicatorPath` and `getShapeIndicatorPath`, which are the
 * extension seam a custom shape writes against). What lives here is the class
 * an app registers and configures, and the record type its `getIndicators()`
 * hands back.
 */
import { ShapeIndicatorCompositor, type TLIndicatorHost, type TLIndicatorOverlay } from "@mocanvas/editor"

/**
 * Paints every selection, hover and drop-target outline onto the canvas overlay
 * in a single pass.
 *
 * Register it — or a configured subclass — as an overlay util:
 *
 * ```ts
 * <Mocanvas overlayUtils={[ShapeIndicatorOverlayUtil.configure({ lineWidth: 2 })]} />
 * ```
 *
 * Override `shouldShowIndicator` to control *which* shapes get an outline;
 * anything finer belongs in a shape util's `getIndicatorPath`.
 */
export class ShapeIndicatorOverlayUtil<
  H extends TLIndicatorHost = TLIndicatorHost,
> extends ShapeIndicatorCompositor<H> {}

/**
 * One resolved indicator: the paths to stroke, the page transform to stroke
 * them under, and the paint to use.
 *
 * Produced by {@link ShapeIndicatorOverlayUtil.getIndicators}.
 */
export type TLShapeIndicatorOverlay = TLIndicatorOverlay
