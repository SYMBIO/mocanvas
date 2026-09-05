import { useValue } from "@mocanvas/state/react"
import type { CSSProperties } from "react"
import type { Editor } from "../editor/Editor"
import type { TLThemeColors } from "../theme/types"

/**
 * The bridge from the theme to CSS: the canvas container stamps the theme's
 * surface colours as custom properties, and everything drawn in CSS or SVG
 * reads them.
 *
 * Only the *surface* half of a ramp is published — the colours that belong to
 * the canvas rather than to any one shape. A shape's paint comes from its
 * style props through `getDisplayValues`, not from a variable, because a
 * shape is drawn on the GPU where a CSS variable means nothing.
 */

/**
 * Which theme colour each custom property carries.
 *
 * The names are the ones `ui.css` already declares and `Canvas` already reads,
 * so an app that themed mocanvas by overriding the variables by hand keeps
 * working: the theme now writes the same variables it used to have to be told.
 */
export const CANVAS_THEME_VARS = {
  "--mocanvas-selection": "selectStroke",
  "--mocanvas-selection-fg": "background",
  "--mocanvas-brush-fill": "selectFill",
  "--mocanvas-snap": "hint",
  "--mocanvas-background": "background",
  "--mocanvas-surface": "solid",
  "--mocanvas-text": "text",
  "--mocanvas-grid": "grid",
} as const satisfies Record<string, keyof TLThemeColors>

/**
 * The custom properties for one resolved ramp.
 *
 * SEMANTICS-ASSUMED: `--mocanvas-selection-fg` is the fill of a solid
 * selection handle, and is mapped to the theme's `background`. A handle is a
 * chip of the page punched out of the selection stroke, so it has to match the
 * page it sits on or it reads as a light dot on a dark canvas — which is
 * exactly what the hard-coded `#ffffff` did before the theme existed.
 *
 * A colour the ramp does not carry is skipped rather than written as
 * `undefined`, so the literal fallback in `var(--x, …)` still applies.
 */
export function getThemeCssVars(colors: TLThemeColors | undefined): CSSProperties {
  const vars: Record<string, string> = {}
  if (!colors) return vars
  for (const [name, key] of Object.entries(CANVAS_THEME_VARS)) {
    const value = colors[key]
    if (typeof value === "string") vars[name] = value
  }
  return vars as CSSProperties
}

/**
 * The theme's custom properties for an editor, tracked reactively — swapping a
 * theme or flipping to dark restamps the container without anything being
 * invalidated by hand.
 *
 * Takes the editor rather than reading it from context, because the element
 * that carries the variables is the canvas container itself: the hook runs
 * above the provider that would supply it. The theme manager is read
 * defensively for the same reason `useColorMode` does — a stand-in editor in a
 * chrome test has no theme at all.
 */
export function useThemeCssVars(editor: Editor): CSSProperties {
  return useValue(
    "themeCssVars",
    () => {
      const theme = (editor as { theme?: Editor["theme"] }).theme
      if (!theme) return {}
      return getThemeCssVars(theme.getCurrentTheme().colors[theme.getColorMode()])
    },
    [editor],
  )
}
