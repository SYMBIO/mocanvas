/**
 * The editor's theme state: which themes exist, which one is current, and
 * which colour mode they resolve in.
 */
import { atom, computed, type Atom, type Computed } from "@mocanvas/state"
import { DEFAULT_THEME } from "./DEFAULT_THEME"
import { applyThemePatch, registerColorsFromThemes, resolveThemes } from "./resolveThemes"
import type {
  TLColorMode,
  TLColorScheme,
  TLTheme,
  TLThemeColors,
  TLThemeId,
  TLThemePatch,
  TLThemes,
  TLThemesInput,
} from "./types"

/** Just enough of a `Window` to follow the system colour scheme. */
export interface TLColorSchemeWindow {
  matchMedia(query: string): {
    matches: boolean
    addEventListener?(type: "change", listener: (e: { matches: boolean }) => void): void
    removeEventListener?(type: "change", listener: (e: { matches: boolean }) => void): void
  }
}

export interface ThemeManagerOptions {
  /** Themes to register, merged over the built-in `default`. */
  themes?: TLThemesInput
  /** Which of them starts out current. Defaults to `"default"`. */
  initialTheme?: TLThemeId
  /** Light, dark, or follow the host window. Defaults to `"light"`. */
  colorScheme?: TLColorScheme
  /** Where `"system"` is read from. Defaults to the editor's own window. */
  window?: TLColorSchemeWindow | null
}

/** What the manager needs from the editor: a way to find its window. */
interface ThemeManagerHost {
  getContainer?: () => { ownerDocument?: { defaultView?: unknown } | null } | null
}

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)"

/**
 * Holds the themes and the colour mode, reactively.
 *
 * Every read goes through a signal, so a shape that resolves its display
 * values inside a reactive context re-renders by itself when the app swaps a
 * palette or flips to dark — nothing has to be invalidated by hand.
 */
export class ThemeManager {
  private readonly _themes: Atom<TLThemes>
  private readonly _currentThemeId: Atom<TLThemeId>
  private readonly _colorScheme: Atom<TLColorScheme>
  private readonly _systemColorMode: Atom<TLColorMode>
  private readonly _currentTheme: Computed<TLTheme>
  private readonly _colorMode: Computed<TLColorMode>
  private disposeSystemListener: (() => void) | undefined

  constructor(
    private readonly editor: ThemeManagerHost,
    options: ThemeManagerOptions = {},
  ) {
    const themes = resolveThemes(options.themes)
    registerColorsFromThemes(themes)

    this._themes = atom<TLThemes>("theme.themes", themes)
    this._currentThemeId = atom<TLThemeId>("theme.currentThemeId", options.initialTheme ?? "default")
    this._colorScheme = atom<TLColorScheme>("theme.colorScheme", options.colorScheme ?? "light")
    this._systemColorMode = atom<TLColorMode>("theme.systemColorMode", "light")

    this._currentTheme = computed("theme.currentTheme", () => {
      const all = this._themes.get()
      return all[this._currentThemeId.get()] ?? all["default"] ?? DEFAULT_THEME
    })
    this._colorMode = computed("theme.colorMode", () => {
      const scheme = this._colorScheme.get()
      return scheme === "system" ? this._systemColorMode.get() : scheme
    })

    this.watchSystemColorScheme(options.window === undefined ? this.findWindow() : options.window)
  }

  // ---- themes --------------------------------------------------------------

  /** The theme the editor is painting with. */
  getCurrentTheme(): TLTheme {
    return this._currentTheme.get()
  }

  /**
   * Switch to a registered theme. Ids that are not registered are ignored — a
   * board keeps painting rather than losing its palette to a typo.
   */
  setCurrentTheme(id: TLThemeId): void {
    if (!this._themes.get()[id]) return
    this._currentThemeId.set(id)
  }

  /** The id of the current theme. */
  getCurrentThemeId(): TLThemeId {
    return this._currentThemeId.get()
  }

  /** Every registered theme, by id. */
  getThemes(): TLThemes {
    return this._themes.get()
  }

  /** One registered theme, or `undefined` if that id was never registered. */
  getTheme(id: TLThemeId): TLTheme | undefined {
    return this._themes.get()[id]
  }

  /**
   * Change part of one theme. `colors` is merged one ramp at a time, so
   * `updateTheme("default", { colors: { light: { blue: … } } })` keeps the dark
   * ramp and every other light entry.
   *
   * Registers the theme if the id is new, which is how an app adds a palette
   * after the editor is already running.
   */
  updateTheme(id: TLThemeId, patch: TLThemePatch): void {
    this.updateThemes({ [id]: patch })
  }

  /**
   * The same, for several themes at once — one atom write, so a whole palette
   * swap repaints in a single frame.
   */
  updateThemes(patch: Partial<Record<TLThemeId, TLThemePatch>>): void {
    const next: TLThemes = { ...this._themes.get() }
    let changed = false
    for (const [id, themePatch] of Object.entries(patch)) {
      if (!themePatch) continue
      next[id] = applyThemePatch(next[id] ?? DEFAULT_THEME, themePatch, id)
      changed = true
    }
    if (!changed) return
    registerColorsFromThemes(next)
    this._themes.set(next)
  }

  // ---- colour mode ---------------------------------------------------------

  /** The mode the current theme resolves in: what is actually painted. */
  getColorMode(): TLColorMode {
    return this._colorMode.get()
  }

  /** The mode *setting* — `"system"` included, unresolved. */
  getColorScheme(): TLColorScheme {
    return this._colorScheme.get()
  }

  /** Pin the colour mode, or hand it back to the host window with `"system"`. */
  setColorScheme(scheme: TLColorScheme): void {
    this._colorScheme.set(scheme)
  }

  /** The ramp being painted: the current theme's colours for the current mode. */
  getColors(): TLThemeColors {
    return this.getCurrentTheme().colors[this.getColorMode()]
  }

  /**
   * Follow a window's `prefers-color-scheme`. Called with the editor's own
   * window on construction; pass another one (or `null`) to redirect it.
   */
  watchSystemColorScheme(win: TLColorSchemeWindow | null | undefined): void {
    this.disposeSystemListener?.()
    this.disposeSystemListener = undefined
    if (!win || typeof win.matchMedia !== "function") return
    try {
      const query = win.matchMedia(SYSTEM_DARK_QUERY)
      this._systemColorMode.set(query.matches ? "dark" : "light")
      const onChange = (e: { matches: boolean }): void => {
        this._systemColorMode.set(e.matches ? "dark" : "light")
      }
      query.addEventListener?.("change", onChange)
      this.disposeSystemListener = () => query.removeEventListener?.("change", onChange)
    } catch {
      // A host with no media-query support simply never resolves to `system` dark.
    }
  }

  /** Stop following the system colour scheme. */
  dispose(): void {
    this.disposeSystemListener?.()
    this.disposeSystemListener = undefined
  }

  /**
   * The window the editor is mounted in, falling back to the global one — an
   * editor in an iframe or a second Electron window must read *its* media
   * query, not the top document's.
   */
  private findWindow(): TLColorSchemeWindow | null {
    try {
      const view = this.editor.getContainer?.()?.ownerDocument?.defaultView
      if (view && typeof (view as TLColorSchemeWindow).matchMedia === "function") {
        return view as TLColorSchemeWindow
      }
    } catch {
      // An editor whose container is not mounted yet: fall through to the global.
    }
    const globalWindow = (globalThis as { window?: TLColorSchemeWindow }).window
    return globalWindow && typeof globalWindow.matchMedia === "function" ? globalWindow : null
  }
}
