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

export type EditorRecord = Document | Page | UnknownShape | UnknownBinding | Asset | Camera | Instance | InstancePageState
export type EditorStore = Store<EditorRecord, EditorStoreProps>
export type EditorStoreSnapshot = StoreSnapshot<EditorRecord>

export interface EditorStoreProps {
  defaultName: string
}

export interface CreateStoreOptions {
  migrations?: MigrationSequence[]
  initialData?: SerializedStore<EditorRecord>
  snapshot?: EditorStoreSnapshot
  defaultName?: string
  id?: string
}

export function createSchema(migrations: MigrationSequence[] = []): StoreSchema<EditorRecord, EditorStoreProps> {
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
    },
    { migrations },
  )
}

/** Create a store with the editor's record types. */
export function createStore(options: CreateStoreOptions = {}): EditorStore {
  const schema = createSchema(options.migrations)
  const store = new Store<EditorRecord, EditorStoreProps>({
    schema,
    ...(options.initialData ? { initialData: options.initialData } : {}),
    ...(options.id ? { id: options.id } : {}),
    props: { defaultName: options.defaultName ?? "" },
  })
  if (options.snapshot) store.loadStoreSnapshot(options.snapshot)
  return store
}
