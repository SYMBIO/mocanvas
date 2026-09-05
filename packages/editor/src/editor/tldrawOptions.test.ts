import { describe, expect, it } from "vitest"
import { DEFAULT_EDITOR_CONFIG } from "./Editor"
import { defaultTldrawOptions } from "./tldrawOptions"
import { coreShapes, registerCoreShape, withCoreShapes } from "./coreShapes"
import { tlmenus } from "./tlmenus"
import type { ShapeUtilConstructor } from "../shapes/ShapeUtil"

describe("defaultTldrawOptions", () => {
  it("carries the documented defaults", () => {
    expect(defaultTldrawOptions.maxPages).toBe(40)
    expect(defaultTldrawOptions.maxShapesPerPage).toBe(4000)
    expect(defaultTldrawOptions.longPressDurationMs).toBe(500)
    expect(defaultTldrawOptions.actionShortcutsLocation).toBe("swap")
  })

  it("grades the grid from coarse to fine", () => {
    const steps = defaultTldrawOptions.gridSteps.map((step) => step.step)
    expect(steps).toEqual([...steps].sort((a, b) => b - a))
  })
})

describe("DEFAULT_EDITOR_CONFIG", () => {
  it("fills in every documented option", () => {
    for (const key of Object.keys(defaultTldrawOptions)) {
      expect(DEFAULT_EDITOR_CONFIG).toHaveProperty(key)
    }
  })

  it("keeps mocanvas's own tuned hit-test margins over the documented ones", () => {
    expect(DEFAULT_EDITOR_CONFIG.hitTestMargin).toBe(8)
    expect(DEFAULT_EDITOR_CONFIG.coarseHitTestMargin).toBe(12)
  })

  it("keeps the octave threshold apart from the documented shape-count one", () => {
    expect(DEFAULT_EDITOR_CONFIG.debouncedZoomOctaves).toBe(0.5)
    expect(DEFAULT_EDITOR_CONFIG.debouncedZoomThreshold).toBe(500)
  })
})

const FakeUtil = { type: "fake" } as unknown as ShapeUtilConstructor
const OtherUtil = { type: "other" } as unknown as ShapeUtilConstructor
const AppFake = { type: "fake" } as unknown as ShapeUtilConstructor

describe("coreShapes", () => {
  it("ships empty: this package has no shape types of its own", () => {
    expect(coreShapes).toEqual([])
  })

  it("puts a registered core shape before the app's", () => {
    const off = registerCoreShape(FakeUtil)
    try {
      expect(withCoreShapes([OtherUtil])).toEqual([FakeUtil, OtherUtil])
    } finally {
      off()
    }
    expect(coreShapes).toEqual([])
  })

  it("lets the app replace a core type", () => {
    const off = registerCoreShape(FakeUtil)
    try {
      expect(withCoreShapes([AppFake])).toEqual([AppFake])
    } finally {
      off()
    }
  })

  it("replaces rather than duplicates on a re-registration", () => {
    const off = registerCoreShape(FakeUtil)
    const off2 = registerCoreShape(AppFake)
    try {
      expect(coreShapes).toEqual([AppFake])
    } finally {
      off()
      off2()
    }
  })
})

describe("tlmenus", () => {
  it("keeps two contexts apart", () => {
    tlmenus.addOpenMenu("m", "a")
    expect(tlmenus.isMenuOpen("m", "a")).toBe(true)
    expect(tlmenus.isMenuOpen("m", "b")).toBe(false)
    tlmenus.clearOpenMenus("a")
  })

  it("records open order and is idempotent", () => {
    tlmenus.addOpenMenu("one", "ctx")
    tlmenus.addOpenMenu("two", "ctx")
    tlmenus.addOpenMenu("one", "ctx")
    expect(tlmenus.getOpenMenus("ctx")).toEqual(["one", "two"])
    tlmenus.deleteOpenMenu("one", "ctx")
    expect(tlmenus.getOpenMenus("ctx")).toEqual(["two"])
    tlmenus.clearOpenMenus("ctx")
    expect(tlmenus.getIsMenuOpen("ctx")).toBe(false)
  })
})
