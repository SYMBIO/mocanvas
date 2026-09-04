import { describe, expect, expectTypeOf, it } from "vitest"
import { T } from "../validation/T"
import { validateProps } from "../validation/props"
import type { RecordProps, RecordPropsType, ShapePropsForType, BindingPropsForType, ShapeTypeName } from "./props"
import type { Shape } from "./base"
import type { Binding } from "./binding"
import { DefaultColorStyle } from "./styleProp"

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

declare module "./props" {
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
    // A bare `Shape` stays exactly what it always was: usable for any type.
    expectTypeOf<Shape["props"]>().toEqualTypeOf<object>()
    expectTypeOf<Shape["type"]>().toEqualTypeOf<string>()
  })

  it("keeps arbitrary strings assignable to a shape type name", () => {
    const registered: ShapeTypeName = "testFormat"
    const custom: ShapeTypeName = "somethingElse"
    expect([registered, custom]).toHaveLength(2)
  })
})

describe("RecordProps", () => {
  it("describes a static props map for a shape", () => {
    const props = {
      w: T.positiveNumber,
      h: T.positiveNumber,
    } satisfies RecordProps<Shape<"testFormat">>
    expect(Object.keys(props)).toEqual(["w", "h"])
  })

  it("accepts a StyleProp where the prop's type matches", () => {
    const props = { color: DefaultColorStyle, label: T.string }
    expectTypeOf<RecordPropsType<typeof props>["color"]>().toEqualTypeOf<
      "black" | "grey" | "white" | "red" | "orange" | "yellow" | "green" | "blue" | "violet" | "light-blue" | "light-green" | "light-red" | "light-violet"
    >()
    expectTypeOf<RecordPropsType<typeof props>["label"]>().toEqualTypeOf<string>()
  })

  it("infers the props object a map describes, and validates against it", () => {
    const props = { w: T.positiveNumber, h: T.positiveNumber, order: T.number.optional() }
    type Props = RecordPropsType<typeof props>
    expectTypeOf<Props["w"]>().toEqualTypeOf<number>()
    expectTypeOf<Props["order"]>().toEqualTypeOf<number | undefined>()
    expect(validateProps(props, { w: 1, h: 2 })).toEqual({ w: 1, h: 2 })
  })
})
