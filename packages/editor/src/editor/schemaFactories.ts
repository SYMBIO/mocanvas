/**
 * Building a schema from the utils an app is going to use, and the registry of
 * the schemas this library's own record types contribute.
 *
 * A schema is not configuration — it is the list of record types a document may
 * contain and how each of them has changed over time. It has to be built from
 * the same utils the editor is given, or a document will load records the
 * editor cannot render, or fail to migrate props the utils now expect.
 */
import type { StoreSchema } from "@mocanvas/store"
import { createSchema, type EditorRecord, type EditorStoreProps } from "./createStore"
import type { TLStoreSchemaOptions } from "./storeTypes"
import type { SchemaPropsInfo } from "../records/schemaInfo"

/** The type-keyed maps the registries below hold. */
export type SchemaPropsInfoMap = Record<string, SchemaPropsInfo>

const shapeSchemas: SchemaPropsInfoMap = {}
const bindingSchemas: SchemaPropsInfoMap = {}
const assetSchemas: SchemaPropsInfoMap = {}

/**
 * The props and migrations of the built-in *shape* types.
 *
 * This package ships no shape types of its own — the built-ins live in the
 * flagship, which is the whole point of the split — so the map starts empty and
 * the package that owns them registers into it at import time. Reading it
 * before that package has been imported correctly yields nothing: there are no
 * built-in shapes in an editor built on this package alone.
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

/**
 * Build a store schema from the utils an editor will be given.
 *
 * Pass the *same* lists you pass the editor. The schema collects each util's
 * `static migrations`, which is what backfills a prop onto documents saved
 * before that prop existed — a document opened against a schema built from a
 * different set of utils either fails to migrate or migrates against the wrong
 * sequence, and neither is recoverable afterwards.
 */
export function createTLSchemaFromUtils(
  options: TLStoreSchemaOptions = {},
): StoreSchema<EditorRecord, EditorStoreProps> {
  return createSchema({
    ...(options.shapeUtils ? { shapeUtils: options.shapeUtils } : {}),
    ...(options.bindingUtils ? { bindingUtils: options.bindingUtils } : {}),
    ...(options.records ? { records: options.records } : {}),
    ...(options.migrations ? { migrations: options.migrations } : {}),
  })
}
