import { useMemo, useRef } from "react"
import { atom, unsafe__withoutCapture } from "@mocanvas/state"
import type { CurrentUser, UserPreferencesState } from "./userPreferences"

export interface UseCurrentUserOptions {
  /** The preferences object the host holds — typically React state. */
  userPreferences: UserPreferencesState
  /** How to replace it. A plain setter; the hook never calls it with an updater. */
  setUserPreferences: (next: UserPreferencesState) => void
}

/**
 * Adapt host-owned preferences into the {@link CurrentUser} the editor takes.
 *
 * The point is control: the editor reads preferences through a signal, but the
 * value in that signal is whatever the host last rendered, and every write the
 * editor makes goes back out through the host's setter. Nothing is persisted
 * and no global storage key is touched — so a host that decides, say, the colour
 * scheme cannot be overruled by a setting some other canvas left behind on this
 * origin.
 *
 * The returned object is identity-stable, so passing it as a prop does not
 * remount the editor.
 *
 * The integrator exposes this as `useTldrawCurrentUser` for tldraw-shaped call
 * sites.
 */
export function useCurrentUser({ userPreferences, setUserPreferences }: UseCurrentUserOptions): CurrentUser {
  // Created once from the first render's value; kept in step by the sync below.
  const $preferences = useMemo(() => atom("react.userPreferences", userPreferences), [])

  // Latest setter without a new identity, so a host that passes an inline
  // closure does not force the editor to see a new user on every render.
  const setter = useRef(setUserPreferences)
  setter.current = setUserPreferences

  // Sync during render rather than in an effect: the first paint after a
  // preference change is already the new one, with no frame of the old value.
  if (unsafe__withoutCapture(() => $preferences.get()) !== userPreferences) {
    $preferences.set(userPreferences)
  }

  return useMemo<CurrentUser>(
    () => ({
      userPreferences: $preferences,
      setUserPreferences: (next: UserPreferencesState) => setter.current(next),
    }),
    [$preferences],
  )
}
