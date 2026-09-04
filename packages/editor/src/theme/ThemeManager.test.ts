import { describe, expect, it, beforeEach, afterAll } from "vitest"
import { react } from "@mocanvas/state"
import { DefaultColorStyle } from "../records/styleProp"
import type { Editor } from "../editor/Editor"
import { DEFAULT_THEME } from "./DEFAULT_THEME"
import { ThemeManager, type TLColorSchemeWindow } from "./ThemeManager"
import type { TLTheme } from "./types"

const ORIGINAL_COLOR_VALUES = [...DefaultColorStyle.values]

function restoreColorValues(): void {
  const values = DefaultColorStyle.values as string[]
  values.length = 0
  values.push(...ORIGINAL_COLOR_VALUES)
}

beforeEach(restoreColorValues)
afterAll(restoreColorValues)

/** An editor stub: the manager only ever asks it for its container. */
const EDITOR = { getContainer: () => null }

/**
 * The manager takes the editor itself. Pinned as a type, so a change to
 * `Editor.getContainer` breaks here rather than in whoever wires the manager
 * onto the editor.
 */
const acceptsARealEditor: (editor: Editor) => ThemeManager = (editor) => new ThemeManager(editor)
void acceptsARealEditor

/** A `matchMedia` whose answer can be changed, like a user flipping their OS theme. */
function fakeWindow(initiallyDark: boolean): TLColorSchemeWindow & { flip(dark: boolean): void } {
  const listeners = new Set<(e: { matches: boolean }) => void>()
  let matches = initiallyDark
  return {
    matchMedia: () => ({
      get matches() {
        return matches
      },
      addEventListener: (_type: "change", listener: (e: { matches: boolean }) => void) => {
        listeners.add(listener)
      },
      removeEventListener: (_type: "change", listener: (e: { matches: boolean }) => void) => {
        listeners.delete(listener)
      },
    }),
    flip(dark: boolean) {
      matches = dark
      for (const listener of listeners) listener({ matches: dark })
    },
  }
}

const brandTheme: TLTheme = {
  ...DEFAULT_THEME,
  id: "brand",
  colors: {
    light: { ...DEFAULT_THEME.colors.light, background: "#fffdf5" },
    dark: DEFAULT_THEME.colors.dark,
  },
}

function manager(options: ConstructorParameters<typeof ThemeManager>[1] = {}): ThemeManager {
  return new ThemeManager(EDITOR, { window: null, ...options })
}

describe("ThemeManager — themes", () => {
  it("starts on the built-in default", () => {
    expect(manager().getCurrentTheme()).toBe(DEFAULT_THEME)
    expect(manager().getCurrentThemeId()).toBe("default")
  })

  it("registers what it is given and can be started on one of them", () => {
    const m = manager({ themes: { brand: brandTheme }, initialTheme: "brand" })
    expect(Object.keys(m.getThemes()).sort()).toEqual(["brand", "default"])
    expect(m.getCurrentTheme().id).toBe("brand")
    expect(m.getTheme("brand")).toBe(brandTheme)
    expect(m.getTheme("nope")).toBeUndefined()
  })

  it("switches themes, and ignores an id nobody registered", () => {
    const m = manager({ themes: { brand: brandTheme } })
    m.setCurrentTheme("brand")
    expect(m.getCurrentThemeId()).toBe("brand")
    m.setCurrentTheme("typo")
    expect(m.getCurrentThemeId()).toBe("brand")
  })

  it("falls back to the default theme if the current id disappears", () => {
    const m = manager({ themes: { brand: brandTheme }, initialTheme: "brand" })
    m.updateThemes({ default: { fontSize: { ...DEFAULT_THEME.fontSize, m: 30 } } })
    expect(m.getCurrentTheme().id).toBe("brand")
  })
})

