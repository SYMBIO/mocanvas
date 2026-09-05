import { describeValue, listForMessage, ValidationError } from "../validation/validator"
import {
  ARROWHEAD_KINDS,
  ARROW_SHAPE_KINDS,
  DEFAULT_COLORS,
  DEFAULT_DASHES,
  DEFAULT_FILLS,
  DEFAULT_FONTS,
  DEFAULT_H_ALIGNS,
  DEFAULT_SIZES,
  DEFAULT_TEXT_ALIGNS,
  DEFAULT_V_ALIGNS,
  ELBOW_ARROW_SNAP_MODES,
  GEO_SHAPE_KINDS,
  LINE_SPLINE_KINDS,
  type DefaultColorStyle as ColorValue,
  type DefaultDashStyle as DashValue,
  type DefaultFillStyle as FillValue,
  type DefaultFontStyle as FontValue,
  type DefaultHorizontalAlignStyle as HAlignValue,
  type DefaultSizeStyle as SizeValue,
  type DefaultTextAlignStyle as TextAlignValue,
  type DefaultVerticalAlignStyle as VAlignValue,
  type ArrowShapeArrowheadKind,
  type ArrowShapeKind,
  type ElbowArrowSnapMode,
  type LineShapeSplineKind,
} from "./styles"

/**
 * A shape prop that is a *style*: shared across shape types, remembered for
 * the next created shape, and editable for a whole selection at once.
 */
export class StyleProp<T> {
  /** Define a style with a free-form value. */
  static define<T>(id: string, options: { defaultValue: T; validate?: (value: unknown) => T }): StyleProp<T> {
    return new StyleProp(id, options.defaultValue, options.validate)
  }

  /** Define a style whose value is one of a fixed set of strings. */
  static defineEnum<const V extends readonly string[]>(id: string, options: { defaultValue: V[number]; values: V }): EnumStyleProp<V[number]> {
    return new EnumStyleProp(id, options.defaultValue, options.values)
  }

  protected constructor(
    readonly id: string,
    readonly defaultValue: T,
    private readonly validator?: (value: unknown) => T,
  ) {}

  validate(value: unknown): T {
    return this.validator ? this.validator(value) : (value as T)
  }

  /**
   * Whether `value` is a legal value for this style. Present so that a style
   * prop can stand in for a validator wherever a `static props` map is read.
   */
  isValid(value: unknown): boolean {
    try {
      this.validate(value)
      return true
    } catch {
      return false
    }
  }
}

export class EnumStyleProp<T extends string> extends StyleProp<T> {
  /**
   * The accepted values — this style prop's OWN array, copied from the caller's.
   *
   * `registerColorsFromThemes` extends this list in place (the validator closes
   * over the same array, so replacing it would leave the validator behind). The
   * copy is what keeps that in-place edit from reaching back into the tuple the
   * caller passed in: `DefaultColorStyle` is built from the exported
   * `DEFAULT_COLORS`, and sharing the array made registering an app's palette
   * silently rewrite `DEFAULT_COLORS` for everyone importing it.
   */
  readonly values: readonly T[]

  constructor(id: string, defaultValue: T, values: readonly T[]) {
    const own: T[] = [...values]
    super(id, defaultValue, (v) => {
      if (typeof v !== "string" || !(own as readonly string[]).includes(v)) {
        throw new ValidationError(
          `Expected one of ${listForMessage(own.map((value) => JSON.stringify(value)))}, got ${describeValue(v)}`,
        )
      }
      return v as T
    })
    this.values = own
  }
}

export const DefaultColorStyle = StyleProp.defineEnum("mocanvas:color", { defaultValue: "black", values: DEFAULT_COLORS })
export const DefaultLabelColorStyle = StyleProp.defineEnum("mocanvas:labelColor", { defaultValue: "black", values: DEFAULT_COLORS })
export const DefaultFillStyle = StyleProp.defineEnum("mocanvas:fill", { defaultValue: "none", values: DEFAULT_FILLS })
export const DefaultDashStyle = StyleProp.defineEnum("mocanvas:dash", { defaultValue: "draw", values: DEFAULT_DASHES })
export const DefaultSizeStyle = StyleProp.defineEnum("mocanvas:size", { defaultValue: "m", values: DEFAULT_SIZES })
export const DefaultFontStyle = StyleProp.defineEnum("mocanvas:font", { defaultValue: "draw", values: DEFAULT_FONTS })
export const DefaultHorizontalAlignStyle = StyleProp.defineEnum("mocanvas:horizontalAlign", { defaultValue: "middle", values: DEFAULT_H_ALIGNS })
export const DefaultVerticalAlignStyle = StyleProp.defineEnum("mocanvas:verticalAlign", { defaultValue: "middle", values: DEFAULT_V_ALIGNS })

