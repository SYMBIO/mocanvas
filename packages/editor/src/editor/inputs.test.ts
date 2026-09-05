import { describe, expect, it } from "vitest"
import { Vec } from "../geometry"
import { InputsManager } from "./inputs"

/**
 * The accessors and the fields are one storage, and the editor's dispatch loop
 * writes the fields — so the contract worth pinning is that a write through
 * the field is visible through the accessor.
 */
describe("InputsManager", () => {
  it("starts with everything at rest", () => {
    const inputs = new InputsManager()
    expect(inputs.getIsPointing()).toBe(false)
    expect(inputs.getIsDragging()).toBe(false)
    expect(inputs.getIsPen()).toBe(false)
    expect(inputs.getCurrentPagePoint()).toEqual(new Vec(0, 0))
    expect(inputs.getKeys().size).toBe(0)
    expect(inputs.getButtons().size).toBe(0)
  })

  it("reads back what the dispatch loop wrote to the field", () => {
    const inputs = new InputsManager()
    inputs.isPointing = true
    inputs.currentPagePoint = new Vec(12, -4)
    inputs.shiftKey = true
    inputs.keys.add("KeyA")
    inputs.buttons.add(0)

    expect(inputs.getIsPointing()).toBe(true)
    expect(inputs.getCurrentPagePoint()).toEqual(new Vec(12, -4))
    expect(inputs.getShiftKey()).toBe(true)
    expect(inputs.getKeys().has("KeyA")).toBe(true)
    expect(inputs.getButtons().has(0)).toBe(true)
  })

  it("hands back the live point, not a copy — a gesture mutates it in place", () => {
    const inputs = new InputsManager()
    const point = inputs.getCurrentPagePoint()
    inputs.currentPagePoint.x = 9
    expect(point.x).toBe(9)
  })

  it("has an accessor for every field", () => {
    const inputs = new InputsManager()
    const accessorFor = (field: string) => `get${field[0]!.toUpperCase()}${field.slice(1)}`
    for (const field of Object.keys(inputs)) {
      const name = accessorFor(field)
      expect(typeof (inputs as unknown as Record<string, unknown>)[name], `${field} -> ${name}`).toBe("function")
    }
  })
})
