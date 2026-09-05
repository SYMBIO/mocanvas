import { describe, expect, it } from "vitest"
import { GEO_KIND, GEO_SHAPE_KINDS, Rectangle2d, type Geometry2d } from "@mocanvas/editor"
import { DEFAULT_GEO_TYPE_DEFINITIONS, getGeoTypeDefinition, type GeoTypeDefinition } from "./geo-types"
import { GeoShapeUtil } from "./GeoShapeUtil"

const cog: GeoTypeDefinition = {
  id: "cog",
  getPath: (w, h) => new Rectangle2d({ width: w / 2, height: h / 2, isFilled: true }),
  snapType: "polygon",
  icon: "cog",
  defaultSize: { w: 64, h: 64 },
}

describe("the geo type table", () => {
  it("defines every built-in kind, keyed by the value stored in props.geo", () => {
    for (const kind of GEO_SHAPE_KINDS) {
      const def = getGeoTypeDefinition(kind)
      expect(def, kind).toBeDefined()
      expect(def?.id).toBe(kind)
    }
    expect(Object.keys(DEFAULT_GEO_TYPE_DEFINITIONS)).toHaveLength(GEO_SHAPE_KINDS.length)
  })

  it("snaps to the outline for cornered kinds and to the box for curved ones", () => {
    expect(getGeoTypeDefinition("rectangle")?.snapType).toBe("polygon")
    expect(getGeoTypeDefinition("star")?.snapType).toBe("polygon")
    expect(getGeoTypeDefinition("ellipse")?.snapType).toBe("blobby")
    expect(getGeoTypeDefinition("cloud")?.snapType).toBe("blobby")
    expect(getGeoTypeDefinition("heart")?.snapType).toBe("blobby")
  })

  it("draws the outline the shape itself draws, filling the requested box", () => {
    const geometry = getGeoTypeDefinition("hexagon")?.getPath(300, 200, { isFilled: true }) as Geometry2d
    expect(geometry.bounds.w).toBeCloseTo(300, 6)
    expect(geometry.bounds.h).toBeCloseTo(200, 6)
  })

  it("answers undefined for a type nothing defines, rather than guessing", () => {
    expect(getGeoTypeDefinition("cog")).toBeUndefined()
    expect(getGeoTypeDefinition("")).toBeUndefined()
  })

  it("lets a custom table add a type and replace a built-in one", () => {
    const custom = { cog, rectangle: { ...cog, id: "rectangle" } }
    expect(getGeoTypeDefinition("cog", custom)).toBe(cog)
    expect(getGeoTypeDefinition("rectangle", custom)?.icon).toBe("cog")
    // Untouched entries still come from the built-in table.
    expect(getGeoTypeDefinition("ellipse", custom)).toBe(DEFAULT_GEO_TYPE_DEFINITIONS.ellipse)
  })
})

describe("GeoShapeUtil.configure({ customGeoTypes })", () => {
  const editor = { getEditingShapeId: () => null } as never

  it("draws a custom geo type through its own definition", () => {
    const Configured = GeoShapeUtil.configure({ customGeoTypes: { cog } })
    const util = new Configured(editor)
    const shape = { id: "shape:c", type: "geo", props: { ...util.getDefaultProps(), geo: "cog", w: 200, h: 100 } }
    // The custom path is half the box, and it is the geometry — not a decoration
    // painted over the stock rectangle.
    expect(util.getGeometry(shape as never).bounds.w).toBeCloseTo(100, 6)
    expect(util.getGeometry(shape as never).bounds.h).toBeCloseTo(50, 6)
  })

  it("leaves the original util alone, so two editors can be configured differently", () => {
    GeoShapeUtil.configure({ customGeoTypes: { cog } })
    expect(GeoShapeUtil.options.customGeoTypes).toBeUndefined()
    expect(new GeoShapeUtil(editor).options.customGeoTypes).toBeUndefined()
  })

  it("keeps the shape type, so the store cannot tell a configured copy apart", () => {
    const Configured = GeoShapeUtil.configure({ customGeoTypes: { cog } })
    expect(Configured.type).toBe("geo")
    expect(Configured.props).toBe(GeoShapeUtil.props)
    expect(new Configured(editor).type).toBe("geo")
  })

  it("falls back to the rectangle for a geo value nothing defines", () => {
    const util = new GeoShapeUtil(editor)
    expect(util.getGeoTypeDefinition("nonesuch").id).toBe("rectangle")
  })
})

describe("the engine's geo kind table", () => {
  // The Rust generators are selected by an integer, so the two tables must stay
  // in the same order. Drift here silently draws the wrong silhouette rather
  // than failing, which is why this is pinned on both sides: the Rust half is
  // `ts_parity::the_kind_table_is_in_the_hosts_order`.
  it("matches GEO_SHAPE_KINDS position for position", () => {
    expect(GEO_SHAPE_KINDS.map((k) => GEO_KIND[k])).toEqual(GEO_SHAPE_KINDS.map((_, i) => i))
    expect(Object.keys(GEO_KIND)).toHaveLength(GEO_SHAPE_KINDS.length)
  })
})
