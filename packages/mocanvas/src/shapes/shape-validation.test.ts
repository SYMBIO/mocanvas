/**
 * The store rejects records that do not match the schema.
 *
 * This is the end of the chain that starts at a util's `static props`:
 * `shape-props.ts` registers the built-in maps, `createSchema()` turns them
 * into the `shape` record type's validator, and `Store.put` runs it. Every link
 * was in place except the last two, so for several releases `static props`
 * documented a contract nothing checked and the store accepted anything.
 *
 * These tests assert the *rejections*. A suite that only ever asserts what is
 * accepted passes just as happily with validation turned off — which is exactly
 * how this went unnoticed.
 */

import { describe, expect, it } from "vitest"
import {
  Rectangle2d,
  ShapeUtil,
  createSchema,
  createShapeId,
  createStore,
  T,
  type Geometry2d,
  type UnknownShape,
} from "@mocanvas/editor"
import { GeoShapeUtil } from "./GeoShapeUtil"
import { geoShapeProps } from "./shape-props"

/** A geo shape that satisfies every validator in `geoShapeProps`. */
function validGeo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "shape:g1",
    typeName: "shape",
    type: "geo",
    parentId: "page:p1",
    index: "a1",
    x: 0,
    y: 0,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {
      geo: "rectangle",
      w: 100,
      h: 100,
      color: "black",
      labelColor: "black",
      fill: "none",
      dash: "draw",
      size: "m",
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      growY: 0,
      url: "",
      richText: { type: "doc", content: [] },
      text: "",
      scale: 1,
      flipX: false,
      flipY: false,
    },
    ...overrides,
  }
}

/**
 * The shapes in a store.
 *
 * Not `allRecords()`: a new store is seeded with its document and first page,
 * so a count of everything answers "is the store empty", which is not what any
 * of these assert. What they assert is that the rejected record did not land.
 */
function shapesIn(store: ReturnType<typeof createStore>) {
  return store.allRecords().filter((r) => r.typeName === "shape")
}

describe("store.put", () => {
  it("rejects a record with no typeName at all", () => {
    const store = createStore()
    expect(() => store.put([{ id: "shape:bogus", x: 0, y: 0 } as never])).toThrow(/typeName/)
    expect(shapesIn(store)).toHaveLength(0)
  })

  it("rejects a record whose typeName is not a string", () => {
    const store = createStore()
    expect(() => store.put([{ id: "shape:bogus", typeName: 7 } as never])).toThrow(/typeName/)
    expect(shapesIn(store)).toHaveLength(0)
  })

  it("rejects a record with no id", () => {
    const store = createStore()
    expect(() => store.put([{ typeName: "shape", type: "geo" } as never])).toThrow(/id/)
    expect(shapesIn(store)).toHaveLength(0)
  })

  it("rejects a registered shape type whose props are empty", () => {
    const store = createStore()
    expect(() => store.put([validGeo({ props: {} }) as never])).toThrow(/props/)
    expect(shapesIn(store)).toHaveLength(0)
  })

  it("rejects a registered shape type whose props are the wrong type", () => {
    const store = createStore()
    // `w` is `T.nonZeroNumber`; the map has said so since 2.0.0.
    expect(() => store.put([validGeo({ props: { ...(validGeo().props as object), w: 0 } }) as never])).toThrow(
      /props\.w/,
    )
    // `color` is a style, and "puce" is not one of its values.
    expect(() =>
      store.put([validGeo({ props: { ...(validGeo().props as object), color: "puce" } }) as never]),
    ).toThrow(/props\.color/)
  })

  it("rejects a malformed envelope around well-formed props", () => {
    const store = createStore()
    expect(() => store.put([validGeo({ parentId: "asset:nope" }) as never])).toThrow(/parentId/)
    expect(() => store.put([validGeo({ opacity: 4 }) as never])).toThrow(/opacity/)
    expect(() => store.put([validGeo({ index: "" }) as never])).toThrow(/index/)
    expect(() => store.put([validGeo({ id: "page:g1" }) as never])).toThrow(/id/)
  })

  it("still accepts a valid record", () => {
    const store = createStore()
    store.put([validGeo() as never])
    expect(shapesIn(store)).toHaveLength(1)
    expect((store.get("shape:g1" as never) as unknown as UnknownShape).type).toBe("geo")
  })

  it("keeps props no util declares, so a `.tldr` from a newer writer round-trips", () => {
    // The other half of the contract. Undeclared props are carried through
    // untouched; it is the DECLARED ones that are checked.
    const store = createStore()
    store.put([validGeo({ props: { ...(validGeo().props as object), somethingNewer: 42 } }) as never])
    const shape = store.get("shape:g1" as never) as unknown as UnknownShape
    expect((shape.props as Record<string, unknown>)["somethingNewer"]).toBe(42)
  })

  it("passes a shape type nobody declared props for through untouched", () => {
    // Foreign data, not invalid data: rejecting it would delete a shape an app
    // registered in a newer build on the next save.
    const store = createStore()
    store.put([validGeo({ id: "shape:x", type: "from-the-future", props: { anything: true } }) as never])
    expect(store.get("shape:x" as never)).toBeDefined()
  })

  it("rejects a shape whose `type` is not a string — there is nothing to dispatch on", () => {
    const store = createStore()
    expect(() => store.put([validGeo({ type: 3 }) as never])).toThrow(/type/)
  })
})

