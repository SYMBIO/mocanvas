/**
 * Scribbles: the fading trails a laser pointer, an eraser or a lasso leaves
 * behind.
 *
 * The animation is not here. `ScribbleManager` owns the points and sheds them
 * on a tick; this util only paints whatever is in the instance record right
 * now, which is what lets a local scribble and a collaborator's scribble be
 * drawn by the same code from two different sources.
 */
import {
  getOverlayDisplayValues,
  OverlayUtil,
  type Editor,
  type Geometry2d,
  type OverlayOptionsWithDisplayValues,
  type Scribble,
  type TLColorMode,
  type TLTheme,
} from "@mocanvas/editor"
import { traceTaperedStroke, withCamera } from "./paint"
import type { TLScribbleOverlay } from "./types"

/** The paint a scribble falls back to when its record does not name a colour. */
export interface ScribbleOverlayUtilDisplayValues {
  /** Colour for a scribble whose `color` is a theme token rather than CSS. */
  color: string
}

/** How scribbles are drawn. */
export interface ScribbleOverlayUtilOptions
  extends OverlayOptionsWithDisplayValues<ScribbleOverlayUtilDisplayValues> {
  /**
   * Whether to honour a scribble's `taper`. Turning it off draws every stroke
   * at a constant width, which is what an eraser wants and a laser does not.
   */
  taper: boolean
}

/**
 * Resolve one scribble's colour.
 *
 * A `Scribble.color` is documented as "a theme colour name or a CSS colour",
 * and the two are told apart the only way they can be: a name that the theme
 * knows about wins, anything else is handed to the canvas as-is. `accent` — the
 * manager's default — is not a palette entry, so it maps to the selection
 * stroke, which is the colour a laser is expected to be.
 */
export function resolveScribbleColor(color: string, theme: TLTheme, colorMode: TLColorMode): string {
  const colors = theme.colors[colorMode]
  if (color === "accent") return colors.selectStroke
  const entry = colors[color]
  if (typeof entry === "string") return entry
  if (entry && typeof entry === "object" && typeof entry.solid === "string") return entry.solid
  return color
}

/** The default scribble paint: taper on, colours from the theme. */
export const DEFAULT_SCRIBBLE_OVERLAY_OPTIONS: ScribbleOverlayUtilOptions = {
  taper: true,
  getDefaultDisplayValues: (_editor, theme, colorMode) => ({
    color: theme.colors[colorMode].selectStroke,
  }),
}

/**
 * Paints every live scribble.
 *
 * Scribbles are stroked as *ribbons*, not lines: a trail that thins to a point
 * cannot be produced by `ctx.stroke`, which has one width for the whole path.
 * See {@link traceTaperedStroke}.
 */
export class ScribbleOverlayUtil extends OverlayUtil<Editor, ScribbleOverlayUtilOptions> {
  static override type = "scribble"
  static override zIndex = 30
  static override options: ScribbleOverlayUtilOptions = DEFAULT_SCRIBBLE_OVERLAY_OPTIONS

  /** The scribbles to draw. Overridden by the collaborator variant. */
  protected getScribbles(): Scribble[] {
    return this.editor.getInstanceState().scribbles
  }

  override isActive(): boolean {
    return this.getScribbles().length > 0
  }

  override getOverlays(): TLScribbleOverlay[] {
    return this.getScribbles().map((scribble) => ({
      id: scribble.id,
      type: "scribble" as const,
      scribble,
    }))
  }

  /** A scribble is decoration in flight; nothing should be able to click it. */
  override getGeometry(): Geometry2d | undefined {
    return undefined
  }

  override render(ctx: CanvasRenderingContext2D): void {
    const overlays = this.getOverlays()
    if (overlays.length === 0) return
    const camera = this.editor.getCamera()
    const theme = this.editor.theme.getCurrentTheme()
    const colorMode = this.editor.theme.getColorMode()
    const fallback = getOverlayDisplayValues<ScribbleOverlayUtilDisplayValues>(this).color
    const taperEnabled = this.options.taper
    withCamera(ctx, camera, (c) => {
      for (const { scribble } of overlays) {
        if (scribble.points.length < 2) continue
        c.globalAlpha = scribble.opacity
        c.fillStyle = scribble.color ? resolveScribbleColor(scribble.color, theme, colorMode) : fallback
        traceTaperedStroke(c, scribble.points, scribble.size, taperEnabled && scribble.taper)
        c.fill()
      }
      c.globalAlpha = 1
    })
  }
}
