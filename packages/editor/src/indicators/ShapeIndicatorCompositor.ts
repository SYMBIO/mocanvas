/**
 * The compositor for shape indicators: the canvas overlay that paints every
 * selection, hover and drop-target outline in one pass.
 */
import type { UnknownShape } from "../records/base"
import type { TLThemeHost } from "../theme/types"
import { OverlayUtil, type OverlayHost } from "./OverlayUtil"
import { getShapeIndicatorPath, type IndicatorPathSource } from "./resolve"
import type { TLIndicatorContext, TLIndicatorTransform, TLIndicatorOverlay } from "./types"

/** The subset of a shape util the compositor reads. */
export interface IndicatorShapeUtil extends IndicatorPathSource<UnknownShape> {
  hideSelectionBoundsFg?(shape: UnknownShape): boolean
}

/**
 * What the compositor needs from the editor. Structural rather than the
 * concrete `Editor` so the interesting half — which shapes, which weight,
 * which colour — can be tested without a store, an engine or a canvas.
 */
export interface TLIndicatorHost extends OverlayHost {
  getSelectedShapes(): UnknownShape[]
  getHoveredShape(): UnknownShape | undefined
  getHintingShapeIds(): readonly string[]
  getShape(id: string): UnknownShape | undefined
  getShapeUtil(shape: UnknownShape): IndicatorShapeUtil
  getShapePageTransform(shape: UnknownShape): TLIndicatorTransform
  getShapeGeometryBounds(shape: UnknownShape): { x: number; y: number; w: number; h: number } | undefined
  getInstanceState(): { isCoarsePointer: boolean }
  getCurrentToolId(): string
  getCamera(): { x: number; y: number; z: number }
  /** The live theme; the selection colour comes from it, never from this module. */
  theme: TLThemeHost
}

/** Stroke weights, in CSS pixels — the two numbers `configure` exists to change. */
export interface TLShapeIndicatorOptions {
  /** Weight of a selected or hovered outline. */
  lineWidth: number
  /** Weight of a hinted (drop-target) outline, drawn heavier so it reads as a target. */
  hintedLineWidth: number
}

/** The v5 defaults: 1.5 CSS px normally, 2.5 for a drop target. */
export const DEFAULT_SHAPE_INDICATOR_OPTIONS: TLShapeIndicatorOptions = {
  lineWidth: 1.5,
  hintedLineWidth: 2.5,
}

/**
 * Paints shape indicators onto the canvas overlay.
 *
 * This is the *engine*. The name the SDK exposes for it —
 * `ShapeIndicatorOverlayUtil` — lives in `@mocanvas/mocanvas`, which subclasses
 * this and adds nothing: 5.2 moved that class out of the editor package. The
 * implementation could not follow it, because `<Canvas>` here has to composite
 * indicators for an app that only ever depends on `@mocanvas/editor`, and the
 * editor cannot import the package that depends on it. So the seam and the
 * engine stay, and the exported name moves.
 *
 * Two override points, in ascending order of effort:
 *
 * - `ShapeIndicatorCompositor.configure({ lineWidth, hintedLineWidth })`
 *   returns a subclass with different stroke weights and nothing else changed.
 * - subclassing and overriding {@link ShapeIndicatorCompositor.shouldShowIndicator}
 *   controls *which* shapes get an outline at all — the hook for a board that
 *   reads selection through its own chrome instead of a stroke.
 *
 * Anything finer than that belongs in the shape util's `getIndicatorPath`.
 */
export class ShapeIndicatorCompositor<H extends TLIndicatorHost = TLIndicatorHost> extends OverlayUtil<
  H,
  TLShapeIndicatorOptions
