import { describe, expect, it } from "vitest"
import { createSchema, createStore, PATH_OP, type Geometry2d } from "@mocanvas/editor"
import { getGeoGeometry, mirrorPointsInBox, mirrorSegmentsInBox } from "./geo-helpers"
import { getGeoTypeDefinition } from "./geo-types"
import { GeoShapeUtil, geoShapeMigrations, geoShapeVersions, readGeoProps } from "./GeoShapeUtil"

const editor = { getEditingShapeId: () => null } as never

/** The outline's vertices, rounded so a mirror comparison is not float noise. */
function outline(geometry: Geometry2d): string[] {
  return geometry.vertices.map((v) => `${v.x.toFixed(4)},${v.y.toFixed(4)}`)
}

describe("mirroring a silhouette in its own box", () => {
  it("leaves points alone when nothing is flipped", () => {
    const points = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]
    expect(mirrorPointsInBox(points, 10, 10, undefined)).toEqual(points)
    expect(mirrorPointsInBox(points, 10, 10, { flipX: false, flipY: false })).toEqual(points)
  })

  it("reflects about the box centre, one axis at a time", () => {
    const points = [{ x: 2, y: 3 }]
    expect(mirrorPointsInBox(points, 10, 20, { flipX: true })).toEqual([{ x: 8, y: 3 }])
    expect(mirrorPointsInBox(points, 10, 20, { flipY: true })).toEqual([{ x: 2, y: 17 }])
    expect(mirrorPointsInBox(points, 10, 20, { flipX: true, flipY: true })).toEqual([{ x: 8, y: 17 }])
  })

  it("carries a cubic's control points with its anchors", () => {
    const segments = [{ p0: { x: 0, y: 0 }, c1: { x: 1, y: 0 }, c2: { x: 3, y: 4 }, p1: { x: 4, y: 4 } }]
    expect(mirrorSegmentsInBox(segments, 4, 4, { flipX: true })).toEqual([
      { p0: { x: 4, y: 0 }, c1: { x: 3, y: 0 }, c2: { x: 1, y: 4 }, p1: { x: 0, y: 4 } },
    ])
  })
})

describe("flipped geo geometry", () => {
  it("turns an asymmetric silhouette over — a triangle points down when flipped in y", () => {
    const upright = getGeoGeometry("triangle", 100, 60, false)
    const flipped = getGeoGeometry("triangle", 100, 60, false, { flipY: true })
    // The apex is the lone vertex on its own edge of the box.
    expect(upright.vertices.filter((v) => v.y === 0)).toHaveLength(1)
    expect(flipped.vertices.filter((v) => v.y === 60)).toHaveLength(1)
    expect(flipped.vertices.filter((v) => v.y === 0)).toHaveLength(2)
  })

  it("keeps the shape's bounds exactly, so a flip is not a move", () => {
    for (const flip of [{ flipX: true }, { flipY: true }, { flipX: true, flipY: true }]) {
      const g = getGeoGeometry("trapezoid", 120, 80, true, flip)
      expect(g.bounds.x).toBeCloseTo(0, 6)
      expect(g.bounds.y).toBeCloseTo(0, 6)
      expect(g.bounds.w).toBeCloseTo(120, 6)
      expect(g.bounds.h).toBeCloseTo(80, 6)
    }
  })

  it("leaves a silhouette that is its own mirror image unchanged", () => {
    for (const kind of ["rectangle", "ellipse", "diamond"] as const) {
      expect(outline(getGeoGeometry(kind, 90, 40, false, { flipX: true, flipY: true })).sort()).toEqual(
        outline(getGeoGeometry(kind, 90, 40, false)).sort(),
      )
    }
  })

  it("mirrors a curved outline as curves, not as a flattened polygon", () => {
    const upright = getGeoGeometry("heart", 100, 100, true)
    const flipped = getGeoGeometry("heart", 100, 100, true, { flipY: true })
    // Still cubics, and the same number of them: a mirror of a bézier is a
    // bézier, so nothing is resampled into line segments.
    const cubics = (g: Geometry2d): number => g.toPathWords().filter((w) => w === PATH_OP.CUBIC).length
    expect(cubics(flipped)).toBe(cubics(upright))
    expect(cubics(flipped)).toBeGreaterThan(0)
    expect(flipped.toPathWords()).not.toContain(PATH_OP.LINE)
  })

  it("mirrors decorations along with the body — a flipped check-box keeps its tick inside", () => {
    const g = getGeoGeometry("check-box", 100, 100, false, { flipX: true })
    for (const v of g.vertices) {
      expect(v.x).toBeGreaterThanOrEqual(-1e-6)
      expect(v.x).toBeLessThanOrEqual(100 + 1e-6)
    }
    expect(outline(g)).not.toEqual(outline(getGeoGeometry("check-box", 100, 100, false)))
  })

  it("reaches a geo type definition through its path options", () => {
    const flipped = getGeoTypeDefinition("triangle")!.getPath(100, 60, { isFilled: true, flipY: true })
    expect(flipped.vertices.filter((v) => v.y === 60)).toHaveLength(1)
  })
})

