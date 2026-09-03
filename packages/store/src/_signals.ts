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
  react,
  transact,
  unsafe__withoutCapture,
  type Atom,
  type Computed,
  type Signal,
} from "@mocanvas/state"