export const GeoShapeGeoStyle = StyleProp.defineEnum("mocanvas:geo", { defaultValue: "rectangle", values: GEO_SHAPE_KINDS })

/**
 * Alignment of the text *inside* a shape, shared across every text-bearing
 * shape. Distinct from {@link DefaultHorizontalAlignStyle}, which places the
 * label box within the shape.
 */
export const DefaultTextAlignStyle = StyleProp.defineEnum("mocanvas:textAlign", {
  defaultValue: "start",
  values: DEFAULT_TEXT_ALIGNS,
})

/** How a line shape interpolates between its points. */
export const LineShapeSplineStyle = StyleProp.defineEnum("mocanvas:spline", {
  defaultValue: "line",
  values: LINE_SPLINE_KINDS,
})

/** How an arrow's body is routed: a bowed arc, or axis-aligned elbow legs. */
export const ArrowShapeKindStyle = StyleProp.defineEnum("mocanvas:arrowKind", {
  defaultValue: "arc",
  values: ARROW_SHAPE_KINDS,
})

/**
 * The arrowhead drawn at an arrow's start. A separate style from the end so
 * that "make these arrows double-headed" is one edit rather than two.
 */
export const ArrowShapeArrowheadStartStyle = StyleProp.defineEnum("mocanvas:arrowheadStart", {
  defaultValue: "none",
  values: ARROWHEAD_KINDS,
})

/** The arrowhead drawn at an arrow's end; see {@link ArrowShapeArrowheadStartStyle}. */
export const ArrowShapeArrowheadEndStyle = StyleProp.defineEnum("mocanvas:arrowheadEnd", {
  defaultValue: "arrow",
  values: ARROWHEAD_KINDS,
})

/** Where an elbow arrow attaches to the shape its terminal is bound to. */
export const ElbowArrowSnap = StyleProp.defineEnum("mocanvas:elbowArrowSnap", {
  defaultValue: "none",
  values: ELBOW_ARROW_SNAP_MODES,
})

export type {
  ColorValue,
  DashValue,
  FillValue,
  FontValue,
  HAlignValue,
  SizeValue,
  TextAlignValue,
  VAlignValue,
  ArrowShapeArrowheadKind,
  ArrowShapeKind,
  ElbowArrowSnapMode,
  LineShapeSplineKind,
}
// The style *values* keep the same names as the style props (a value and a type may share a name).
export type DefaultColorStyle = ColorValue
export type DefaultLabelColorStyle = ColorValue
export type DefaultFillStyle = FillValue
export type DefaultDashStyle = DashValue
export type DefaultSizeStyle = SizeValue
export type DefaultFontStyle = FontValue
export type DefaultHorizontalAlignStyle = HAlignValue
export type DefaultVerticalAlignStyle = VAlignValue
export type DefaultTextAlignStyle = TextAlignValue
export type LineShapeSplineStyle = LineShapeSplineKind
export type ArrowShapeKindStyle = ArrowShapeKind
export type ArrowShapeArrowheadStartStyle = ArrowShapeArrowheadKind
export type ArrowShapeArrowheadEndStyle = ArrowShapeArrowheadKind
export type ElbowArrowSnap = ElbowArrowSnapMode

// The `TL`-spelled names for the same style values, for code arriving from a
// `TL`-prefixed API. Aliases, not distinct types.
export type TLDefaultTextAlignStyle = TextAlignValue
export type TLLineShapeSplineStyle = LineShapeSplineKind
export type TLArrowShapeKind = ArrowShapeKind
export type TLArrowShapeArrowheadStyle = ArrowShapeArrowheadKind

