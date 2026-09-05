/**
 * An empty props-migration sequence must not be registered.
 *
 * A `.tldr` records the version of every sequence it was written under. A
 * sequence the schema does not know is ignored with a warning; one it *claims to
 * know* at a lower version is a hard failure. An empty sequence migrates
 * nothing, so claiming its id buys nothing and can only refuse documents.
 */
import { describe, expect, it } from "vitest"
import { createSchema } from "../editor/createStore"
import { createShapePropsMigrationSequence, createShapePropsMigrationIds } from "./propsMigrations"

const emptyUtil = {
  type: "placeholder",
  migrations: createShapePropsMigrationSequence({ sequence: [] }),
}
const versions = createShapePropsMigrationIds("filled", { First: 1 })
const filledUtil = {
  type: "filled",
  migrations: createShapePropsMigrationSequence({
    sequence: [{ id: versions.First, up(props: Record<string, unknown>) { props["added"] ??= true } }],
  }),
}

describe("an empty props migration sequence", () => {
  it("is legal to author, and readable by the author", () => {
    expect(emptyUtil.migrations.sequence).toEqual([])
  })

  it("does not appear in the schema's sequences map", () => {
    const schema = createSchema({ shapeUtils: [emptyUtil, filledUtil] })
    const ids = Object.keys(schema.serialize().sequences)
    expect(ids.some((id) => id.endsWith(".placeholder"))).toBe(false)
    // The non-empty one is registered, so this is testing the skip and not an
    // accidentally empty schema.
    expect(ids.some((id) => id.endsWith(".filled"))).toBe(true)
  })

  it("leaves a document that declares that id at a higher version loadable", () => {
    const schema = createSchema({ shapeUtils: [emptyUtil] })
    const serialized = schema.serialize()
    const fromTheFuture = {
      ...serialized,
      sequences: { ...serialized.sequences, "com.tldraw.shape.placeholder": 12 },
    }
    // Unknown id -> ignored. Had it been registered at 0, this would throw.
    expect(() => schema.migrateStoreSnapshot({ store: {}, schema: fromTheFuture } as never)).not.toThrow()
  })
})
