/**
 * The public surface of `@mocanvas/editor`.
 *
 * Each directory owns its own barrel, and this file re-exports them. That keeps
 * a change to one area out of everyone else's way — add an export where the code
 * lives, not here.
 */
export * from "./editor"
export * from "./geometry"
export * from "./records"
export * from "./shapes"
export * from "./bindings"
export * from "./tools"
export * from "./render"
export * from "./react"
export * from "./indicators"
export * from "./validation"
export * from "./migrations"
export * from "./assets"
export * from "./user"
export * from "./theme"

// ---- re-exports from sibling packages ---------------------------------------
// An app should be able to build reactive state, derived caches and shape
// ordering from the editor surface alone, without depending on the packages the
// editor is itself built from.
export { loadEngine, loadEngineSync, getLoadedEngine, EngineBridge, FLAG, GEO_FLAG, GEO_KIND, PATH_OP, type StyleWords, type CameraState, type ClipRect } from "@mocanvas/wasm"
export { useValue, track, useAtom, useComputed, useReactor, useQuickReactor } from "@mocanvas/state/react"
export { atom, computed, react, reactor, transact, transaction, AtomMap } from "@mocanvas/state"
export {
  ZERO_INDEX_KEY,
  getIndexAbove,
  getIndexBelow,
  getIndexBetween,
  getIndices,
  getIndicesAbove,
  getIndicesBelow,
  getIndicesBetween,
  sortByIndex,
  createComputedCache,
  iterateGraphemes,
  getGraphemes,
  getGraphemeLength,
  type IndexKey,
  type ComputedCache,
  type ComputedCacheContext,
  type CreateComputedCacheOptions,
  type RecordsDiff,
  type StoreSnapshot,
} from "@mocanvas/store"
