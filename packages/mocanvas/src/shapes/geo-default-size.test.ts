import { describe, expect, it } from "vitest"
import { GEO_SHAPE_KINDS } from "@mocanvas/editor"
import { DEFAULT_GEO_CLICK_SIZE, DEFAULT_GEO_TYPE_DEFINITIONS, getGeoTypeDefinition } from "./geo-types"

/**
 * `defaultSize` was declared on `GeoTypeDefinition`, documented as "the size a
 * click places this silhouette at", populated by nothing and read by nothing —
 * so a click produced the util's own 100×100 box whatever the definition said.
 */
describe("the size a click places a geo shape at", () => {
  it("is declared by every built-in silhouette", () => {
    const missing = GEO_SHAPE_KINDS.filter((k) => !DEFAULT_GEO_TYPE_DEFINITIONS[k].defaultSize)
    expect(missing, "these declare no click size").toEqual([])
  })

  it("is the same box for all of them, which is a choice and not an oversight", () => {
    // The reference gives some kinds their own proportions. We have no measured
    // table for all twenty, so one honest box beats eighteen guesses — and an
    // app that wants per-kind sizes overrides the entry.
    for (const kind of GEO_SHAPE_KINDS) {
      expect(DEFAULT_GEO_TYPE_DEFINITIONS[kind].defaultSize).toEqual(DEFAULT_GEO_CLICK_SIZE)
    }
  })

  it("is reachable through the lookup a tool uses", () => {
    expect(getGeoTypeDefinition("rectangle")?.defaultSize).toEqual({ w: 200, h: 200 })
    expect(getGeoTypeDefinition("star")?.defaultSize).toEqual({ w: 200, h: 200 })
  })

  it("lets a custom definition override it", () => {
    const cog = { ...DEFAULT_GEO_TYPE_DEFINITIONS.rectangle, id: "cog", defaultSize: { w: 64, h: 64 } }
    expect(getGeoTypeDefinition("cog", { cog })?.defaultSize).toEqual({ w: 64, h: 64 })
  })

  it("may be omitted, and then the tool falls back rather than throwing", () => {
    const sizeless = { ...DEFAULT_GEO_TYPE_DEFINITIONS.rectangle, id: "sizeless", defaultSize: undefined }
    expect(getGeoTypeDefinition("sizeless", { sizeless })?.defaultSize).toBeUndefined()
  })
})
