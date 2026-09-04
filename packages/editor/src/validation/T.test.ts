import { describe, expect, it } from "vitest"
import { T } from "./T"
import { ValidationError, Validator } from "./validator"
import { validateProps, isValidProps } from "./props"
import { DefaultColorStyle } from "../records/styleProp"

describe("primitives", () => {
  it("accepts and rejects by type, with a readable message", () => {
    expect(T.string.validate("hi")).toBe("hi")
    expect(() => T.string.validate(undefined)).toThrow("Expected string, got undefined")
    expect(() => T.string.validate(7)).toThrow("Expected string, got 7")
    expect(T.boolean.validate(false)).toBe(false)
    expect(() => T.boolean.validate("no")).toThrow('Expected boolean, got "no"')
  })

  it("rejects numbers that do not survive JSON", () => {
    expect(T.number.validate(-3.5)).toBe(-3.5)
    expect(() => T.number.validate(Number.NaN)).toThrow("finite")
    expect(() => T.number.validate(Infinity)).toThrow("finite")
  })

  it("distinguishes positive from non-zero", () => {
    expect(T.positiveNumber.validate(0)).toBe(0)
    expect(T.positiveNumber.validate(1080)).toBe(1080)
    expect(() => T.positiveNumber.validate(-1)).toThrow()
    expect(() => T.nonZeroNumber.validate(0)).toThrow()
    expect(T.nonZeroNumber.validate(0.5)).toBe(0.5)
  })

  it("checks integers", () => {
    expect(T.integer.validate(3)).toBe(3)
    expect(() => T.integer.validate(3.5)).toThrow("integer")
    expect(() => T.positiveInteger.validate(-2)).toThrow()
    expect(() => T.nonZeroInteger.validate(0)).toThrow()
  })

  it("has literals and literal enums", () => {
    expect(T.literal("a").validate("a")).toBe("a")
    expect(() => T.literal("a").validate("b")).toThrow('Expected "a", got "b"')
    const terminal = T.literalEnum("start", "end")
    expect(terminal.validate("end")).toBe("end")
    expect(() => terminal.validate("middle")).toThrow('Expected one of "start" or "end", got "middle"')
    const slot = T.literalEnum("top-right", "top-left", "free-edge")
    expect(() => slot.validate("nope")).toThrow('Expected one of "top-right", "top-left" or "free-edge", got "nope"')
  })

  it("passes anything through for any/unknown", () => {
    expect(T.unknown.validate(Symbol.iterator)).toBe(Symbol.iterator)
    expect(T.any.isValid(undefined)).toBe(true)
  })
})

describe("isValid", () => {
  it("answers without throwing", () => {
    expect(T.string.isValid("x")).toBe(true)
    expect(T.string.isValid(1)).toBe(false)
  })
})

describe("refinements", () => {
  it("check adds a constraint and keeps the type", () => {
    const even = T.integer.check("even", (value) => {
      if (value % 2 !== 0) throw new Error("not even")
    })
    expect(even.validate(4)).toBe(4)
    expect(() => even.validate(5)).toThrow("(check even) not even")
    expect(() => even.validate(5.5)).toThrow("integer")
  })

  it("check works without a name", () => {
    const short = T.string.check((value) => {
      if (value.length > 3) throw new Error("too long")
    })
    expect(() => short.validate("abcd")).toThrow("too long")
  })

  it("refine maps to another type", () => {
    const parsed = T.string.refine((value) => value.length)
    expect(parsed.validate("abcd")).toBe(4)
  })

  it("optional and nullable", () => {
    expect(T.string.optional().validate(undefined)).toBeUndefined()
    expect(() => T.string.optional().validate(null)).toThrow()
    expect(T.string.nullable().validate(null)).toBeNull()
    expect(T.optional(T.number).validate(undefined)).toBeUndefined()
    expect(T.nullable(T.number).validate(null)).toBeNull()
  })
})

