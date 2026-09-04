import { describe, expect, it, vi } from "vitest"
import { atom, react } from "@mocanvas/state"
import {
  createCurrentUser,
  getFreshUserPreferences,
  USER_PREFERENCES_DEFAULTS,
  UserPreferencesManager,
  type CurrentUser,
  type UserPreferencesState,
} from "./userPreferences"
import { isUserId } from "./userRecord"

describe("getFreshUserPreferences", () => {
  it("mints an id and a colour, and nothing else", () => {
    const preferences = getFreshUserPreferences()
    expect(Object.keys(preferences).sort()).toEqual(["color", "id"])
    expect(isUserId(preferences.id)).toBe(true)
    expect(preferences.color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it("leaves every other setting unset, so the editor's defaults apply", () => {
    // The point of the omission: a host that spreads this and writes down only
    // what it decides gets the editor default for the rest, not `undefined`
    // masquerading as a choice.
    const manager = new UserPreferencesManager(createCurrentUser(getFreshUserPreferences()))
    expect(manager.getIsDynamicSizeMode()).toBe(USER_PREFERENCES_DEFAULTS.isDynamicSizeMode)
    expect(manager.getIsSnapMode()).toBe(USER_PREFERENCES_DEFAULTS.isSnapMode)
    expect(manager.getAnimationSpeed()).toBe(USER_PREFERENCES_DEFAULTS.animationSpeed)
    expect(manager.getLocale()).toBe(USER_PREFERENCES_DEFAULTS.locale)
    expect(manager.getAreKeyboardShortcutsEnabled()).toBe(true)
  })

  it("gives two people different ids", () => {
    expect(getFreshUserPreferences().id).not.toBe(getFreshUserPreferences().id)
  })

  it("reads no storage", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() }
    vi.stubGlobal("localStorage", storage)
    try {
      getFreshUserPreferences()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})

describe("UserPreferencesManager", () => {
  function controlled(initial: UserPreferencesState): { user: CurrentUser; seen: UserPreferencesState[] } {
    const seen: UserPreferencesState[] = []
    const $preferences = atom("test.preferences", initial)
    return {
      user: {
        userPreferences: $preferences,
        setUserPreferences: (next) => {
          seen.push(next)
          $preferences.set(next)
        },
      },
      seen,
    }
  }

  it("reads what the owner holds", () => {
    const { user } = controlled({ id: "user:a", name: "Ada", color: "#ff0000" })
    const manager = new UserPreferencesManager(user)
    expect(manager.getId()).toBe("user:a")
    expect(manager.getName()).toBe("Ada")
    expect(manager.getColor()).toBe("#ff0000")
  })

  it("merges an update instead of replacing the object", () => {
    const { user, seen } = controlled({ id: "user:a", name: "Ada", colorScheme: "dark" })
    const manager = new UserPreferencesManager(user)

    manager.updateUserPreferences({ name: "Grace", color: "#00ff00" })

    expect(seen).toHaveLength(1)
    expect(manager.getName()).toBe("Grace")
    expect(manager.getColor()).toBe("#00ff00")
    // The setting the update said nothing about survives.
    expect(manager.getColorScheme()).toBe("dark")
    expect(manager.getId()).toBe("user:a")
  })

  it("writes every change out through the owner's setter", () => {
    const { user, seen } = controlled({ id: "user:a" })
    const manager = new UserPreferencesManager(user)

    manager.setName("Ada")
    manager.setColor("#123456")
    manager.setUserPreferences({ id: "user:a", isSnapMode: true })

    expect(seen.map((preferences) => preferences.name)).toEqual(["Ada", "Ada", undefined])
    expect(manager.getIsSnapMode()).toBe(true)
  })

  it("lets the controlled preference outrank the editor-level colorScheme", () => {
    const dark = new UserPreferencesManager(createCurrentUser({ id: "user:a", colorScheme: "dark" }), "light")
    expect(dark.getIsDarkMode()).toBe(true)

    const light = new UserPreferencesManager(createCurrentUser({ id: "user:a", colorScheme: "light" }), "dark")
    expect(light.getIsDarkMode()).toBe(false)
  })

  it("falls back to the editor-level colorScheme when the user has none", () => {
    const manager = new UserPreferencesManager(createCurrentUser({ id: "user:a" }), "dark")
    expect(manager.getColorScheme()).toBe("dark")
    expect(manager.getIsDarkMode()).toBe(true)
  })

  it("resolves \"system\" against the OS, and reads light where there is no DOM", () => {
    const manager = new UserPreferencesManager(createCurrentUser({ id: "user:a", colorScheme: "system" }))
    expect(manager.getColorScheme()).toBe("system")
    expect(manager.getIsDarkMode()).toBe(false)

    vi.stubGlobal("window", { matchMedia: (query: string) => ({ matches: query.includes("dark") }) })
    try {
      expect(manager.getIsDarkMode()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("is reactive: a preference change re-runs anything that read it", () => {
    const { user } = controlled({ id: "user:a", name: "Ada" })
    const manager = new UserPreferencesManager(user)
    const names: string[] = []

    const stop = react("names", () => {
      names.push(manager.getName())
    })
    manager.setName("Grace")
    stop()
    manager.setName("Katherine")

    expect(names).toEqual(["Ada", "Grace"])
  })
})

describe("createCurrentUser", () => {
  it("holds preferences in a signal and replaces them wholesale", () => {
    const user = createCurrentUser({ id: "user:a", name: "Ada" })
    expect(user.userPreferences.get().name).toBe("Ada")

    user.setUserPreferences({ id: "user:a", name: "Grace" })
    expect(user.userPreferences.get().name).toBe("Grace")
  })

  it("defaults to a fresh set of preferences", () => {
    expect(isUserId(createCurrentUser().userPreferences.get().id)).toBe(true)
  })
})
