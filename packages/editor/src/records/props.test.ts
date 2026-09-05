import { describe, expect, expectTypeOf, it } from "vitest"
import { T } from "../validation/T"
import { validateProps } from "../validation/props"
import type { RecordProps, RecordPropsType } from "./props"
import { DefaultColorStyle } from "./styleProp"

/**
 * The augmentation tests live in `@mocanvas/mocanvas`
 * (`shapes/props-augmentation.test.ts`), not here.
 *
 * Module augmentation is global to a compilation, so registering a shape type
 * from a test in THIS package would make `Shape` resolve to that one type for
 * the editor's own internals — which must stay usable with any shape. The
 * editor deliberately registers nothing; `mocanvas` registers the built-ins.
 */

describe("RecordProps", () => {
  it("describes a static props map for a shape", () => {
    const props = {
      w: T.positiveNumber,
      h: T.positiveNumber,
    } satisfies RecordProps<{ props: { w: number; h: number } }>
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
