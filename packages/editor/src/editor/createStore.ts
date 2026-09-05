import { Store, StoreSchema, type MigrationSequence, type SerializedStore, type StoreSnapshot } from "@mocanvas/store"
import {
  CameraRecordType,
  DocumentRecordType,
  InstancePageStateRecordType,
  InstanceRecordType,
  PageRecordType,
  ShapeRecordType,
  type Camera,
  type Document,
  type Instance,
  type InstancePageState,
  type Page,
  type Shape,
  type UnknownShape,
} from "../records/base"
import { BindingRecordType, type Binding, type UnknownBinding } from "../records/binding"
import { AssetRecordType, type Asset } from "../records/asset"
import { createInMemoryAssetStore, type AssetStore } from "../assets/AssetStore"
import { InstancePresenceRecordType, type InstancePresence } from "../records/presence"
import { createPropsMigrationSequences, type PropsMigrationSource } from "../migrations/propsMigrations"
import {
  createCustomRecordMigrationSequences,
  createCustomRecordTypeMap,
  validateCustomRecordInfos,
  type UnknownCustomRecord,
} from "../records/schemaRecords"
import { CUSTOM_RECORD_TYPE_NAME, type CustomRecordInfo } from "../records/customRecord"

/** The schema an editor store is built on. */
export type TLSchema = StoreSchema<EditorRecord, EditorStoreProps>
/** The props an editor store carries. */
export type TLStoreProps = EditorStoreProps

export type EditorRecord =
  | Document
  | Page
  // Deliberately the OPEN forms. The store is generic over its record union and
  // its `RecordType`/validator plumbing is invariant, so naming the narrowable
  // `Shape` here would need casts through every layer to buy narrowing in one
  // consumer callback. `editor.getShape()` returns the union instead.
  | UnknownShape
  | UnknownBinding
  | Asset
  | Camera
  | Instance
  | InstancePageState
  | InstancePresence
  | UnknownCustomRecord
export type EditorStore = Store<EditorRecord, EditorStoreProps>
export type EditorStoreSnapshot = StoreSnapshot<EditorRecord>

export interface EditorStoreProps {
  defaultName: string
  /**
   * Where the bytes behind this document's assets live.
   *
   * It hangs off the *store* rather than the editor because assets are
   * document-scoped: a snapshot loaded into a store, exported from it, or
   * synced out of it all need the same uploader, and some of that happens with
   * no editor mounted at all.
   *
   * Always present — an app that supplies none gets
   * {@link createInMemoryAssetStore}, so `store.props.assets.upload` is never
   * a null check at a call site.
   */
  assets: AssetStore
}

export interface CreateStoreOptions {
  /**
   * The shape utils the document will be read with. Their `static migrations`
   * are collected into the schema, so a board persisted before a prop existed
   * is backfilled on load. Pass the same list you give the editor.
   */
  shapeUtils?: readonly PropsMigrationSource[]
  /** Binding utils, for the same reason as `shapeUtils`. */
  bindingUtils?: readonly PropsMigrationSource[]
  /**
   * Custom record types this document may contain, beyond shapes and bindings —
   * an app's own top-level entities. Each contributes a record type and its
   * migration sequence to the schema, so the records validate on load and
   * survive a `.tldr` round trip.
   */
  records?: Readonly<Record<string, CustomRecordInfo<string>>>
  migrations?: MigrationSequence[]
  initialData?: SerializedStore<EditorRecord>
  snapshot?: EditorStoreSnapshot
  defaultName?: string
  id?: string
  /**
   * The asset store to bind to the document. Kept by identity, so a caller can
   * compare `store.props.assets` against what it passed. Defaults to an
   * in-memory store.
   */
  assets?: AssetStore
}

/**
 * Build the editor's schema.
 *
 * Accepts either a bare migration list or the util lists to derive one from —
 * `createSchema({ shapeUtils, bindingUtils })` is the form that picks up every
 * util's `static migrations`.
 */
export function createSchema(
  migrationsOrUtils: MigrationSequence[] | Pick<CreateStoreOptions, "shapeUtils" | "bindingUtils" | "records" | "migrations"> = [],
): StoreSchema<EditorRecord, EditorStoreProps> {
  if (Array.isArray(migrationsOrUtils)) return createSchemaWithMigrations(migrationsOrUtils, undefined)
  const records = migrationsOrUtils.records
  // Refuse a duplicate or reserved type name here rather than letting it shadow
  // a built-in record type halfway through a load.
  validateCustomRecordInfos(records)
  const migrations = [
    ...createPropsMigrationSequences({
      ...(migrationsOrUtils.shapeUtils ? { shapeUtils: migrationsOrUtils.shapeUtils } : {}),
      ...(migrationsOrUtils.bindingUtils ? { bindingUtils: migrationsOrUtils.bindingUtils } : {}),
    }),
    ...createCustomRecordMigrationSequences(records),
    ...(migrationsOrUtils.migrations ?? []),
  ]
  return createSchemaWithMigrations(migrations, records)
}

function createSchemaWithMigrations(
  migrations: MigrationSequence[],
  records: Readonly<Record<string, CustomRecordInfo<string>>> | undefined,
): StoreSchema<EditorRecord, EditorStoreProps> {
  const customRecords = createCustomRecordTypeMap(records)
  return StoreSchema.create<EditorRecord, EditorStoreProps>(
    {
      document: DocumentRecordType,
      page: PageRecordType,
      shape: ShapeRecordType,
      binding: BindingRecordType,
      asset: AssetRecordType,
      camera: CameraRecordType,
      instance: InstanceRecordType,
      instance_page_state: InstancePageStateRecordType,
      instance_presence: InstancePresenceRecordType,
      // An app's own record types. They share one `typeName`, so this is a
      // single entry that dispatches on each record's `type`.
      [CUSTOM_RECORD_TYPE_NAME]: customRecords,
    },
    { migrations },
  )
}

/** Create a store with the editor's record types. */
export function createStore(options: CreateStoreOptions = {}): EditorStore {
  const schema = createSchema({
    ...(options.shapeUtils ? { shapeUtils: options.shapeUtils } : {}),
    ...(options.bindingUtils ? { bindingUtils: options.bindingUtils } : {}),
    ...(options.records ? { records: options.records } : {}),
    ...(options.migrations ? { migrations: options.migrations } : {}),
  })
  const store = new Store<EditorRecord, EditorStoreProps>({
    schema,
    ...(options.initialData ? { initialData: options.initialData } : {}),
    ...(options.id ? { id: options.id } : {}),
    props: { defaultName: options.defaultName ?? "", assets: options.assets ?? createInMemoryAssetStore() },
  })
  if (options.snapshot) store.loadStoreSnapshot(options.snapshot)
  return store
}