/**
 * The value a {@link StyleProp} carries.
 *
 * `StylePropValue<typeof DefaultColorStyle>` is the colour union, which is how
 * a shape's props type stays in step with the style it is declared from.
 */
export type StylePropValue<Prop extends StyleProp<any>> = Prop extends StyleProp<infer T> ? T : never

export type SharedStyle<T> = { type: "shared"; value: T } | { type: "mixed" }

/** Styles shared by a set of shapes: one entry per style prop, `mixed` when values differ. */
/**
 * What the current selection has in common, style by style — the read-only
 * half.
 *
 * `Editor.getSharedStyles()` hands one of these back. It is read-only because
 * the answer is *derived*: writing to it would not change any shape, and a
 * caller that thought it had would be silently wrong. To change a style, call
 * `setStyleForSelectedShapes`.
 *
 * A prop is absent when no selected shape has it, `{ type: "shared" }` when
 * every shape agrees, and `{ type: "mixed" }` when they do not — which is the
 * three-way answer a style panel needs in order to render a value, a blank, or
 * nothing at all.
 */
export class ReadonlySharedStyleMap {
  protected readonly map: Map<StyleProp<unknown>, SharedStyle<unknown>>

  constructor(entries: Iterable<[StyleProp<unknown>, SharedStyle<unknown>]> = []) {
    this.map = new Map(entries)
  }

  /** How many style props the selection has an answer for. */
  get size(): number {
    return this.map.size
  }

  get<T>(prop: StyleProp<T>): SharedStyle<T> | undefined {
    return this.map.get(prop as StyleProp<unknown>) as SharedStyle<T> | undefined
  }

  /** The agreed value, or `undefined` when the selection is mixed or has none. */
  getAsKnownValue<T>(prop: StyleProp<T>): T | undefined {
    const s = this.get(prop)
    return s?.type === "shared" ? s.value : undefined
  }

  has(prop: StyleProp<unknown>): boolean {
    return this.map.has(prop)
  }

  /**
   * Whether two maps say the same thing.
   *
   * By value, not by identity: the map is rebuilt on every selection change,
   * and a style panel that re-rendered whenever a *new* map arrived would
   * re-render on every pointer move during a drag.
   */
  equals(other: ReadonlySharedStyleMap): boolean {
    if (this.size !== other.size) return false
    for (const [prop, value] of this.map) {
      const theirs = other.get(prop)
      if (!theirs || theirs.type !== value.type) return false
      if (value.type === "shared" && theirs.type === "shared" && !Object.is(value.value, theirs.value)) return false
    }
    return true
  }

  [Symbol.iterator](): IterableIterator<[StyleProp<unknown>, SharedStyle<unknown>]> {
    return this.map.entries()
  }

  entries(): IterableIterator<[StyleProp<unknown>, SharedStyle<unknown>]> {
    return this.map.entries()
  }

  keys(): IterableIterator<StyleProp<unknown>> {
    return this.map.keys()
  }

  values(): IterableIterator<SharedStyle<unknown>> {
    return this.map.values()
  }
}

/** The writable form, used while the shared styles are being computed. */
export class SharedStyleMap extends ReadonlySharedStyleMap {

  /** Record a value seen on a shape. */
  applyValue<T>(prop: StyleProp<T>, value: T): void {
    const existing = this.map.get(prop as StyleProp<unknown>)
    if (!existing) this.map.set(prop as StyleProp<unknown>, { type: "shared", value })
    else if (existing.type === "shared" && existing.value !== value) this.map.set(prop as StyleProp<unknown>, { type: "mixed" })
  }

}

/**
 * Style props declared on a ShapeUtil's `static props` map, by prop key.
 *
 * The map holds validators of several kinds; only the {@link StyleProp}
 * entries are styles, and only those are returned.
 */
export function getStylePropsOf(props: object | undefined): Map<string, StyleProp<unknown>> {
  const out = new Map<string, StyleProp<unknown>>()
  if (!props) return out
  for (const [key, v] of Object.entries(props)) {
    if (v instanceof StyleProp) out.set(key, v)
  }
  return out
}
