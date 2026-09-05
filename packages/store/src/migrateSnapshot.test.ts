import { describe, expect, it } from "vitest"
import { createRecordType, type BaseRecord, type RecordId } from "./ids"
import { createMigrationIds, createRecordMigrationSequence, type SerializedSchemaV2, type SerializedStore } from "./migrate"
import { Store } from "./Store"
import { StoreSchema, type StoreSnapshot } from "./StoreSchema"

interface Widget extends BaseRecord<"widget", RecordId<Widget>> {
  label: string
  /** added in v1 */
  size?: number
}
type R = Widget

const Widget = createRecordType<Widget>("widget", { scope: "document" })

const versions = createMigrationIds("com.test.widget", { AddSize: 1 })
const widgetMigrations = createRecordMigrationSequence({
  sequenceId: "com.test.widget",
  recordType: "widget",
  sequence: [
    {
      id: versions.AddSize,
      up(record) {
        ;(record as Widget).size = 42
      },
    },
  ],
})

function makeStore() {
  const schema = StoreSchema.create<R>({ widget: Widget }, { migrations: [widgetMigrations] })
  return new Store<R>({ schema, props: undefined })
}

/** A document written before the `size` prop existed. */
function legacySnapshot(): StoreSnapshot<R> {
  return {
    store: {
      "widget:a": { id: "widget:a", typeName: "widget", label: "old" },
    } as unknown as SerializedStore<R>,
    schema: { schemaVersion: 2, sequences: { "com.test.widget": 0 } },
  }
}

describe("Store.migrateSnapshot", () => {
  it("runs the schema's sequences and stamps the current schema", () => {
    const store = makeStore()
    const migrated = store.migrateSnapshot(legacySnapshot())
    expect(migrated.store["widget:a" as keyof typeof migrated.store]).toEqual({
      id: "widget:a",
      typeName: "widget",
      label: "old",
      size: 42,
    })
    expect(migrated.schema).toEqual(store.schema.serialize())
  })

  it("does not mutate the snapshot it was given", () => {
    const store = makeStore()
    const input = legacySnapshot()
    store.migrateSnapshot(input)
    expect(input.store["widget:a" as keyof typeof input.store]).toEqual({
      id: "widget:a",
      typeName: "widget",
      label: "old",
    })
    expect((input.schema as SerializedSchemaV2).sequences).toEqual({ "com.test.widget": 0 })
  })

  it("is a no-op for a snapshot already at the current version", () => {
    const store = makeStore()
    const current = store.migrateSnapshot(legacySnapshot())
    expect(store.migrateSnapshot(current)).toEqual(current)
  })

  it("feeds loadStoreSnapshot, which is idempotent on an already-migrated snapshot", () => {
    const store = makeStore()
    store.loadStoreSnapshot(store.migrateSnapshot(legacySnapshot()))
    expect(store.get("widget:a" as RecordId<Widget>)).toEqual({
      id: "widget:a",
      typeName: "widget",
      label: "old",
      size: 42,
    })
  })

  it("throws rather than returning half-migrated data for a NEWER document", () => {
    const store = makeStore()
    expect(() =>
      store.migrateSnapshot({
        store: {} as SerializedStore<R>,
        schema: { schemaVersion: 2, sequences: { "com.test.widget": 9 } },
      }),
    ).toThrow(/newer version/)
  })

  it("throws on an unsupported schema version", () => {
    const store = makeStore()
    expect(() =>
      store.migrateSnapshot({
        store: {} as SerializedStore<R>,
        schema: { schemaVersion: 99 } as unknown as StoreSnapshot<R>["schema"],
      }),
    ).toThrow(/Failed to migrate snapshot/)
  })
})