describe("schema.validateRecord", () => {
  it("rejects the same records store.put does", () => {
    const store = createStore()
    const schema = createSchema()
    expect(() => schema.validateRecord(store as never, validGeo({ props: {} }) as never, "createRecord", undefined)).toThrow(
      /props/,
    )
    expect(() =>
      schema.validateRecord(store as never, { id: "shape:bogus", x: 0 } as never, "createRecord", undefined),
    ).toThrow(/typeName/)
  })

  it("accepts a valid record and hands it back", () => {
    const store = createStore()
    const schema = createSchema()
    const validated = schema.validateRecord(store as never, validGeo() as never, "createRecord", undefined)
    expect(validated.id).toBe("shape:g1")
  })

  it("names the record type and the prop that failed, not just \"invalid\"", () => {
    const store = createStore()
    const schema = createSchema()
    expect(() =>
      schema.validateRecord(store as never, validGeo({ props: {} }) as never, "initialize", undefined),
    ).toThrow(/shape:geo\.props/)
  })
})

describe("a shape type a consumer registers", () => {
  /** A shape type of an app's own, exactly as a consumer would write it. */
  class BadgeShapeUtil extends ShapeUtil<UnknownShape & { props: { w: number; badge: string } }> {
    static override type = "badge"
    static override props = { w: T.nonZeroNumber, badge: T.string }
    override getDefaultProps(): { w: number; badge: string } {
      return { w: 10, badge: "" }
    }
    override getGeometry(): Geometry2d {
      return new Rectangle2d({ width: 10, height: 10, isFilled: true })
    }
    override component(): null {
      return null
    }
  }

  function badge(props: Record<string, unknown>, id = "shape:b1"): Record<string, unknown> {
    return { ...validGeo({ id, type: "badge" }), props }
  }

  it("has its own validators enforced", () => {
    const store = createStore({ shapeUtils: [BadgeShapeUtil as never] })

    // A prop the consumer declared but the record omits.
    expect(() => store.put([badge({ w: 10 }) as never])).toThrow(/props\.badge/)
    // A prop of the wrong type.
    expect(() => store.put([badge({ w: 10, badge: 7 }, "shape:b2") as never])).toThrow(/props\.badge/)
    // A prop the consumer's own validator refuses.
    expect(() => store.put([badge({ w: 0, badge: "ok" }, "shape:b3") as never])).toThrow(/props\.w/)
    expect(shapesIn(store)).toHaveLength(0)

    store.put([badge({ w: 10, badge: "new" }) as never])
    expect(store.get("shape:b1" as never)).toBeDefined()
  })

  it("is not validated at all when it declares no props", () => {
    // Declaring `static props` is what opts a type into being checked; a util
    // without one keeps the pre-2.0 behaviour rather than becoming unusable.
    class LooseShapeUtil extends BadgeShapeUtil {
      static override type = "loose"
      static override props = undefined as never
    }
    const store = createStore({ shapeUtils: [LooseShapeUtil as never] })
    store.put([{ ...validGeo({ id: "shape:l1", type: "loose" }), props: { nonsense: true } } as never])
    expect(store.get("shape:l1" as never)).toBeDefined()
  })

  it("overrides the built-in map of the same name rather than being ignored", () => {
    class StrictGeoShapeUtil extends GeoShapeUtil {
      static override props = { ...geoShapeProps, w: T.number.check("small", (v) => {
        if (v > 10) throw new Error("Expected a width of at most 10")
      }) }
    }
    const store = createStore({ shapeUtils: [StrictGeoShapeUtil as never] })
    expect(() => store.put([validGeo() as never])).toThrow(/props\.w/)
  })
})

describe("editor-created shapes", () => {
  it("cannot create a shape whose props the util does not accept", () => {
    const store = createStore({ shapeUtils: [GeoShapeUtil as never] })
    const id = createShapeId()
    expect(() =>
      store.put([validGeo({ id, props: { ...(validGeo().props as object), geo: "not-a-geo-kind" } }) as never]),
    ).toThrow(/props\.geo/)
  })
})

/**
 * A store built with no shape utils.
 *
 * This is the shape of store a sync backend, a headless export or a test gets,
 * and it has no props map for any type — so nothing could check `props`. What
 * it can still check is everything else, which does not depend on which utils
 * were passed. Before this it checked nothing at all and took
 * `x: "NOT A NUMBER"`.
 */
describe("store.put with no shape utils", () => {
  it("still rejects a base field of the wrong type", () => {
    const store = createStore()
    expect(() => store.put([validGeo({ x: "NOT A NUMBER" }) as never])).toThrow(/x/)
    expect(() => store.put([validGeo({ rotation: "sideways" }) as never])).toThrow(/rotation/)
    expect(() => store.put([validGeo({ index: "" }) as never])).toThrow(/index/)
    expect(() => store.put([validGeo({ opacity: 4 }) as never])).toThrow(/opacity/)
    expect(() => store.put([validGeo({ isLocked: "yes" }) as never])).toThrow(/isLocked/)
    expect(shapesIn(store)).toHaveLength(0)
  })

  it("still keeps the props of a type nothing declares, so a round trip does not lose them", () => {
    // The forward-compatibility policy is about props and only props: a `.tldr`
    // written by a newer build may carry a shape type this one has never heard
    // of. Its props are kept verbatim — but its `x` is still a number.
    const store = createStore()
    const foreign = validGeo({ type: "supernova", props: { intensity: "high", nested: { ok: true } } })
    store.put([foreign as never])
    const [shape] = shapesIn(store)
    expect((shape as { props: Record<string, unknown> }).props).toEqual({ intensity: "high", nested: { ok: true } })
    expect(() => store.put([validGeo({ id: "shape:g2", type: "supernova", x: "NOT A NUMBER" }) as never])).toThrow(/x/)
  })

  it("still rejects a record with no typeName", () => {
    const store = createStore()
    expect(() => store.put([{ id: "shape:bogus", type: "geo", x: 0, y: 0 } as never])).toThrow(/typeName/)
  })
})
