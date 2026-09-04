/** React access to the live theme. */
import { useValue } from "@mocanvas/state/react"
import { useEditor } from "../react/EditorContext"
import { DEFAULT_THEME } from "./DEFAULT_THEME"
import type { ThemeManager } from "./ThemeManager"
import type { TLColorMode, TLTheme, TLThemeColors } from "./types"

/** The editor as this module needs it, before the theme manager is wired on. */
type EditorWithTheme = { theme?: ThemeManager }

/**
 * The colour mode the canvas is painting in, resolved: `"system"` has already
 * been turned into `"light"` or `"dark"` by the time it gets here.
 *
 * Re-renders the component when the mode changes, including when it changes
 * because the operating system did.
 */
export function useColorMode(): TLColorMode {
  const editor = useEditor() as unknown as EditorWithTheme
  return useValue("colorMode", () => editor.theme?.getColorMode() ?? "light", [editor])
}

/** The theme the canvas is painting with. Re-renders when it is swapped or patched. */
export function useCurrentTheme(): TLTheme {
  const editor = useEditor() as unknown as EditorWithTheme
  return useValue("currentTheme", () => editor.theme?.getCurrentTheme() ?? DEFAULT_THEME, [editor])
}

/** The ramp the canvas is painting with: the current theme's colours for the current mode. */
export function useThemeColors(): TLThemeColors {
  const theme = useCurrentTheme()
  const colorMode = useColorMode()
  return theme.colors[colorMode]
}
