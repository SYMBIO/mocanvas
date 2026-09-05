/**
 * The shape types every editor has, whatever an app registered.
 *
 * A handful of shapes are not really *content* — they are structure the editor
 * itself depends on. A group is the obvious one: `groupShapes()` has to be able
 * to create something, and an app that forgot to register a group util would
 * find grouping silently broken rather than absent.
 *
 * This package deliberately ships no shape types of its own — that separation
 * is the whole point of splitting the editor from the flagship — so the list
 * starts empty and the package that *does* own the built-ins fills it in at
 * import time, the same way the export and text-measurement implementations are
 * installed.
 */
import type { ShapeUtilConstructor } from "../shapes/ShapeUtil"

const registered: ShapeUtilConstructor[] = []

/**
 * The core shape utils, in registration order.
 *
 * A live array rather than a snapshot: it is read when an editor is
 * constructed, which may be before or after the package that registers into it
 * has been imported.
 */
export const coreShapes: readonly ShapeUtilConstructor[] = registered

/**
 * Add a shape util to {@link coreShapes}.
 *
 * Registering the same `type` twice replaces the earlier entry rather than
 * throwing: a module re-evaluated by a bundler in dev, or a test that imports
 * the flagship twice, should not make the second editor unconstructable.
 * Returns a function that unregisters it again.
 */
export function registerCoreShape(util: ShapeUtilConstructor): () => void {
  const existing = registered.findIndex((entry) => entry.type === util.type)
  if (existing === -1) registered.push(util)
  else registered[existing] = util

  return () => {
    const index = registered.indexOf(util)
    if (index !== -1) registered.splice(index, 1)
  }
}

/**
 * The utils an editor should construct: the core ones, then the app's.
 *
 * An app that registers its own util for a core type wins — a host replacing
 * the group shape with its own is doing something deliberate, and refusing it
 * would leave them no way to do it at all.
 */
export function withCoreShapes(shapeUtils: readonly ShapeUtilConstructor[]): ShapeUtilConstructor[] {
  const supplied = new Set(shapeUtils.map((util) => util.type))
  return [...registered.filter((util) => !supplied.has(util.type)), ...shapeUtils]
}
