import { describe, expect, it } from "vitest"
import { DictValidator, T, UnionValidator } from "./T"

describe("DictValidator", () => {
  const validator = T.dict(T.string, T.number)

  it("is a DictValidator carrying both halves", () => {
    expect(validator).toBeInstanceOf(DictValidator)
    expect(validator.keyValidator).toBe(T.string)
    expect(validator.valueValidator).toBe(T.number)
  })

  it("checks every value and names the offending key", () => {
    expect(validator.validate({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(() => validator.validate({ a: 1, b: "two" })).toThrow(/At b:/)
  })

  it("checks the keys too", () => {
    const prefixed = T.dict(
      T.string.check("prefixed", (value) => {
        if (!value.startsWith("x")) throw new Error("expected an x-prefixed key")
      }),
      T.number,
    )
    expect(prefixed.isValid({ xa: 1 })).toBe(true)
    expect(prefixed.isValid({ ya: 1 })).toBe(false)
  })

  it("rejects non-objects", () => {
    expect(validator.isValid([])).toBe(false)
    expect(validator.isValid(null)).toBe(false)
  })

  it("composes like any other validator", () => {
    expect(validator.optional().isValid(undefined)).toBe(true)
    expect(validator.nullable().isValid(null)).toBe(true)
  })
})

describe("UnionValidator", () => {
  const validator = T.union("type", {
    circle: T.object({ type: T.literal("circle"), r: T.number }),
    square: T.object({ type: T.literal("square"), size: T.number }),
  })

  it("dispatches on the discriminant", () => {
    expect(validator).toBeInstanceOf(UnionValidator)
    expect(validator.validate({ type: "circle", r: 1 })).toEqual({ type: "circle", r: 1 })
    expect(() => validator.validate({ type: "circle", size: 1 })).toThrow()
  })

  it("names the discriminant in the error path", () => {
    expect(() => validator.validate({ type: "hexagon" })).toThrow(/At type:/)
    expect(() => validator.validate({})).toThrow(/At type:/)
  })

  it("rejects an unknown variant by default", () => {
    expect(validator.isValid({ type: "hexagon", n: 6 })).toBe(false)
  })

  it("keeps an unknown variant verbatim once allowed", () => {
    // The reason this exists: a document holding a shape type this build does
    // not know must survive a load and a save, not be deleted.
    const lenient = validator.validateUnknownVariants((value) => value)
    const unknown = { type: "hexagon", n: 6 }
    expect(lenient.validate(unknown)).toBe(unknown)
    expect(lenient.validate({ type: "circle", r: 2 })).toEqual({ type: "circle", r: 2 })
  })

  it("still validates known variants strictly when unknown ones are allowed", () => {
    const lenient = validator.validateUnknownVariants((value) => value)
    expect(() => lenient.validate({ type: "circle", r: "big" })).toThrow()
  })

  it("passes the variant name to the fallback", () => {
    const seen: string[] = []
    const lenient = validator.validateUnknownVariants((value, variant) => {
      seen.push(variant)
      return value
    })
    lenient.validate({ type: "hexagon" })
    expect(seen).toEqual(["hexagon"])
  })
})
