import {
  DEFAULT_COLORS,
  DEFAULT_DASHES,
  DEFAULT_FILLS,
  DEFAULT_FONTS,
  DEFAULT_H_ALIGNS,
  DEFAULT_SIZES,
  DEFAULT_V_ALIGNS,
  GEO_SHAPE_KINDS,
  type DefaultColorStyle as ColorValue,
  type DefaultDashStyle as DashValue,
  type DefaultFillStyle as FillValue,
  type DefaultFontStyle as FontValue,
  type DefaultHorizontalAlignStyle as HAlignValue,
  type DefaultSizeStyle as SizeValue,
  type DefaultVerticalAlignStyle as VAlignValue,
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
}

export class EnumStyleProp<T extends string> extends StyleProp<T> {
  constructor(
    id: string,
    defaultValue: T,
    readonly values: readonly T[],
  ) {
    super(id, defaultValue, (v) => {
      if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
        throw new Error(`Invalid value for style ${id}: ${String(v)}`)
      }
      return v as T
    })
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

export type { ColorValue, DashValue, FillValue, FontValue, HAlignValue, SizeValue, VAlignValue }
// The style *values* keep the same names as the style props (a value and a type may share a name).
export type DefaultColorStyle = ColorValue
export type DefaultLabelColorStyle = ColorValue
export type DefaultFillStyle = FillValue
export type DefaultDashStyle = DashValue
export type DefaultSizeStyle = SizeValue
export type DefaultFontStyle = FontValue
export type DefaultHorizontalAlignStyle = HAlignValue
export type DefaultVerticalAlignStyle = VAlignValue

export type SharedStyle<T> = { type: "shared"; value: T } | { type: "mixed" }

/** Styles shared by a set of shapes: one entry per style prop, `mixed` when values differ. */
export class SharedStyleMap {
  private readonly map = new Map<StyleProp<unknown>, SharedStyle<unknown>>()

  get size(): number {
    return this.map.size
  }

  get<T>(prop: StyleProp<T>): SharedStyle<T> | undefined {
    return this.map.get(prop as StyleProp<unknown>) as SharedStyle<T> | undefined
  }

  getAsKnownValue<T>(prop: StyleProp<T>): T | undefined {
    const s = this.get(prop)
    return s?.type === "shared" ? s.value : undefined
  }

  has(prop: StyleProp<unknown>): boolean {
    return this.map.has(prop)
  }

  /** Record a value seen on a shape. */
  applyValue<T>(prop: StyleProp<T>, value: T): void {
    const existing = this.map.get(prop as StyleProp<unknown>)
    if (!existing) this.map.set(prop as StyleProp<unknown>, { type: "shared", value })
    else if (existing.type === "shared" && existing.value !== value) this.map.set(prop as StyleProp<unknown>, { type: "mixed" })
  }

  [Symbol.iterator](): IterableIterator<[StyleProp<unknown>, SharedStyle<unknown>]> {
    return this.map.entries()
  }

  keys(): IterableIterator<StyleProp<unknown>> {
    return this.map.keys()
  }
}

/** Style props declared on a ShapeUtil's `static props` map, by prop key. */
export function getStylePropsOf(props: Record<string, unknown> | undefined): Map<string, StyleProp<unknown>> {
  const out = new Map<string, StyleProp<unknown>>()
  if (!props) return out
  for (const [key, v] of Object.entries(props)) {
    if (v instanceof StyleProp) out.set(key, v)
  }
  return out
}
