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

// The registry itself lives in `../records/defaultSchemas`, which `createSchema`
// also reads; keeping the state there rather than here is what stops this
// module and `./createStore` importing each other. The names are re-exported so
// `@mocanvas/editor`'s public surface is unchanged.
export {
  defaultAssetSchemas,
  defaultBindingSchemas,
  defaultShapeSchemas,
  registerDefaultAssetSchema,
  registerDefaultBindingSchema,
  registerDefaultShapeSchema,
  type SchemaPropsInfoMap,
} from "../records/defaultSchemas"

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
