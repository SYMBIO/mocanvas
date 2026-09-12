/**
 * The registry the package that owns the built-in shapes, bindings and assets
 * fills in at import time.
 *
 * `@mocanvas/editor` ships no shape types of its own — the built-ins live in
 * the flagship, which is the whole point of the split — so it cannot name their
 * props. The flagship registers them here when it is imported, and
 * `createSchema()` reads the registry so a `geo` record is validated against
 * `geoShapeProps` even when the caller passed no util lists at all.
 *
 * The state lives in this module rather than in `../editor/schemaFactories`, so
 * that `createSchema` can read it without importing the module that imports
 * `createSchema`. `schemaFactories` re-exports the public names.
 */

import type { SchemaPropsInfo } from "./schemaInfo"

/** The type-keyed maps the registries below hold. */
export type SchemaPropsInfoMap = Record<string, SchemaPropsInfo>

const shapeSchemas: SchemaPropsInfoMap = {}
const bindingSchemas: SchemaPropsInfoMap = {}
const assetSchemas: SchemaPropsInfoMap = {}

/**
 * The props and migrations of the built-in *shape* types.
 *
 * Reading it before the package that owns them has been imported correctly
 * yields nothing: there are no built-in shapes in an editor built on
 * `@mocanvas/editor` alone.
 */
export const defaultShapeSchemas: Readonly<SchemaPropsInfoMap> = shapeSchemas

/** The props and migrations of the built-in *binding* types. See {@link defaultShapeSchemas}. */
export const defaultBindingSchemas: Readonly<SchemaPropsInfoMap> = bindingSchemas

/** The props and migrations of the built-in *asset* types. See {@link defaultShapeSchemas}. */
export const defaultAssetSchemas: Readonly<SchemaPropsInfoMap> = assetSchemas

/** Register a built-in shape type's schema. Returns a function that unregisters it. */
export function registerDefaultShapeSchema(type: string, info: SchemaPropsInfo): () => void {
  return register(shapeSchemas, type, info)
}

/** Register a built-in binding type's schema. */
export function registerDefaultBindingSchema(type: string, info: SchemaPropsInfo): () => void {
  return register(bindingSchemas, type, info)
}

/** Register a built-in asset type's schema. */
export function registerDefaultAssetSchema(type: string, info: SchemaPropsInfo): () => void {
  return register(assetSchemas, type, info)
}

function register(map: SchemaPropsInfoMap, type: string, info: SchemaPropsInfo): () => void {
  // Replacing rather than refusing: a module re-evaluated by a dev-server
  // bundler, or a package imported twice by a test, must not make the schema
  // unbuildable.
  map[type] = info
  return () => {
    if (map[type] === info) delete map[type]
  }
}
