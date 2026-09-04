import { atom, type Signal } from "@mocanvas/state"
import { PRESENCE_COLORS, randomPresenceColor } from "../records/presence"
import { createUserId } from "./userRecord"

/**
 * How the canvas picks its palette: an explicit choice, or `"system"` to follow
 * the operating system. Replaces the older `isDarkMode` boolean, which could
 * not express "follow the OS".
 */
export type ColorScheme = "light" | "dark" | "system"

/**
 * The local person's settings, as one plain serializable object.
 *
 * Everything but `id` is optional and *stays* optional: a host that owns this
 * object (see {@link CurrentUser}) writes down only the settings it has an
 * opinion about, and {@link UserPreferencesManager} fills the rest from
 * {@link USER_PREFERENCES_DEFAULTS}. Leaving a key out is therefore meaningfully
 * different from setting it — it means "whatever the editor's default is".
 *
 * The integrator exposes this as `TLUserPreferences`. It is *not* the older
 * accessor-style `UserPreferences` in `records/presence.ts`, which
 * {@link UserPreferencesManager} also satisfies so the two can coexist while
 * the editor migrates.
 */
export interface UserPreferencesState {
  /** Stable id for this person. Presence records are attributed to it. */
  id: string
  /** Display name on the cursor chip. */
  name?: string
  /** CSS colour for the cursor, name chip and selection outlines. */
  color?: string
  /** BCP-47 tag for UI text and number formatting. */
  locale?: string
  colorScheme?: ColorScheme
  /** Multiplier on camera and shape animations. `0` disables them. */
  animationSpeed?: number
  /** Multiplier on how fast the camera scrolls when dragging past the viewport edge. */
  edgeScrollSpeed?: number
  /** Snap shapes to other shapes and to the grid while dragging. */
  isSnapMode?: boolean
  /** Wrap long text instead of growing the shape. */
  isWrapMode?: boolean
  /**
   * Scale newly placed shapes by `1 / zoom`, so they look the same size at any
   * zoom level. Off means a shape is always created at its nominal size.
   */
  isDynamicSizeMode?: boolean
  /** Paste at the pointer rather than at the centre of the viewport. */
  isPasteAtCursorMode?: boolean
  /** Whether keyboard shortcuts are active. */
  areKeyboardShortcutsEnabled?: boolean
}

/** The colour a person gets when their preferences carry none. */
const DEFAULT_PRESENCE_COLOR: string = PRESENCE_COLORS[0]

/** What every unset preference resolves to. */
export const USER_PREFERENCES_DEFAULTS = {
  name: "",
  locale: "en",
  colorScheme: "system",
  animationSpeed: 1,
  edgeScrollSpeed: 1,
  isSnapMode: false,
  isWrapMode: false,
  isDynamicSizeMode: false,
  isPasteAtCursorMode: false,
  areKeyboardShortcutsEnabled: true,
} as const satisfies Omit<Required<UserPreferencesState>, "id" | "color">

/**
 * Mint a brand new set of preferences: a fresh id and a presence colour, and
 * nothing else.
 *
 * Deliberately does not read (or write) any persistent storage, and deliberately
 * leaves every other key unset so the editor's own defaults apply. A host that
 * wants to own the preferences outright — to keep a per-origin setting from
 * outranking its own theme, say — seeds its state from this and writes down the
 * handful of settings it actually decides.
 */
export function getFreshUserPreferences(): UserPreferencesState {
  return { id: createUserId(), color: randomPresenceColor() }
}

/**
 * A preferences object plus the way to replace it — the editor's `user` prop.
 *
 * Whoever provides this owns the storage. Pass one built from React state and
 * nothing the editor does can reach a global localStorage key; pass
 * {@link createCurrentUser} and the preferences live in a signal for the life of
 * the page.
 */
export interface CurrentUser {
  userPreferences: Signal<UserPreferencesState>
  setUserPreferences(next: UserPreferencesState): void
}

/** A {@link CurrentUser} backed by one atom. Nothing is persisted. */
export function createCurrentUser(initial: UserPreferencesState = getFreshUserPreferences()): CurrentUser {
  const $preferences = atom("editor.userPreferences", initial)
  return {
    userPreferences: $preferences,
    setUserPreferences: (next: UserPreferencesState) => $preferences.set(next),
  }
}

