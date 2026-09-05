import { describe, expect, it } from "vitest"
import { Rectangle2d } from "../geometry"
import { DEFAULT_THEME } from "../theme/DEFAULT_THEME"
import { getDisplayValues } from "../theme/displayValues"
import type { TLDefaultDisplayValues } from "../theme/types"
import type { BaseShape } from "../records/base"
import type { Editor } from "../editor/Editor"
import { ShapeUtil, UNKNOWN_EDIT_START_INFO, type ShapeUtilOptions } from "./ShapeUtil"
import { T } from "../validation/T"

type BadgeShape = BaseShape<"badge", { w: number; h: number; color: "blue" | "red" }>

interface BadgeDisplayValues extends TLDefaultDisplayValues {
  ringWidth: number
}

interface BadgeOptions extends ShapeUtilOptions<BadgeShape, BadgeDisplayValues> {
  ringWidth?: number
}

class BadgeUtil extends ShapeUtil<BadgeShape, BadgeDisplayValues> {
  static override type = "badge" as const
  static override props = { color: T.string }
  static override options: BadgeOptions = {
    // A method, so `this` is the options bag `configure()` produced.
    getDefaultDisplayValues(_editor, shape, theme, colorMode) {
      return {
        ...({} as TLDefaultDisplayValues),
        color: (theme.colors[colorMode][shape.props.color] as { solid?: string } | undefined)?.solid ?? "#000000",
        ringWidth: this.ringWidth ?? 1,
      }
    },
  }
  declare readonly options: BadgeOptions

  getDefaultProps(): BadgeShape["props"] {
    return { w: 10, h: 10, color: "blue" }
  }
  getGeometry(): Rectangle2d {
    return new Rectangle2d({ width: 10, height: 10, isFilled: true })
  }
  component(): null {
    return null
  }
}

const shape = { id: "shape:b", type: "badge", props: { w: 10, h: 10, color: "blue" } } as BadgeShape
const editor = {} as Editor

describe("ShapeUtil.options", () => {
  it("starts empty, so a util that configures nothing still has a bag to read", () => {
    class Plain extends BadgeUtil {
      static override options = {}
    }
    expect(new Plain(editor).options).toEqual({})
  })

  it("is the class's static options, read per instance", () => {
    expect(new BadgeUtil(editor).options.getDefaultDisplayValues).toBeTypeOf("function")
  })
})

describe("ShapeUtil.configure", () => {
  it("returns a copy whose options are the patch merged over the defaults", () => {
    const Configured = BadgeUtil.configure({ ringWidth: 4 })
    expect(Configured.options).toMatchObject({ ringWidth: 4 })
    // The rest of the bag survives the merge.
    expect((Configured.options as BadgeOptions).getDefaultDisplayValues).toBeTypeOf("function")
    expect(new Configured(editor).options.ringWidth).toBe(4)
  })

  it("does not mutate the util it was called on", () => {
    BadgeUtil.configure({ ringWidth: 9 })
    expect(BadgeUtil.options.ringWidth).toBeUndefined()
  })

  it("inherits the shape identity, so the store sees the same shape type", () => {
    const Configured = BadgeUtil.configure({ ringWidth: 2 })
    expect(Configured.type).toBe("badge")
    expect(Configured.props).toBe(BadgeUtil.props)
    expect(new Configured(editor)).toBeInstanceOf(BadgeUtil)
  })

  it("can be configured again, each copy independent of the last", () => {
    const a = BadgeUtil.configure({ ringWidth: 2 })
    const b = a.configure({ ringWidth: 3 })
    expect(a.options.ringWidth).toBe(2)
    expect(b.options.ringWidth).toBe(3)
  })
})

describe("display values through a util", () => {
  it("reads the util's own resolution rather than the shared default", () => {
    const values = getDisplayValues<BadgeShape, BadgeDisplayValues>(new BadgeUtil(editor), shape)
    expect(values.ringWidth).toBe(1)
    expect(values.color).toBe(DEFAULT_THEME.colors.light.blue?.solid)
  })

  it("lets getCustomDisplayValues override part of the result", () => {
    class Tinted extends BadgeUtil {
      override getCustomDisplayValues(): Partial<BadgeDisplayValues> {
        return { color: "#ff00ff" }
      }
    }
    const values = getDisplayValues<BadgeShape, BadgeDisplayValues>(new Tinted(editor), shape)
    expect(values.color).toBe("#ff00ff")
    // Everything it did not mention still comes from the defaults.
    expect(values.ringWidth).toBe(1)
  })

  it("picks up a configured option, so two editors can paint the same shape differently", () => {
    const Configured = BadgeUtil.configure({ ringWidth: 6 })
    expect(getDisplayValues<BadgeShape, BadgeDisplayValues>(new Configured(editor), shape).ringWidth).toBe(6)
  })
})

describe("the interaction hooks a v5 util may implement", () => {
  it("leaves onClick, getFontFaces and getCustomDisplayValues unimplemented by default", () => {
    const util = new BadgeUtil(editor)
    expect(util.onClick).toBeUndefined()
    expect(util.getFontFaces).toBeUndefined()
    expect(util.getCustomDisplayValues).toBeUndefined()
  })

  it("asks canEdit the plain question when the caller has no edit-start reason", () => {
    class Editable extends BadgeUtil {
      override canEdit(_shape: BadgeShape, info = UNKNOWN_EDIT_START_INFO): boolean {
        return info.type === "unknown" || info.type === "click-header"
      }
    }
    const util = new Editable(editor)
    expect(util.canEdit(shape)).toBe(true)
    expect(util.canEdit(shape, { type: "click-header" })).toBe(true)
    expect(util.canEdit(shape, { type: "double-click-edge" })).toBe(false)
  })
})
