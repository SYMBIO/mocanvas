/**
 * Custom record types: an app's own top-level entities, declared through
 * `createTLSchema({ records })` and stored alongside shapes and pages.
 */
import { describe, expect, it } from "vitest"
import { T } from "../validation/T"
import { createStore, createSchema } from "../editor/createStore"
import { createCustomRecord, createCustomRecordTypeMap, validateCustomRecordInfos } from "./schemaRecords"
import { CUSTOM_RECORD_TYPE_NAME, createCustomRecordId, isCustomRecordId, type CustomRecordInfo } from "./customRecord"

const review: CustomRecordInfo<"review"> = {
  type: "review",
  props: { status: T.string, assignee: T.string.nullable() },
  getDefaultProps: () => ({ status: "open", assignee: null }) as never,
}
const checklist: CustomRecordInfo<"checklist"> = {
  type: "checklist",
  props: { done: T.boolean },
  getDefaultProps: () => ({ done: false }) as never,
}
const records = { review, checklist }

describe("custom record types", () => {
  it("puts one entry in the schema, dispatching on the record's own type", () => {
    const store = createStore({ records })
    const rec = createCustomRecord(review, { status: "open", assignee: null } as never)
    store.put([rec as never])
    expect(store.get(rec.id as never)).toBeDefined()
  })

  it("validates each type against its own props, not a shared shape", () => {
    const map = createCustomRecordTypeMap(records)
    const good = createCustomRecord(checklist, { done: true } as never)
    expect(() => map.validate(good)).not.toThrow()
    // `done` is a boolean on a checklist; a review has no such prop.
    const wrong = { ...good, props: { done: "yes" } }
    expect(() => map.validate(wrong)).toThrow()
  })

  it("refuses a record of a type nobody declared", () => {
    const map = createCustomRecordTypeMap(records)
    const stray = { ...createCustomRecord(review, { status: "open", assignee: null } as never), type: "invoice" }
    expect(() => map.validate(stray)).toThrow(/Unknown custom record type/)
  })

  it("carries the type in the id, so an id alone says what it refers to", () => {
    const id = createCustomRecordId("review")
    expect(isCustomRecordId(id, "review")).toBe(true)
    expect(isCustomRecordId(id, "checklist")).toBe(false)
    expect(id.startsWith(`${CUSTOM_RECORD_TYPE_NAME}:`)).toBe(true)
  })

  it("refuses a declaration that shadows a built-in record type", () => {
    expect(() => validateCustomRecordInfos({ shape: { type: "shape", props: {} } as never })).toThrow()
  })

  it("survives a schema round trip", () => {
    const schema = createSchema({ records })
    expect(schema.serialize().sequences).toBeDefined()
    const store = createStore({ records })
    const rec = createCustomRecord(review, { status: "blocked", assignee: "ada" } as never)
    store.put([rec as never])
    const snapshot = store.getStoreSnapshot()
    const reloaded = createStore({ records })
    reloaded.loadStoreSnapshot(snapshot)
    expect(reloaded.get(rec.id as never)).toMatchObject({ type: "review" })
  })
})
