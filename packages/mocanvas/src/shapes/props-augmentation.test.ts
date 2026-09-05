import { describe, expect, expectTypeOf, it } from "vitest"
import type {
  Binding,
  BindingPropsForType,
  Shape,
  ShapeId,
  ShapePropsForType,
  ShapeTypeName,
  UnknownShape,
} from "@mocanvas/editor"

/**
 * A custom shape and binding registered the way a consumer package registers
 * one. This is the augmentation the whole feature exists for; if it stops
 * working, `pnpm typecheck` fails here rather than in someone's app.
 */
interface TestFormatShapeProps {
  w: number
  h: number
}
interface TestAnchorBindingProps {
  slot: "top-right" | "free-edge"
}

declare module "@mocanvas/editor" {
  interface TLGlobalShapePropsMap {
    testFormat: TestFormatShapeProps
  }
  interface TLGlobalBindingPropsMap {
    testAnchor: TestAnchorBindingProps
  }
}

describe("augmentable prop maps", () => {
  it("resolves a registered shape type's props", () => {
    expectTypeOf<ShapePropsForType<"testFormat">>().toEqualTypeOf<TestFormatShapeProps>()
    expectTypeOf<Shape<"testFormat">["props"]>().toEqualTypeOf<TestFormatShapeProps>()
    expectTypeOf<Shape<"testFormat">["type"]>().toEqualTypeOf<"testFormat">()
  })

  it("resolves a registered binding type's props", () => {
    expectTypeOf<BindingPropsForType<"testAnchor">>().toEqualTypeOf<TestAnchorBindingProps>()
    expectTypeOf<Binding<"testAnchor">["props"]>().toEqualTypeOf<TestAnchorBindingProps>()
  })

  it("falls back to open props for an unregistered type", () => {
    expectTypeOf<ShapePropsForType<"neverRegistered">>().toEqualTypeOf<object>()
    expectTypeOf<BindingPropsForType<"neverRegistered">>().toEqualTypeOf<object>()
    // An unregistered type still resolves to open props, so a shape nobody
    // declared is usable rather than an error.
    expectTypeOf<Shape<"neverRegistered">["props"]>().toEqualTypeOf<object>()
  })

  it("is a discriminated union, so a type check narrows the props", () => {
    // This is the point of the distribution: without it `Shape` is one
    // non-union type and `shape.type === "testFormat"` narrows nothing.
    expectTypeOf<Extract<Shape, { type: "testFormat" }>["props"]>().toEqualTypeOf<TestFormatShapeProps>()

    const read = (shape: Shape): number => {
      if (shape.type === "testFormat") return shape.props.w
      return 0
    }
    expect(read).toBeTypeOf("function")
  })

  it("uses UnknownShape for a type that is not known statically", () => {
    // `Shape` is the registered union, so a shape of an unregistered type is
    // an `UnknownShape` rather than a `Shape` — that split is what lets the
    // union stay narrowable.
    const loose: UnknownShape = {
      id: "shape:x" as ShapeId,
      typeName: "shape",
      type: "neverRegistered",
      x: 0,
      y: 0,
      rotation: 0,
      index: "a1" as UnknownShape["index"],
      parentId: "page:x" as UnknownShape["parentId"],
      isLocked: false,
      opacity: 1,
      props: { anything: true },
      meta: {},
    }
    expect(loose.type).toBe("neverRegistered")
  })

  it("keeps arbitrary strings assignable to a shape type name", () => {
    const registered: ShapeTypeName = "testFormat"
    const custom: ShapeTypeName = "somethingElse"
    expect([registered, custom]).toHaveLength(2)
  })
})