describe("ThemeManager — updates", () => {
  it("patches one ramp entry and leaves the rest of the theme alone", () => {
    const m = manager()
    m.updateTheme("default", { colors: { light: { blue: { ...DEFAULT_THEME.colors.light.blue, solid: "#0000ff" } } } })
    const theme = m.getCurrentTheme()
    expect(theme.colors.light.blue.solid).toBe("#0000ff")
    expect(theme.colors.light.red).toBe(DEFAULT_THEME.colors.light.red)
    expect(theme.colors.dark).toBe(DEFAULT_THEME.colors.dark)
    expect(theme.fontSize).toBe(DEFAULT_THEME.fontSize)
  })

  it("patches metrics without touching the colours", () => {
    const m = manager()
    m.updateTheme("default", { lineHeight: 2 })
    expect(m.getCurrentTheme().lineHeight).toBe(2)
    expect(m.getCurrentTheme().colors.light).toBe(DEFAULT_THEME.colors.light)
  })

  it("registers a theme the id of which is new", () => {
    const m = manager()
    m.updateTheme("brand", { colors: { light: { background: "#fffdf5" } } })
    expect(m.getTheme("brand")?.id).toBe("brand")
    expect(m.getTheme("brand")?.colors.light.background).toBe("#fffdf5")
  })

  it("applies several themes in one write", () => {
    const m = manager({ themes: { brand: brandTheme } })
    m.updateThemes({ default: { lineHeight: 1.5 }, brand: { lineHeight: 1.6 } })
    expect(m.getTheme("default")?.lineHeight).toBe(1.5)
    expect(m.getTheme("brand")?.lineHeight).toBe(1.6)
  })

  it("does not leave the theme untouched when it is handed nothing", () => {
    const m = manager()
    const before = m.getCurrentTheme()
    m.updateThemes({})
    expect(m.getCurrentTheme()).toBe(before)
  })

  it("re-registers colour names when an update introduces one", () => {
    const m = manager()
    m.updateTheme("default", {
      colors: { light: { "brand-teal": DEFAULT_THEME.colors.light.green } },
    })
    expect([...DefaultColorStyle.values]).toContain("brand-teal")
  })
})

describe("ThemeManager — colour mode", () => {
  it("defaults to light", () => {
    expect(manager().getColorMode()).toBe("light")
    expect(manager().getColorScheme()).toBe("light")
  })

  it("pins whichever mode it is set to", () => {
    const m = manager()
    m.setColorScheme("dark")
    expect(m.getColorMode()).toBe("dark")
    expect(m.getColors()).toBe(DEFAULT_THEME.colors.dark)
  })

  it("resolves `system` from the host window", () => {
    const win = fakeWindow(true)
    const m = new ThemeManager(EDITOR, { colorScheme: "system", window: win })
    expect(m.getColorScheme()).toBe("system")
    expect(m.getColorMode()).toBe("dark")
  })

  it("follows the host window when the operating system flips", () => {
    const win = fakeWindow(false)
    const m = new ThemeManager(EDITOR, { colorScheme: "system", window: win })
    expect(m.getColorMode()).toBe("light")
    win.flip(true)
    expect(m.getColorMode()).toBe("dark")
  })

  it("stays put on a pinned scheme however the system moves", () => {
    const win = fakeWindow(false)
    const m = new ThemeManager(EDITOR, { colorScheme: "light", window: win })
    win.flip(true)
    expect(m.getColorMode()).toBe("light")
  })

  it("resolves to light where there is no window to ask", () => {
    const m = new ThemeManager(EDITOR, { colorScheme: "system", window: null })
    expect(m.getColorMode()).toBe("light")
  })

  it("stops listening once disposed", () => {
    const win = fakeWindow(false)
    const m = new ThemeManager(EDITOR, { colorScheme: "system", window: win })
    m.dispose()
    win.flip(true)
    expect(m.getColorMode()).toBe("light")
  })
})

describe("ThemeManager — reactivity", () => {
  it("re-runs a reaction when the theme is patched", () => {
    const m = manager()
    const seen: string[] = []
    const stop = react("test.theme", () => {
      seen.push(m.getCurrentTheme().colors.light.blue.solid)
    })
    m.updateTheme("default", { colors: { light: { blue: { ...DEFAULT_THEME.colors.light.blue, solid: "#0000ff" } } } })
    stop()
    expect(seen).toEqual([DEFAULT_THEME.colors.light.blue.solid, "#0000ff"])
  })

  it("re-runs a reaction when the colour mode changes", () => {
    const m = manager()
    const seen: string[] = []
    const stop = react("test.mode", () => {
      seen.push(m.getColorMode())
    })
    m.setColorScheme("dark")
    m.setColorScheme("dark")
    stop()
    expect(seen).toEqual(["light", "dark"])
  })

  it("re-runs a reaction when the system flips under `system`", () => {
    const win = fakeWindow(false)
    const m = new ThemeManager(EDITOR, { colorScheme: "system", window: win })
    const seen: string[] = []
    const stop = react("test.system", () => {
      seen.push(m.getColorMode())
    })
    win.flip(true)
    stop()
    expect(seen).toEqual(["light", "dark"])
  })
})