/**
 * Reads preferences with the editor's defaults applied, and writes them back
 * through whoever owns them.
 *
 * Every getter resolves in the same order: the value the {@link CurrentUser}
 * carries, then the editor-level fallback passed to the constructor (for
 * `colorScheme` only), then {@link USER_PREFERENCES_DEFAULTS}. The controlled
 * user therefore always wins over an editor option — which is the point of
 * controlling it.
 *
 * The getters read a signal, so calling them inside a `computed` or `react`
 * subscribes to preference changes.
 */
export class UserPreferencesManager {
  constructor(
    private readonly user: CurrentUser,
    /** The editor-level fallback, used only when the user has no `colorScheme` of their own. */
    private readonly colorScheme: ColorScheme | null = null,
  ) {}

  /** The raw preferences object, exactly as its owner holds it. */
  getUserPreferences(): UserPreferencesState {
    return this.user.userPreferences.get()
  }

  /** Replace the whole object. */
  setUserPreferences(next: UserPreferencesState): void {
    this.user.setUserPreferences(next)
  }

  /** Merge `patch` into the current preferences and hand the result to the owner. */
  updateUserPreferences(patch: Partial<UserPreferencesState>): void {
    this.user.setUserPreferences({ ...this.getUserPreferences(), ...patch })
  }

  getId(): string {
    return this.getUserPreferences().id
  }

  getName(): string {
    return this.getUserPreferences().name ?? USER_PREFERENCES_DEFAULTS.name
  }

  setName(name: string): void {
    this.updateUserPreferences({ name })
  }

  getColor(): string {
    return this.getUserPreferences().color || DEFAULT_PRESENCE_COLOR
  }

  setColor(color: string): void {
    this.updateUserPreferences({ color })
  }

  getLocale(): string {
    return this.getUserPreferences().locale ?? USER_PREFERENCES_DEFAULTS.locale
  }

  getAnimationSpeed(): number {
    return this.getUserPreferences().animationSpeed ?? USER_PREFERENCES_DEFAULTS.animationSpeed
  }

  getEdgeScrollSpeed(): number {
    return this.getUserPreferences().edgeScrollSpeed ?? USER_PREFERENCES_DEFAULTS.edgeScrollSpeed
  }

  getIsSnapMode(): boolean {
    return this.getUserPreferences().isSnapMode ?? USER_PREFERENCES_DEFAULTS.isSnapMode
  }

  getIsWrapMode(): boolean {
    return this.getUserPreferences().isWrapMode ?? USER_PREFERENCES_DEFAULTS.isWrapMode
  }

  getIsDynamicSizeMode(): boolean {
    return this.getUserPreferences().isDynamicSizeMode ?? USER_PREFERENCES_DEFAULTS.isDynamicSizeMode
  }

  /**
   * Alias of {@link getIsDynamicSizeMode}. The preference is spelled
   * "dynamic resize mode" at some call sites and "dynamic size mode" at
   * others; both names read the one setting.
   */
  getIsDynamicResizeMode(): boolean {
    return this.getIsDynamicSizeMode()
  }

  getIsPasteAtCursorMode(): boolean {
    return this.getUserPreferences().isPasteAtCursorMode ?? USER_PREFERENCES_DEFAULTS.isPasteAtCursorMode
  }

  getAreKeyboardShortcutsEnabled(): boolean {
    return (
      this.getUserPreferences().areKeyboardShortcutsEnabled ?? USER_PREFERENCES_DEFAULTS.areKeyboardShortcutsEnabled
    )
  }

  /** The scheme actually in force: the user's, else the editor's, else `"system"`. */
  getColorScheme(): ColorScheme {
    return this.getUserPreferences().colorScheme ?? this.colorScheme ?? USER_PREFERENCES_DEFAULTS.colorScheme
  }

  /** {@link getColorScheme} with `"system"` resolved against the OS setting. */
  getIsDarkMode(): boolean {
    const scheme = this.getColorScheme()
    if (scheme !== "system") return scheme === "dark"
    return prefersDarkMode()
  }
}

// SEMANTICS-ASSUMED: "system" is resolved against `prefers-color-scheme` on the
// global `window`. An editor rendered into another document (an iframe, an
// Electron child window) should ask *that* window; the container helpers that
// would let us do so are being added in a parallel workstream, so this reads the
// global one and falls back to light where there is no DOM at all.
function prefersDarkMode(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}