> {
  static override type = "shapeIndicator"

  /**
   * Stroke weights for this class. Replaced wholesale on a fresh subclass by
   * the inherited {@link OverlayUtil.configure}:
   *
   * ```ts
   * overlayUtils: [ShapeIndicatorOverlayUtil.configure({ lineWidth: 2 })]
   * ```
   */
  static override options: TLShapeIndicatorOptions = DEFAULT_SHAPE_INDICATOR_OPTIONS

  /**
   * Whether this shape shows an outline in this context.
   *
   * The default hides nothing; a host that draws its own selection language
   * overrides this rather than teaching every shape util about the host.
   */
  shouldShowIndicator(_shape: UnknownShape, _context: TLIndicatorContext): boolean {
    return true
  }

  /** Stroke colour for a context. The selection colour of the live theme, for all three. */
  getIndicatorColor(_context: TLIndicatorContext): string {
    const theme = this.editor.theme.getCurrentTheme()
    return theme.colors[this.editor.theme.getColorMode()].selectStroke
  }

  /** Stroke weight for a context, in CSS pixels. */
  getIndicatorLineWidth(context: TLIndicatorContext): number {
    return context === "hinting" ? this.options.hintedLineWidth : this.options.lineWidth
  }

  /**
   * Every outline to draw this frame, hinted ones last so a drop target's
   * heavier stroke lands on top of the selection stroke of the same shape.
   *
   * Each shape appears at most once: a shape that is both selected and hinted
   * is drawn as hinted, because the gesture in flight is the more urgent fact.
   */
  getIndicators(): TLIndicatorOverlay[] {
    const editor = this.editor
    const out: TLIndicatorOverlay[] = []
    const claimed = new Set<string>()

    const push = (shape: UnknownShape, context: TLIndicatorContext): void => {
      if (claimed.has(shape.id)) return
      if (!this.shouldShowIndicator(shape, context)) return
      const util = editor.getShapeUtil(shape)
      let paths
      try {
        paths = getShapeIndicatorPath(util, shape, editor.getShapeGeometryBounds(shape))
      } catch {
        // FAIL-SOFT: one util throwing must not take the whole overlay down —
        // every other selected shape would lose its outline with it.
        return
      }
      if (!paths) return
      claimed.add(shape.id)
      out.push({
        shapeId: shape.id,
        context,
        transform: editor.getShapePageTransform(shape),
        paths,
        color: this.getIndicatorColor(context),
        lineWidth: this.getIndicatorLineWidth(context),
      })
    }

    for (const id of editor.getHintingShapeIds()) {
      const shape = editor.getShape(id)
      if (shape) push(shape, "hinting")
    }

    const selected = editor.getSelectedShapes()
    for (const shape of selected) {
      // A lone selected shape is allowed to suppress its own outline, which is
      // how a util that draws its own selection chrome opts out. With several
      // selected there is no other cue that a shape is in the set, so the
      // outline is drawn regardless.
      if (selected.length === 1 && editor.getShapeUtil(shape).hideSelectionBoundsFg?.(shape)) continue
      push(shape, "selected")
    }

    const hovered = editor.getHoveredShape()
    if (
      hovered &&
      editor.getCurrentToolId() === "select" &&
      // A coarse pointer has no hover: the "hover" is the finger that is about
      // to select, and outlining it flashes an outline on every tap.
      !editor.getInstanceState().isCoarsePointer
    ) {
      push(hovered, "hovered")
    }

    return out
  }

  /**
   * Stroke the indicators onto `ctx`.
   *
   * `ctx` arrives in device pixels. Everything below is expressed once, here,
   * so a util never has to think about it:
   *
   * - the camera transform maps page → device, so paths are drawn in the
   *   shape-local units the util wrote them in;
   * - `lineWidth` is divided by `zoom * dpr`'s page-space scale so a 1.5 stays
   *   1.5 CSS pixels at 10 % and at 800 % — the hairline that makes an
   *   indicator legible at every zoom;
   * - `clipPath` is installed even-odd before the outline is stroked, and
   *   removed again before `additionalPaths`.
   */
  override render(ctx: CanvasRenderingContext2D): void {
    const indicators = this.getIndicators()
    if (indicators.length === 0) return
    const cam = this.editor.getCamera()
    const zoom = cam.z || 1

    for (const indicator of indicators) {
      const { transform: m, paths } = indicator
      ctx.save()
      // page → screen, then shape-local → page.
      ctx.transform(zoom, 0, 0, zoom, cam.x * zoom, cam.y * zoom)
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f)
      ctx.strokeStyle = indicator.color
      ctx.lineWidth = indicator.lineWidth / zoom
      ctx.lineJoin = "round"
      ctx.lineCap = "round"
      // Dashes are given in CSS px for the same reason the width is, so they
      // have to be divided by the same zoom to survive the camera transform.
      if (paths.lineDash) ctx.setLineDash(paths.lineDash.map((d) => d / zoom))
      if (paths.clipPath) {
        ctx.save()
        ctx.clip(paths.clipPath, "evenodd")
        ctx.stroke(paths.path)
        ctx.restore()
      } else {
        ctx.stroke(paths.path)
      }
      for (const extra of paths.additionalPaths ?? []) ctx.stroke(extra)
      ctx.restore()
    }
  }
}
