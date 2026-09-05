/**
 * Migration version ids for the binding types this library ships.
 *
 * They live here, in the package that owns the migration machinery, rather than
 * next to the binding utils themselves, because a version id is a *name in a
 * persisted file*: it has to be stable and unique across the whole library, and
 * that is much easier to keep true when they are all in one place.
 *
 * Every built-in sequence is registered under `com.mocanvas.*`. Claiming
 * `com.tldraw.*` would assert that this library is the reference
 * implementation's migration line, and a real `.tldr` file — whose arrow
 * binding records progress under that id at a much higher version — would then
 * refuse to load with "data comes from a newer version".
 */
import { createBuiltInBindingPropsMigrationIds } from "./propsMigrations"

/**
 * The arrow binding's props versions.
 *
 * `Initial` is the placeholder every persisted type ships from day one: an
 * empty sequence has nowhere to put the first real migration, so the first one
 * is declared before it is needed.
 */
export const arrowBindingVersions = createBuiltInBindingPropsMigrationIds("arrow", {
  Initial: 1,
} as const)
