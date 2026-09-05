/**
 * Building a store and a schema from React, without rebuilding them on every
 * render.
 *
 * A store is expensive and, more importantly, it is *identity*: rebuilding one
 * throws away the document. So both hooks memoise deliberately narrowly — they
 * rebuild only when something that genuinely changes the schema or the document
 * changes, and never merely because a parent re-rendered.
 */
import { useMemo } from "react"
import type { StoreSchema } from "@mocanvas/store"
import { createStore, type EditorRecord, type EditorStore, type EditorStoreProps } from "../editor/createStore"
import { createTLSchemaFromUtils } from "../editor/schemaFactories"
import type { TLStoreOptions, TLStoreSchemaOptions } from "../editor/storeTypes"

/**
 * A schema built from the given utils, memoised.
 *
 * The dependency list is the *contents* of the util arrays, not the arrays
 * themselves: an inline `shapeUtils={[MyShape]}` is a fresh array on every
 * render, and depending on its identity would rebuild the schema — and with it
 * the store — on every keystroke.
 */
export function useTLSchemaFromUtils(
  options: TLStoreSchemaOptions = {},
): StoreSchema<EditorRecord, EditorStoreProps> {
  const { shapeUtils, bindingUtils, records, migrations } = options
  return useMemo(
    () => createTLSchemaFromUtils(options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      shapeUtils?.length,
      bindingUtils?.length,
      migrations?.length,
      shapeUtils?.map(typeOf).join(),
      bindingUtils?.map(typeOf).join(),
      records && Object.keys(records).join(),
    ],
  )
}

function typeOf(util: { type?: string }): string {
  return util.type ?? ""
}

/**
 * A store built from the given options, memoised.
 *
 * Rebuilt only when the schema inputs or the document inputs change. In
 * particular a new `assets` object does *not* rebuild the store: the asset
 * store is a seam onto the host's own uploader, apps routinely construct one
 * inline, and swapping it is not a reason to discard the document.
 */
export function useTLStore(options: TLStoreOptions = {}): EditorStore {
  const schema = useTLSchemaFromUtils(options)
  const { snapshot, initialData, defaultName, id, assets } = options

  return useMemo(
    () =>
      createStore({
        ...(options.shapeUtils ? { shapeUtils: options.shapeUtils } : {}),
        ...(options.bindingUtils ? { bindingUtils: options.bindingUtils } : {}),
        ...(options.records ? { records: options.records } : {}),
        ...(options.migrations ? { migrations: options.migrations } : {}),
        ...(snapshot ? { snapshot } : {}),
        ...(initialData ? { initialData } : {}),
        ...(defaultName ? { defaultName } : {}),
        ...(id ? { id } : {}),
        ...(assets ? { assets } : {}),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schema, snapshot, initialData, defaultName, id],
  )
}
