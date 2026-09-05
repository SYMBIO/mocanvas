/**
 * Display values for canvas overlays.
 *
 * A shape resolves its paint through {@link getDisplayValues}: the util's style
 * props go in, real colours and widths come out, and the theme is read exactly
 * once. An overlay has the same problem without the shape — a brush, a snap
 * line and a collaborator cursor all have to pick a colour from the live theme
 * and a stroke weight from their options, and none of them should reach for a
 * literal.
 *
 * This is that function for overlays. The shape of the thing is deliberately
 * the same as the shape version, so an app that has learned one has learned
 * both: a util's `options.getDefaultDisplayValues` supplies the defaults, its
 * own `getCustomDisplayValues` overrides the parts it cares about, and the
 * merge happens against the theme the editor is *currently* painting with.
 */
import { DEFAULT_THEME } from "../theme/DEFAULT_THEME"
import type { TLColorMode, TLTheme, TLThemeHost } from "../theme/types"

/**
 * How an overlay util resolves its default paint.
 *
 * Takes no shape — an overlay is not attached to one — so the theme and the
 * colour mode are the whole input. `editor` is passed through untyped for the
 * same reason it is in the shape version: the editor package cannot name the
 * concrete `Editor` here without a cycle, and a util that needs it casts.
 */
export type TLGetDefaultOverlayDisplayValues<D extends object> = (
  editor: unknown,
  theme: TLTheme,
  colorMode: TLColorMode,
) => D

/**
 * The override point: return only the fields to change, or nothing to accept
 * the defaults wholesale.
 */
export type TLGetCustomOverlayDisplayValues<D extends object> = (
  editor: unknown,
  theme: TLTheme,
  colorMode: TLColorMode,
) => Partial<D> | undefined

/**
 * The half of an overlay util's `options` that concerns paint.
 *
 * An overlay's options interface extends this and adds whatever else it needs
 * (a handle radius, a dash length), which is why the display-value function is
 * optional here: an overlay with nothing theme-dependent to say simply omits it
 * and {@link getOverlayDisplayValues} answers with an empty object.
 */
export interface OverlayOptionsWithDisplayValues<D extends object = object> {
  /** Resolve this overlay's paint against a theme. */
  getDefaultDisplayValues?: TLGetDefaultOverlayDisplayValues<D> | undefined
}

/**
 * What {@link getOverlayDisplayValues} needs from an overlay util: the editor
 * it belongs to, its options, and its optional override.
 *
 * Structural, so a util fetched out of `editor.overlays` by type string — which
 * has lost its display-value type by then — still fits.
 */
export interface TLOverlayDisplayValuesSource<D extends object = object> {
  editor: unknown
  options?: OverlayOptionsWithDisplayValues<D> | undefined
  getCustomDisplayValues?: TLGetCustomOverlayDisplayValues<D> | undefined
}

/**
 * The paint one overlay util draws with, resolved against the live theme.
 *
 * Call it inside `render` rather than caching the result: it reads the theme
 * through the editor's signals, so a call in a reactive context re-runs when
 * the theme or the colour mode changes, and a cached copy would not.
 *
 * The type argument is given by the caller rather than inferred, matching the
 * shape-side spelling:
 *
 * ```ts
 * const display = getOverlayDisplayValues<BrushOverlayUtilDisplayValues>(this)
 * ```
 */
export function getOverlayDisplayValues<D extends object = object>(util: TLOverlayDisplayValuesSource<D>): D {
  const host = util.editor as { theme?: Partial<TLThemeHost> } & Partial<TLThemeHost>
  // The editor exposes the theme as `editor.theme`; a bare `TLThemeHost` stub
  // (what a test passes) implements the two methods directly. Accept both, so
  // an overlay is testable without standing up an editor.
  const source = typeof host?.getCurrentTheme === "function" ? host : host?.theme
  const theme = source?.getCurrentTheme?.() ?? DEFAULT_THEME
  const colorMode = source?.getColorMode?.() ?? "light"
  const base = util.options?.getDefaultDisplayValues?.(util.editor, theme, colorMode) ?? ({} as D)
  const custom = util.getCustomDisplayValues?.(util.editor, theme, colorMode)
  return custom ? { ...base, ...custom } : base
}
