import { describe, expect, it } from "vitest"
import { StoreSchema, type SerializedSchema, type UnknownRecord } from "@mocanvas/store"
import {
  bindingPropsMigrationSequenceId,
  createBindingPropsMigrationIds,
  createBindingPropsMigrationSequence,
  createPropsMigrationSequences,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  isPropsMigrations,
  shapePropsMigrationSequenceId,
  toMigrationSequence,
  type MigratableProps,
} from "./propsMigrations"

const sectionVersions = createShapePropsMigrationIds("section", { Initial: 1 })

const sectionMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: sectionVersions.Initial,
      up(props) {
        props["name"] ??= ""
        props["color"] ??= "neutral"
      },
      down(props) {
        delete props["name"]
        delete props["color"]
      },
    },
  ],
})

function shape(type: string, props: MigratableProps, id = "shape:a"): UnknownRecord {
  return { id, typeName: "shape", type, props } as unknown as UnknownRecord
}

describe("migration ids", () => {
  it("names a shape sequence after its type", () => {
    expect(sectionVersions.Initial).toBe("com.tldraw.shape.section/1")
    expect(shapePropsMigrationSequenceId("section")).toBe("com.tldraw.shape.section")
    const versions = createShapePropsMigrationIds("feedPostBlock", { AddAvatarUrl: 1, AddAuthorProfileId: 2 })
    expect(versions.AddAvatarUrl).toBe("com.tldraw.shape.feedPostBlock/1")
    expect(versions.AddAuthorProfileId).toBe("com.tldraw.shape.feedPostBlock/2")
  })

  it("names a binding sequence after its type", () => {
    const versions = createBindingPropsMigrationIds("stickyAnchor", { Initial: 1 })
    expect(versions.Initial).toBe("com.tldraw.binding.stickyAnchor/1")
    expect(bindingPropsMigrationSequenceId("stickyAnchor")).toBe("com.tldraw.binding.stickyAnchor")
  })
})

describe("createShapePropsMigrationSequence", () => {
  it("accepts an empty sequence — the day-one placeholder", () => {
    const empty = createShapePropsMigrationSequence({ sequence: [] })
    expect(empty.sequence).toEqual([])
    expect(isPropsMigrations(empty)).toBe(true)
    // and it still becomes a valid (no-op) store sequence
    const sequence = toMigrationSequence({ typeName: "shape", type: "format" }, empty)
    expect(sequence.sequenceId).toBe("com.tldraw.shape.format")
    expect(sequence.sequence).toEqual([])
  })

  it("keeps the authored steps callable on bare props", () => {
    const step = sectionMigrations.sequence[0]!
    const props: MigratableProps = {}
    step.up(props)
    expect(props).toEqual({ name: "", color: "neutral" })
    step.down!(props)
    expect(props).toEqual({})
  })

  it("rejects out-of-order versions", () => {
    const versions = createShapePropsMigrationIds("x", { A: 1, B: 3 })
    expect(() =>
      createShapePropsMigrationSequence({
        sequence: [
          { id: versions.A, up() {} },
          { id: versions.B, up() {} },
        ],
      }),
    ).toThrow("out of order")
  })

  it("rejects ids from two different types in one sequence", () => {
    expect(() =>
      createShapePropsMigrationSequence({
        sequence: [
          { id: createShapePropsMigrationIds("a", { V: 1 }).V, up() {} },
          { id: createShapePropsMigrationIds("b", { V: 2 }).V, up() {} },
        ],
      }),
    ).toThrow("does not belong")
  })

  it("rejects a step with no up function", () => {
    expect(() =>
      createShapePropsMigrationSequence({
        sequence: [{ id: sectionVersions.Initial } as unknown as { id: `${string}/${number}`; up: () => void }],
      }),
    ).toThrow("no up function")
  })

  it("createBindingPropsMigrationSequence behaves the same", () => {
    expect(createBindingPropsMigrationSequence({ sequence: [] }).sequence).toEqual([])
  })
})

