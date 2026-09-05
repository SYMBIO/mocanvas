/**
 * The local person's preferences, kept for the whole origin rather than for one
 * editor.
 *
 * This is the *uncontrolled* form. `UserPreferencesState` is a plain object and
 * an app that wants to own it passes its own {@link CurrentUser} to the editor;
 * for everything else — a demo, a single-page app, a plugin — the preferences
 * should just persist, and this module is where they live. Nothing here talks
 * to a server: `localStorage`, one key, this browser only.
 */
import { atom, type Atom } from "@mocanvas/state"
import { T } from "../validation/T"
import type { Validator } from "../validation/validator"
import { createUserId, type User, type UserId, type UserStore } from "./userRecord"
import {
  USER_PREFERENCES_DEFAULTS,
  getFreshUserPreferences,
  type CurrentUser,
  type UserPreferencesState,
} from "./userPreferences"
import { LOCAL_STATE_PREFIX } from "../editor/runtime"

/**
 * What every unset preference resolves to.
 *
 * The documented spelling of {@link USER_PREFERENCES_DEFAULTS}; the same object,
 * so there is exactly one set of defaults however you reach it.
 */
export const defaultUserPreferences = USER_PREFERENCES_DEFAULTS

/** Where the preferences are stored. Prefixed so a hard reset can find them. */
const STORAGE_KEY = `${LOCAL_STATE_PREFIX}userPreferences`

/**
 * Validates a stored preferences object.
 *
 * Applied on *read*, not only on write, because the value comes from disk: a
 * build that shipped a bad preference, a hand-edited storage entry or a
 * half-written record must not be able to make the editor unopenable. A failed
 * read falls back to fresh preferences.
 */
export const userPreferencesValidator: Validator<UserPreferencesState> = T.object({
  id: T.string,
  name: T.string.optional(),
  color: T.string.optional(),
  locale: T.string.optional(),
  colorScheme: T.literalEnum("light", "dark", "system").optional(),
  animationSpeed: T.number.optional(),
  edgeScrollSpeed: T.number.optional(),
  isSnapMode: T.boolean.optional(),
  isWrapMode: T.boolean.optional(),
  isDynamicSizeMode: T.boolean.optional(),
  isPasteAtCursorMode: T.boolean.optional(),
  areKeyboardShortcutsEnabled: T.boolean.optional(),
}) as unknown as Validator<UserPreferencesState>

/**
 * Validates a whole `user` record.
 *
 * The documented spelling of {@link ./userRecord.userValidator}; the record
 * type's validator is one thing, and both names reach it.
 */
export const userTypeValidator: Validator<User> = T.model(
  "user",
  T.object({
    id: T.idOfType<UserId>("user"),
    typeName: T.literal("user"),
    name: T.string,
    color: T.string,
    avatarUrl: T.string.nullable(),
    meta: T.jsonObject,
  }),
) as unknown as Validator<User>

let $preferences: Atom<UserPreferencesState> | null = null

function load(): UserPreferencesState {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY)
    if (!raw) return getFreshUserPreferences()
    return userPreferencesValidator.validate(JSON.parse(raw))
  } catch {
    // Unreadable storage, unparseable JSON, or a shape we no longer accept:
    // all three mean "start over", and none is worth failing a page load for.
    return getFreshUserPreferences()
  }
}

function ensure(): Atom<UserPreferencesState> {
  if (!$preferences) $preferences = atom("userPreferences", load())
  return $preferences
}

/**
 * The local person's preferences.
 *
 * Reactive: reading this inside a `computed` or a tracked component re-runs it
 * when a preference changes, including from another editor on the same page.
 */
export function getUserPreferences(): UserPreferencesState {
  return ensure().get()
}

/**
 * Replace the local person's preferences, and persist them.
 *
 * Takes the whole object rather than a patch, matching {@link CurrentUser}: a
 * patch API here would quietly disagree with the controlled form, where the
 * host owns the object and an absent key means "use the default".
 */
export function setUserPreferences(next: UserPreferencesState): void {
  ensure().set(next)
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage is full, blocked or partitioned. The preferences still apply for
    // this session; only their persistence is lost.
  }
}

/**
 * A {@link CurrentUser} over the persisted preferences above — the editor's
 * `user` prop when an app has no opinion about where preferences live.
 *
 * Contrast {@link ./userPreferences.createCurrentUser}, which keeps them in an
 * atom that dies with the page.
 */
export function createTLCurrentUser(): CurrentUser {
  // The signal is the atom itself — `CurrentUser.userPreferences` is typed as a
  // read-only `Signal`, so the only supported way to write is through
  // `setUserPreferences`, which is also the only path that persists.
  return { userPreferences: ensure(), setUserPreferences }
}

/**
 * A {@link UserStore} over the local preferences: one person, this browser.
 *
 * Attribution needs *some* answer even when an app has no directory to ask —
 * a solo board still wants "you" on the shapes you made. This is that answer,
 * and it is entirely local: no service, no lookup, nothing leaves the page.
 * An unknown id resolves to `null` rather than to a placeholder, so a UI can
 * tell "somebody I cannot name" from "nobody".
 */
export const defaultUserStore: UserStore = {
  getCurrentUser(): User {
    const preferences = getUserPreferences()
    return {
      id: preferences.id,
      typeName: "user",
      name: preferences.name ?? defaultUserPreferences.name,
      color: preferences.color ?? "",
      avatarUrl: null,
      meta: {},
    }
  },
  resolve(userId: UserId): User | null {
    const current = defaultUserStore.getCurrentUser()
    return current && current.id === createUserId(userId) ? current : null
  },
}