describe("GeoShapeUtil flip props", () => {
  const util = new GeoShapeUtil(editor)

  it("defaults both to false", () => {
    expect(util.getDefaultProps().flipX).toBe(false)
    expect(util.getDefaultProps().flipY).toBe(false)
  })

  it("reads a record that never had them as unflipped", () => {
    const props = readGeoProps({ props: { geo: "triangle", w: 10, h: 10 } })
    expect([props.flipX, props.flipY]).toEqual([false, false])
  })

  it("draws the flip it was asked for, without moving the shape", () => {
    const base = { ...util.getDefaultProps(), geo: "triangle" as const, w: 100, h: 60 }
    const upright = util.getGeometry({ id: "shape:a", type: "geo", props: base } as never)
    const flipped = util.getGeometry({ id: "shape:b", type: "geo", props: { ...base, flipY: true } } as never)
    expect(outline(flipped)).not.toEqual(outline(upright))
    expect(flipped.bounds.toJson()).toEqual(upright.bounds.toJson())
  })
})

describe("the geo props migration", () => {
  it("is one step, under the geo shape's own sequence id", () => {
    expect(geoShapeMigrations.sequence.map((m) => m.id)).toEqual([geoShapeVersions.AddFlipProps])
    // `com.mocanvas.`, not `com.tldraw.`: claiming the reference
    // implementation's geo sequence made every real `.tldr` fail to load,
    // because its geo line is far ahead of ours. See `tldr-compat.test.ts`.
    expect(geoShapeVersions.AddFlipProps).toBe("com.mocanvas.shape.geo/1")
    expect(GeoShapeUtil.migrations).toBe(geoShapeMigrations)
  })

  it("backfills both props as false, and leaves a stored value alone", () => {
    const [step] = geoShapeMigrations.sequence
    const old: Record<string, unknown> = { geo: "triangle" }
    step!.up(old)
    expect(old).toEqual({ geo: "triangle", flipX: false, flipY: false })

    const already: Record<string, unknown> = { geo: "triangle", flipX: true, flipY: false }
    step!.up(already)
    expect(already["flipX"]).toBe(true)
  })

  it("takes them away again on the way down, for an older client", () => {
    const props: Record<string, unknown> = { geo: "triangle", flipX: true, flipY: true }
    geoShapeMigrations.sequence[0]!.down!(props)
    expect(props).toEqual({ geo: "triangle" })
  })

  it("loads a board saved before the props existed", () => {
    // A serialized store as an older mocanvas wrote it: a geo shape with no
    // flip props, and a schema that had never heard of the migration.
    const before = {
      "document:document": { id: "document:document", typeName: "document", gridSize: 10, name: "" },
      "page:page": { id: "page:page", typeName: "page", name: "Page 1", index: "a1", meta: {} },
      "shape:old": {
        id: "shape:old",
        typeName: "shape",
        type: "geo",
        x: 0,
        y: 0,
        rotation: 0,
        index: "a1",
        parentId: "page:page",
        isLocked: false,
        opacity: 1,
        meta: {},
        props: { geo: "triangle", w: 100, h: 100, growY: 0, url: "", text: "", scale: 1 },
      },
    }

    const store = createStore({ shapeUtils: [GeoShapeUtil] })
    const older = createSchema([]).serialize()
    store.loadStoreSnapshot({ store: before, schema: older } as never)

    const shape = store.get("shape:old" as never) as unknown as { props: Record<string, unknown> }
    expect(shape.props["flipX"]).toBe(false)
    expect(shape.props["flipY"]).toBe(false)
  })

  it("is what backfills them — a store that never registered the util leaves them missing", () => {
    const before = {
      "shape:old": {
        id: "shape:old",
        typeName: "shape",
        type: "geo",
        x: 0,
        y: 0,
        rotation: 0,
        index: "a1",
        parentId: "page:page",
        isLocked: false,
        opacity: 1,
        meta: {},
        props: { geo: "triangle", w: 100, h: 100, growY: 0, url: "", text: "", scale: 1 },
      },
    }

    const store = createStore()
    store.loadStoreSnapshot({ store: before, schema: createSchema([]).serialize() } as never)
    const shape = store.get("shape:old" as never) as unknown as { props: Record<string, unknown> }
    expect(shape.props["flipX"]).toBeUndefined()
  })
})