describe("toMigrationSequence", () => {
  const sequence = toMigrationSequence({ typeName: "shape", type: "section" }, sectionMigrations)

  it("only touches records of its own type", () => {
    const migration = sequence.sequence[0]!
    expect(migration.scope).toBe("record")
    const filter = (migration as { filter?: (r: UnknownRecord) => boolean }).filter!
    expect(filter(shape("section", {}))).toBe(true)
    expect(filter(shape("format", {}))).toBe(false)
    expect(filter({ id: "page:a", typeName: "page" } as unknown as UnknownRecord)).toBe(false)
  })

  it("migrates props, not the record", () => {
    const migration = sequence.sequence[0]!
    const record = shape("section", { w: 1 })
    const next = (migration.up as (r: UnknownRecord) => UnknownRecord)(record)
    expect((next as unknown as { props: MigratableProps }).props).toEqual({ w: 1, name: "", color: "neutral" })
    // the input is left alone
    expect((record as unknown as { props: MigratableProps }).props).toEqual({ w: 1 })
  })

  it("leaves a record with no props object alone", () => {
    const migration = sequence.sequence[0]!
    const record = { id: "shape:a", typeName: "shape", type: "section" } as unknown as UnknownRecord
    expect((migration.up as (r: UnknownRecord) => UnknownRecord)(record)).toBe(record)
  })

  it("refuses ids belonging to another type", () => {
    expect(() => toMigrationSequence({ typeName: "shape", type: "format" }, sectionMigrations)).toThrow(
      'does not name shape "format"',
    )
  })

  it("is retroactive by default, so boards saved before the sequence get backfilled", () => {
    expect(sequence.retroactive).toBe(true)
    const notRetroactive = toMigrationSequence(
      { typeName: "shape", type: "section" },
      createShapePropsMigrationSequence({ sequence: sectionMigrations.sequence, retroactive: false }),
    )
    expect(notRetroactive.retroactive).toBe(false)
  })
})

describe("createPropsMigrationSequences", () => {
  it("collects sequences from shape and binding utils", () => {
    const bindingVersions = createBindingPropsMigrationIds("stickyAnchor", { Initial: 1 })
    const sequences = createPropsMigrationSequences({
      shapeUtils: [
        { type: "section", migrations: sectionMigrations },
        { type: "format", migrations: createShapePropsMigrationSequence({ sequence: [] }) },
        { type: "noMigrations" },
      ],
      bindingUtils: [
        {
          type: "stickyAnchor",
          migrations: createBindingPropsMigrationSequence({
            sequence: [{ id: bindingVersions.Initial, up(props) { props["mode"] ??= "automatic" } }],
          }),
        },
      ],
    })
    // "format" is deliberately absent: its sequence is empty, and an empty
    // sequence is not registered. Claiming an id at version 0 would refuse any
    // document carrying that id at a higher version, and there is nothing to
    // migrate in exchange. See `emptySequence.test.ts`.
    expect(sequences.map((s) => s.sequenceId)).toEqual([
      "com.tldraw.shape.section",
      "com.tldraw.binding.stickyAnchor",
    ])
  })

  it("passes an already-built store sequence through", () => {
    const built = toMigrationSequence({ typeName: "shape", type: "section" }, sectionMigrations)
    const [only] = createPropsMigrationSequences({ shapeUtils: [{ type: "section", migrations: built }] })
    expect(only).toBe(built)
  })

  it("complains about a migrations value that is neither", () => {
    expect(() => createPropsMigrationSequences({ shapeUtils: [{ type: "x", migrations: { nope: true } }] })).toThrow(
      "neither a props nor a store migration sequence",
    )
  })
})

describe("integration with the store schema", () => {
  const schema = StoreSchema.create<UnknownRecord>(
    {} as never,
    { migrations: createPropsMigrationSequences({ shapeUtils: [{ type: "section", migrations: sectionMigrations }] }) },
  )

  const beforeTheSequenceExisted: SerializedSchema = { schemaVersion: 2, sequences: {} }

  it("serializes the sequence version", () => {
    expect(schema.serialize()).toEqual({ schemaVersion: 2, sequences: { "com.tldraw.shape.section": 1 } })
  })

  it("backfills a record persisted before the sequence existed", () => {
    const result = schema.migratePersistedRecord(shape("section", { w: 1 }), beforeTheSequenceExisted, "up")
    expect(result.type).toBe("success")
    if (result.type !== "success") return
    expect((result.value as unknown as { props: MigratableProps }).props).toEqual({
      w: 1,
      name: "",
      color: "neutral",
    })
  })

  it("migrates a whole snapshot and leaves other shape types alone", () => {
    const result = schema.migrateStoreSnapshot({
      store: {
        "shape:a": shape("section", { w: 1 }, "shape:a"),
        "shape:b": shape("format", { w: 2 }, "shape:b"),
      } as never,
      schema: beforeTheSequenceExisted,
    })
    expect(result.type).toBe("success")
    if (result.type !== "success") return
    const store = result.value as unknown as Record<string, { props: MigratableProps }>
    expect(store["shape:a"]!.props).toEqual({ w: 1, name: "", color: "neutral" })
    expect(store["shape:b"]!.props).toEqual({ w: 2 })
  })

  it("runs down for a client reading newer data", () => {
    const current: SerializedSchema = { schemaVersion: 2, sequences: { "com.tldraw.shape.section": 0 } }
    const result = schema.migratePersistedRecord(shape("section", { w: 1, name: "n", color: "blue" }), current, "down")
    expect(result.type).toBe("success")
    if (result.type !== "success") return
    expect((result.value as unknown as { props: MigratableProps }).props).toEqual({ w: 1 })
  })
})