describe("object", () => {
  const point = T.object({ x: T.number, y: T.number })

  it("validates every property and reports the path", () => {
    expect(point.validate({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 })
    expect(() => point.validate({ x: 1, y: "2" })).toThrow('At y: Expected number, got "2"')
    expect(() => point.validate({ x: 1 })).toThrow("At y: Expected number, got undefined")
  })

  it("rejects unknown properties unless told otherwise", () => {
    expect(() => point.validate({ x: 1, y: 2, z: 3 })).toThrow("At z: Unexpected property")
    expect(point.allowUnknownProperties().validate({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 })
  })

  it("makes a property with an optional validator optional", () => {
    const withOrder = T.object({ portId: T.string, order: T.number.optional() })
    expect(withOrder.validate({ portId: "a" })).toEqual({ portId: "a" })
    expect(withOrder.validate({ portId: "a", order: 2 })).toEqual({ portId: "a", order: 2 })
    expect(() => withOrder.validate({ portId: "a", order: "2" })).toThrow("At order:")
  })

  it("nests paths", () => {
    const nested = T.object({ anchor: point })
    expect(() => nested.validate({ anchor: { x: 1, y: null } })).toThrow("At anchor.y:")
  })

  it("extends", () => {
    const extended = point.extend({ z: T.number })
    expect(extended.validate({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 })
  })

  it("rejects non-objects", () => {
    expect(() => point.validate([])).toThrow("Expected an object, got an array")
    expect(() => point.validate(null)).toThrow("Expected an object, got null")
  })
})

describe("collections", () => {
  it("arrayOf reports the failing index", () => {
    const numbers = T.arrayOf(T.number)
    expect(numbers.validate([1, 2])).toEqual([1, 2])
    expect(() => numbers.validate([1, "2"])).toThrow("At 1: Expected number")
    expect(() => numbers.validate("nope")).toThrow("Expected an array")
    expect(() => numbers.nonEmpty().validate([])).toThrow("non-empty")
    expect(() => numbers.lengthGreaterThan1().validate([1])).toThrow("more than one")
  })

  it("setOf", () => {
    const set = T.setOf(T.string)
    expect(set.validate(new Set(["a"]))).toEqual(new Set(["a"]))
    expect(() => set.validate(new Set([1]))).toThrow("At 0:")
    expect(() => set.validate(["a"])).toThrow("Expected a Set")
  })

  it("dict", () => {
    const byId = T.dict(T.string, T.number)
    expect(byId.validate({ a: 1 })).toEqual({ a: 1 })
    expect(() => byId.validate({ a: "1" })).toThrow("At a:")
  })
})

describe("unions", () => {
  const shape = T.union("type", {
    circle: T.object({ type: T.literal("circle"), r: T.number }),
    rect: T.object({ type: T.literal("rect"), w: T.number, h: T.number }),
  })

  it("picks the member by the discriminant", () => {
    expect(shape.validate({ type: "rect", w: 1, h: 2 })).toEqual({ type: "rect", w: 1, h: 2 })
    expect(() => shape.validate({ type: "tri" })).toThrow('At type: Expected one of "circle" or "rect", got "tri"')
    expect(() => shape.validate({ type: "circle", r: "x" })).toThrow("At r:")
  })

  it("or tries both", () => {
    const stringOrNumber = T.or(T.string, T.number)
    expect(stringOrNumber.validate(1)).toBe(1)
    expect(stringOrNumber.validate("a")).toBe("a")
    expect(() => stringOrNumber.validate(true)).toThrow()
  })
})

describe("domain validators", () => {
  it("json values", () => {
    expect(T.jsonValue.isValid({ a: [1, "x", null] })).toBe(true)
    expect(T.jsonValue.isValid({ a: () => 1 })).toBe(false)
    expect(T.jsonValue.isValid(new Date())).toBe(false)
    expect(T.jsonObject.isValid([])).toBe(false)
  })

  it("record ids", () => {
    const shapeId = T.idOfType("shape")
    expect(shapeId.validate("shape:abc")).toBe("shape:abc")
    expect(() => shapeId.validate("page:abc")).toThrow("Expected a shape id")
    expect(() => shapeId.validate("shape:")).toThrow()
  })

  it("index keys", () => {
    expect(T.indexKey.validate("a1")).toBe("a1")
    expect(T.indexKey.isValid("")).toBe(false)
    expect(T.indexKey.isValid(1)).toBe(false)
  })

  it("vec and box models", () => {
    expect(T.vecModel.validate({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 })
    expect(T.vecModel.validate({ x: 1, y: 2, z: 0.5 })).toEqual({ x: 1, y: 2, z: 0.5 })
    expect(T.boxModel.isValid({ x: 0, y: 0, w: 1, h: 1 })).toBe(true)
  })

  it("urls", () => {
    expect(T.srcUrl.isValid("https://example.com/a.png")).toBe(true)
    expect(T.srcUrl.isValid("javascript:alert(1)")).toBe(false)
    expect(T.linkUrl.isValid("mailto:a@b.c")).toBe(true)
    expect(T.linkUrl.isValid("data:text/html,<script>")).toBe(false)
  })
})

describe("ValidationError", () => {
  it("keeps the raw message and the path apart", () => {
    const error = new ValidationError("Expected string, got 1", ["shape", "props", "name"])
    expect(error.rawMessage).toBe("Expected string, got 1")
    expect(error.path).toEqual(["shape", "props", "name"])
    expect(error.message).toBe("At shape.props.name: Expected string, got 1")
    expect(error.name).toBe("ValidationError")
    expect(error).toBeInstanceOf(Error)
  })
})

describe("validateProps", () => {
  const props = { w: T.positiveNumber, h: T.positiveNumber, name: T.string, color: DefaultColorStyle }

  it("validates a props object against a util's static props map", () => {
    expect(validateProps(props, { w: 1, h: 2, name: "a", color: "black" })).toEqual({
      w: 1,
      h: 2,
      name: "a",
      color: "black",
    })
  })

  it("accepts a StyleProp as a validator", () => {
    expect(isValidProps(props, { w: 1, h: 2, name: "a", color: "not-a-colour" })).toBe(false)
  })

  it("reports the path under a prefix", () => {
    expect(() => validateProps(props, { w: 1, h: "2", name: "a", color: "black" }, ["shape", "props"])).toThrow(
      "At shape.props.h:",
    )
  })

  it("rejects props the map does not declare", () => {
    expect(() => validateProps(props, { w: 1, h: 2, name: "a", color: "black", extra: 1 })).toThrow(
      "At extra: Unexpected property",
    )
  })

  it("takes any Validatable, not only a Validator", () => {
    const custom = { validate: (value: unknown) => value as string, isValid: () => true }
    expect(validateProps({ text: custom }, { text: "x" })).toEqual({ text: "x" })
  })
})

describe("Validator", () => {
  it("can be built by hand", () => {
    const v = new Validator<string>((value) => {
      if (typeof value !== "string") throw new ValidationError("nope")
      return value
    })
    expect(v.validate("a")).toBe("a")
    expect(v.isValid(1)).toBe(false)
  })
})
