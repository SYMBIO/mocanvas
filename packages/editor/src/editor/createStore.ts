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
  type UnknownShape,
} from "../records/base"
import { BindingRecordType, type UnknownBinding } from "../records/binding"
import { AssetRecordType, type Asset } from "../records/asset"
import { InstancePresenceRecordType, type InstancePresence } from "../records/presence"
import { createPropsMigrationSequences, type PropsMigrationSource } from "../migrations/propsMigrations"

export type EditorRecord =
  | Document
  | Page
  | UnknownShape
  | UnknownBinding
  | Asset
  | Camera
  | Instance
  | InstancePageState
  | InstancePresence
export type EditorStore = Store<EditorRecord, EditorStoreProps>
export type EditorStoreSnapshot = StoreSnapshot<EditorRecord>

export interface EditorStoreProps {
  defaultName: string
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
  migrations?: MigrationSequence[]
  initialData?: SerializedStore<EditorRecord>
  snapshot?: EditorStoreSnapshot
  defaultName?: string
  id?: string
}

/**
 * Build the editor's schema.
 *
 * Accepts either a bare migration list or the util lists to derive one from —
 * `createSchema({ shapeUtils, bindingUtils })` is the form that picks up every
 * util's `static migrations`.
 */
export function createSchema(
  migrationsOrUtils: MigrationSequence[] | Pick<CreateStoreOptions, "shapeUtils" | "bindingUtils" | "migrations"> = [],
): StoreSchema<EditorRecord, EditorStoreProps> {
  const migrations = Array.isArray(migrationsOrUtils)
    ? migrationsOrUtils
    : [
        ...createPropsMigrationSequences({
          ...(migrationsOrUtils.shapeUtils ? { shapeUtils: migrationsOrUtils.shapeUtils } : {}),
          ...(migrationsOrUtils.bindingUtils ? { bindingUtils: migrationsOrUtils.bindingUtils } : {}),
        }),
        ...(migrationsOrUtils.migrations ?? []),
      ]
  return createSchemaWithMigrations(migrations)
}

function createSchemaWithMigrations(migrations: MigrationSequence[]): StoreSchema<EditorRecord, EditorStoreProps> {
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
    },
    { migrations },
  )
}

/** Create a store with the editor's record types. */
export function createStore(options: CreateStoreOptions = {}): EditorStore {
  const schema = createSchema({
    ...(options.shapeUtils ? { shapeUtils: options.shapeUtils } : {}),
    ...(options.bindingUtils ? { bindingUtils: options.bindingUtils } : {}),
    ...(options.migrations ? { migrations: options.migrations } : {}),
  })
  const store = new Store<EditorRecord, EditorStoreProps>({
    schema,
    ...(options.initialData ? { initialData: options.initialData } : {}),
    ...(options.id ? { id: options.id } : {}),
    props: { defaultName: options.defaultName ?? "" },
  })
  if (options.snapshot) store.loadStoreSnapshot(options.snapshot)
  return store
}
