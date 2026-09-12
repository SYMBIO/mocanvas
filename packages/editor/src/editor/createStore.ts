import { Store, StoreSchema, type MigrationSequence, type SerializedStore, type StoreSnapshot } from "@mocanvas/store"
import {
  CameraRecordType,
  DEFAULT_PAGE_ID,
  DOCUMENT_ID,
  FIRST_PAGE_INDEX,
  DocumentRecordType,
  InstancePageStateRecordType,
  InstanceRecordType,
  PageRecordType,
  type Camera,
  type Document,
  type Instance,
  type InstancePageState,
  type Page,
  type Shape,
  type UnknownShape,
} from "../records/base"
import type { Binding, UnknownBinding } from "../records/binding"
import { AssetRecordType, type Asset } from "../records/asset"
import { createInMemoryAssetStore, type AssetStore } from "../assets/AssetStore"
import { InstancePresenceRecordType, type InstancePresence } from "../records/presence"
import { createPropsMigrationSequences, type PropsMigrationSource } from "../migrations/propsMigrations"
import { defaultAssetSchemas, defaultBindingSchemas, defaultShapeSchemas } from "../records/defaultSchemas"
import {
  collectProps,
  createAssetRecordType,
  createBindingRecordType,
  createShapeRecordType,
  type PropsSource,
} from "../records/validatedRecordTypes"
import {
  createCustomRecordMigrationSequences,
  createCustomRecordTypeMap,
  validateCustomRecordInfos,
  type UnknownCustomRecord,
} from "../records/schemaRecords"
import { CUSTOM_RECORD_TYPE_NAME, type CustomRecordInfo } from "../records/customRecord"

/**
 * A util as the schema reads it: a type name, its `static props` (what the
 * records of that type are validated against) and its `static migrations`. A
 * `ShapeUtil` or `BindingUtil` subclass satisfies this through its statics.
 */
export type SchemaUtilSource = PropsMigrationSource & PropsSource

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
  shapeUtils?: readonly SchemaUtilSource[]
  /** Binding utils, for the same reason as `shapeUtils`. */
  bindingUtils?: readonly SchemaUtilSource[]
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
  /**
   * Give a brand new store its document and first page. Defaults to `true`.
   *
   * The seeded page uses {@link DEFAULT_PAGE_ID} at {@link FIRST_PAGE_INDEX},
   * so two replicas that each built their own store meet on one page. Turn it
   * OFF when the caller owns the document structure and will put its own page
   * in afterwards — a headless pipeline, a fold that replays records, a test
   * that builds a fixture by hand. Leaving it on there gives the store *two*
   * pages at the same index, and equal indices have no defined order.
   *
   * Already off, without asking, whenever `initialData` or `snapshot` is
   * supplied: those bring their own pages.
   */
  seed?: boolean
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
  return createSchemaWithMigrations(migrations, records, {
    ...(migrationsOrUtils.shapeUtils ? { shapeUtils: migrationsOrUtils.shapeUtils } : {}),
    ...(migrationsOrUtils.bindingUtils ? { bindingUtils: migrationsOrUtils.bindingUtils } : {}),
  })
}

function createSchemaWithMigrations(
  migrations: MigrationSequence[],
  records: Readonly<Record<string, CustomRecordInfo<string>>> | undefined,
  utils: { shapeUtils?: readonly SchemaUtilSource[] | undefined; bindingUtils?: readonly SchemaUtilSource[] | undefined } = {},
): StoreSchema<EditorRecord, EditorStoreProps> {
  const customRecords = createCustomRecordTypeMap(records)
  // The `shape` and `binding` entries are BUILT here rather than taken from
  // `../records/base`, because what they validate depends on which utils this
  // schema is for. `ShapeRecordType` stays exported for `createId`, defaults
  // and the rest of its non-validating surface.
  const shapeRecords = createShapeRecordType(collectProps(utils.shapeUtils, defaultShapeSchemas))
  const bindingRecords = createBindingRecordType(collectProps(utils.bindingUtils, defaultBindingSchemas))
  // No util list for assets: the three built-in types are defined in this
  // package and register themselves, and an app's own asset type registers
  // through `registerDefaultAssetSchema`.
  const assetRecords = createAssetRecordType(collectProps(undefined, defaultAssetSchemas))
  return StoreSchema.create<EditorRecord, EditorStoreProps>(
    {
      document: DocumentRecordType,
      page: PageRecordType,
      shape: shapeRecords,
      binding: bindingRecords,
      asset: assetRecords,
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
  else if (options.seed ?? true) seedBaseRecords(store)
  return store
}

/**
 * Give a brand new store the two records every document has: the document
 * itself and its first page.
 *
 * A store built with no data used to contain nothing at all, so anything that
 * reads a document without mounting an editor — a sync backend, a headless
 * export, a test — saw an empty store and had to seed it by hand or work
 * around the absence. `Editor` seeds the same two records on construction, so
 * this only changes what a store looks like BEFORE an editor touches it.
 *
 * Deliberately only these two. Camera, instance and page-state are session
 * records: they belong to a particular editor on a particular tab, and a store
 * that is only ever read, synced or exported should not carry someone's
 * viewport. `Editor.ensureBaseRecords` still creates those.
 *
 * Skipped when the caller supplies `initialData` or a `snapshot`, both of
 * which bring their own document and pages; seeding over them would put a
 * second, empty page beside the real ones. A caller that builds its document
 * some other way — putting records in after the fact — turns it off with
 * `seed: false`, which is the case this could not detect for itself and which
 * cost a consumer eleven parity tests in 4.1.0.
 */
function seedBaseRecords(store: EditorStore): void {
  if (store.has(DOCUMENT_ID)) return
  if (store.query.records("page").get().length > 0) return
  store.put([
    DocumentRecordType.create({ id: DOCUMENT_ID, name: store.props.defaultName }),
    // The same fixed id the editor uses, so two replicas that each seeded
    // their own store meet on one page rather than diverging into two.
    PageRecordType.create({ id: DEFAULT_PAGE_ID, name: "Page 1", index: FIRST_PAGE_INDEX }),
  ])
}
