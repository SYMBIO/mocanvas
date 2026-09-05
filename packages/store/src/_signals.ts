/**
 * Signals boundary for `@mocanvas/store`.
 *
 * Everything in this package imports its reactive primitives from here rather
 * than from `@mocanvas/state` directly, so the dependency is a single line.
 * The store uses: `atom`, `computed`, `transact`, `unsafe__withoutCapture`,
 * and the `Atom` / `Computed` / `Signal` types.
 */
export {
  atom,
  computed,
  isUninitialized,
  react,
  transact,
  unsafe__withoutCapture,
  withDiff,
  RESET_VALUE,
  type Atom,
  type Computed,
  type ResetValue,
  type Signal,
} from "@mocanvas/state"
