import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Editor } from "../editor/Editor"
import { EditorProvider } from "../react/EditorContext"
import { DEFAULT_THEME } from "./DEFAULT_THEME"
import { ThemeManager } from "./ThemeManager"
import { useColorMode, useCurrentTheme, useThemeColors } from "./useColorMode"
import { createTheme } from "./resolveThemes"

/** An editor with nothing on it but a theme manager — all these hooks read. */
function editorWith(manager: ThemeManager | undefined): Editor {
  return { theme: manager } as unknown as Editor
}

/** A component body, rendered through the provider so the hooks find an editor. */
function harness(editor: Editor, use: () => string): string {
  const Probe = (): string => use()
  return renderToStaticMarkup(
    <EditorProvider value={editor}>
      <Probe />
    </EditorProvider>,
  )
}

const manager = (colorScheme: "light" | "dark"): ThemeManager =>
  new ThemeManager({ getContainer: () => null }, { window: null, colorScheme })

describe("useColorMode", () => {
  it("reports the mode the editor is painting in", () => {
    expect(harness(editorWith(manager("light")), useColorMode)).toBe("light")
    expect(harness(editorWith(manager("dark")), useColorMode)).toBe("dark")
  })

  it("falls back to light on an editor with no theme manager yet", () => {
    expect(harness(editorWith(undefined), useColorMode)).toBe("light")
  })
})

describe("useCurrentTheme", () => {
  it("returns the live theme", () => {
    const brand = createTheme("default", { colors: { light: { background: "#fffdf5" } } })
    const editor = editorWith(new ThemeManager({ getContainer: () => null }, { themes: { default: brand }, window: null }))
    expect(harness(editor, () => useCurrentTheme().colors.light.background)).toBe("#fffdf5")
  })

  it("falls back to the built-in theme", () => {
    expect(harness(editorWith(undefined), () => useCurrentTheme().id)).toBe(DEFAULT_THEME.id)
  })
})

describe("useThemeColors", () => {
  it("returns the ramp for the current mode", () => {
    expect(harness(editorWith(manager("dark")), () => useThemeColors().background)).toBe(
      DEFAULT_THEME.colors.dark.background,
    )
  })
})
