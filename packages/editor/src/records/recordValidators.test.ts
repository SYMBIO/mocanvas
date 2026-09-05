import { describe, expect, it } from "vitest"
import { ZERO_INDEX_KEY } from "@mocanvas/store"
import { T } from "../validation/T"
import { DefaultColorStyle } from "./styleProp"
import {
  createAssetValidator,
  createBindingValidator,
  createShapeValidator,
} from "./recordValidators"
import { bindingIdValidator, idValidator, pageIdValidator, parentIdValidator, shapeIdValidator } from "./idValidators"
import { opacityValidator } from "./uiValues"
import { scribbleValidator } from "./scribble"
import { cursorValidator } from "./cursor"
import { ImageShapeCrop } from "./crop"

const shapeValidator = createShapeValidator("format", {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  color: DefaultColorStyle,
})

function makeShape(overrides: Record<string, unknown> = {}) {
  return {
    id: "shape:a",
    typeName: "shape",
    type: "format",
    x: 0,
    y: 0,
    rotation: 0,
    index: ZERO_INDEX_KEY,
    parentId: "page:home",
    isLocked: false,
    opacity: 1,
    props: { w: 10, h: 10, color: "red" },
    meta: {},
    ...overrides,
  }
}

describe("createShapeValidator", () => {
  it("accepts a well-formed shape", () => {
    expect(() => shapeValidator.validate(makeShape())).not.toThrow()
  })

  it("accepts a shape parented to another shape", () => {
    expect(() => shapeValidator.validate(makeShape({ parentId: "shape:frame" }))).not.toThrow()
  })

  it("rejects a bad prop, naming the path", () => {
    expect(() => shapeValidator.validate(makeShape({ props: { w: 0, h: 10, color: "red" } }))).toThrow(/props\.w/)
  })

  it("rejects a colour the style does not know", () => {
    expect(() => shapeValidator.validate(makeShape({ props: { w: 1, h: 1, color: "puce" } }))).toThrow(/props\.color/)
  })

  it("rejects an id of the wrong type", () => {
    expect(() => shapeValidator.validate(makeShape({ id: "page:a" }))).toThrow(/id/)
  })

  it("rejects a parent that is neither a page nor a shape", () => {
    expect(() => shapeValidator.validate(makeShape({ parentId: "asset:a" }))).toThrow(/parentId/)
  })

  it("rejects an opacity outside 0..1", () => {
    expect(() => shapeValidator.validate(makeShape({ opacity: 1.5 }))).toThrow(/opacity/)
  })

  it("rejects an unknown prop rather than silently keeping it", () => {
    expect(() => shapeValidator.validate(makeShape({ props: { w: 1, h: 1, color: "red", extra: 1 } }))).toThrow()
  })
})

describe("createBindingValidator", () => {
  const validator = createBindingValidator("arrow", { terminal: T.literalEnum("start", "end") })

  it("accepts a well-formed binding", () => {
    expect(() =>
      validator.validate({
        id: "binding:a",
        typeName: "binding",
        type: "arrow",
        fromId: "shape:a",
        toId: "shape:b",
        props: { terminal: "start" },
        meta: {},
      }),
    ).not.toThrow()
  })

  it("refuses a terminal pointing at a page", () => {
    expect(() =>
      validator.validate({
        id: "binding:a",
        typeName: "binding",
        type: "arrow",
        fromId: "shape:a",
        toId: "page:home",
        props: { terminal: "start" },
        meta: {},
      }),
    ).toThrow(/toId/)
  })
})

describe("createAssetValidator", () => {
  const validator = createAssetValidator("image", { w: T.number, h: T.number, src: T.srcUrl.nullable() })

  it("accepts a well-formed asset and rejects a script url", () => {
    expect(() =>
      validator.validate({
        id: "asset:a",
        typeName: "asset",
        type: "image",
        props: { w: 1, h: 1, src: "https://example.com/a.png" },
        meta: {},
      }),
    ).not.toThrow()
    expect(() =>
      validator.validate({
        id: "asset:a",
        typeName: "asset",
        type: "image",
        // eslint-disable-next-line no-script-url
        props: { w: 1, h: 1, src: "javascript:alert(1)" },
        meta: {},
      }),
    ).toThrow(/src/)
  })
})

describe("id validators", () => {
  it("check the prefix and that something follows it", () => {
    expect(shapeIdValidator.isValid("shape:a")).toBe(true)
    expect(shapeIdValidator.isValid("shape:")).toBe(false)
    expect(shapeIdValidator.isValid("page:a")).toBe(false)
    expect(pageIdValidator.isValid("page:home")).toBe(true)
    expect(bindingIdValidator.isValid("binding:a")).toBe(true)
    expect(idValidator("widget").isValid("widget:a")).toBe(true)
  })

  it("accept either kind of parent", () => {
    expect(parentIdValidator.isValid("page:home")).toBe(true)
    expect(parentIdValidator.isValid("shape:frame")).toBe(true)
    expect(parentIdValidator.isValid("binding:a")).toBe(false)
  })
})

describe("value validators", () => {
  it("bound opacity to 0..1", () => {
    expect(opacityValidator.isValid(0)).toBe(true)
    expect(opacityValidator.isValid(1)).toBe(true)
    expect(opacityValidator.isValid(-0.1)).toBe(false)
    expect(opacityValidator.isValid(1.1)).toBe(false)
  })

  it("accept a scribble in every documented state", () => {
    for (const state of ["starting", "paused", "active", "stopping"]) {
      expect(
        scribbleValidator.isValid({
          id: "s",
          points: [{ x: 0, y: 0 }],
          size: 4,
          color: "laser",
          opacity: 1,
          state,
          delay: 0,
          shrink: 0,
          taper: true,
        }),
      ).toBe(true)
    }
  })

  it("refuse a scribble coloured outside the canvas UI palette", () => {
    expect(
      scribbleValidator.isValid({
        id: "s",
        points: [],
        size: 4,
        color: "#ff0000",
        opacity: 1,
        state: "active",
        delay: 0,
        shrink: 0,
        taper: false,
      }),
    ).toBe(false)
  })

  it("accept a known cursor and refuse an invented one", () => {
    expect(cursorValidator.isValid({ type: "grabbing", rotation: 0 })).toBe(true)
    expect(cursorValidator.isValid({ type: "wobble", rotation: 0 })).toBe(false)
  })

  it("keep a crop inside the source", () => {
    expect(ImageShapeCrop.isValid({ topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } })).toBe(true)
    expect(ImageShapeCrop.isValid({ topLeft: { x: 0, y: 0 }, bottomRight: { x: 1.2, y: 1 } })).toBe(false)
  })
})
