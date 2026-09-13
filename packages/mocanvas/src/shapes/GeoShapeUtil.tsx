import {
  BaseBoxShapeUtil,
  GEO_KIND,
  createBuiltInShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  FONT_SIZES,
  Group2d,
  Rectangle2d,
  STROKE_SIZES,
  getDefaultDisplayValues,
  getDisplayValues,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultLabelColorStyle,
  DefaultSizeStyle,
  DefaultVerticalAlignStyle,
  GeoShapeGeoStyle,
  type BaseShape,
  type EngineGeometry,
  type GeoShapeKind,
  type Geometry2d,
  type ShapeUtilOptions,
  type StyleWords,
  type TLColorMode,
  type TLDefaultDisplayValues,
  type TLStyledShape,
  type TLTheme,
  type TLFontFace,
} from "@mocanvas/editor"
import type { CSSProperties, ReactNode } from "react"
import { alignToJustify, alignToTextAlign, TextLabel, verticalAlignToAlignItems } from "../text/TextEditor"
import { applyPlainTextToRichText, richTextToText, toRichText, type RichText } from "../text/rich-text"
import { computeGrowY, measureLabel, trimTrailingWhitespace } from "../text/text-layout"
import { getGeoGeometry } from "./geo-helpers"
import { getGeoTypeDefinition, type GeoTypeDefinition } from "./geo-types"
import { geoShapeProps } from "./shape-props"
import { propsOf, readBoolean, readNumber, readRichText, readString, readStyle, readText } from "./prop-access"
import { getDashId, getFillRgba, getLabelFontFaces, getStrokeRgba, getThemeColors } from "./shape-theme"
import { pathWordsToSvgD } from "./svg-path"
import { svgPath } from "./indicator-paths"

export interface GeoShapeProps {
  geo: GeoShapeKind
  w: number
  h: number
  color: DefaultColorStyle
  labelColor: DefaultColorStyle
  fill: DefaultFillStyle
  dash: DefaultDashStyle
  size: DefaultSizeStyle
  font: DefaultFontStyle
  align: DefaultHorizontalAlignStyle
  verticalAlign: DefaultVerticalAlignStyle
  growY: number
  url: string
  /** The label as a rich-text document; see `NoteShapeProps.richText`. */
  richText: RichText
  /** The label as plain text — optional and derived; see `NoteShapeProps.text`. */
  text?: string
  scale: number
  /**
   * Mirror the silhouette left-to-right inside the shape's own box.
   *
   * Not a transform: `x`, `y`, `w`, `h` and the label are untouched, so a
   * flipped shape covers exactly the same bounds and still reads right way up.
   * Symmetric silhouettes (a rectangle, an ellipse) are unchanged by it.
   */
  flipX: boolean
  /** Mirror the silhouette top-to-bottom; see {@link GeoShapeProps.flipX}. */
  flipY: boolean
}

export type GeoShape = BaseShape<"geo", GeoShapeProps>

/** The box a click (rather than a drag) places a geo shape at. */
export const GEO_DEFAULT_SIZE = { w: 100, h: 100 } as const

/**
 * `GeoShapeUtil`'s settings.
 *
 * `customGeoTypes` is the extension seam described in {@link GeoTypeDefinition}:
 *
 * ```ts
 * const utils = [GeoShapeUtil.configure({ customGeoTypes: { cog } })]
 * ```
 *
 * A key that matches a built-in silhouette replaces it.
 */
export interface GeoShapeOptions extends ShapeUtilOptions<GeoShape, GeoShapeUtilDisplayValues> {
  /** Extra (or replacement) geo silhouettes, keyed by the value stored in `props.geo`. */
  customGeoTypes?: Readonly<Record<string, GeoTypeDefinition>>
}

/**
 * What a geo shape paints with.
 *
 * A geo shape is an outline *and* a label, and the label has a size and a
 * padding of its own that anything measuring the shape has to agree with —
 * which is why they are reported rather than recomputed at each call site. All
 * three have the shape's `scale` applied, unlike the shared set's `fontSize`.
 */
export interface GeoShapeUtilDisplayValues extends TLDefaultDisplayValues {
  /** The label's font size in page units, `scale` applied. */
  labelFontSize: number
  /** Padding between the outline and its label, in page units. */
  labelPadding: number
  /** The label's CSS font stack. */
  labelFontFamily: string
  /** The outline's width in page units, `scale` applied. */
  scaledStrokeWidth: number
}

/** Resolve a geo shape's display values; see {@link GeoShapeUtilDisplayValues}. */
export function getGeoDisplayValues(
  editor: unknown,
  shape: { props?: unknown },
  theme: TLTheme,
  colorMode: TLColorMode,
): GeoShapeUtilDisplayValues {
  const base = getDefaultDisplayValues(editor, shape as TLStyledShape, theme, colorMode)
  const scale = readNumber(propsOf(shape), "scale", 1)
  return {
    ...base,
    labelFontSize: base.fontSize * scale,
    labelPadding: GEO_LABEL_PADDING * scale,
    labelFontFamily: base.fontFamily,
    scaledStrokeWidth: base.strokeWidth * scale,
  }
}

export const GEO_LABEL_PADDING = 16
const LABEL_PADDING = GEO_LABEL_PADDING

export function horizontalAlignToFlex(align: DefaultHorizontalAlignStyle): CSSProperties["justifyContent"] {
  return alignToJustify(align)
}

export function horizontalAlignToTextAlign(align: DefaultHorizontalAlignStyle): CSSProperties["textAlign"] {
  return alignToTextAlign(align)
}

export function verticalAlignToFlex(align: DefaultVerticalAlignStyle): CSSProperties["alignItems"] {
  return verticalAlignToAlignItems(align)
}

/**
 * `shape.props` with every declared prop present and of the declared type.
 * Geometry and rendering read through this so a record that arrived without a
 * prop (or with a value from another editor's vocabulary) still draws.
 */
/**
 * {@link GeoShapeProps} with the *derived* label filled in as well.
 *
 * `props.text` is optional on the record — a v5 writer only sets `richText` —
 * but a util that has run it through {@link readGeoProps} always has both, so
 * everything downstream can take a plain `string`.
 */
export type ResolvedGeoProps = GeoShapeProps & { text: string; richText: RichText }

export function readGeoProps(shape: { props?: unknown }): ResolvedGeoProps {
  const p = propsOf(shape)
  return {
    geo: readStyle(p, "geo", GeoShapeGeoStyle),
    w: readNumber(p, "w", 100),
    h: readNumber(p, "h", 100),
    color: readStyle(p, "color", DefaultColorStyle),
    labelColor: readStyle(p, "labelColor", DefaultLabelColorStyle),
    fill: readStyle(p, "fill", DefaultFillStyle),
    dash: readStyle(p, "dash", DefaultDashStyle),
    size: readStyle(p, "size", DefaultSizeStyle),
    font: readStyle(p, "font", DefaultFontStyle),
    align: readStyle(p, "align", DefaultHorizontalAlignStyle),
    verticalAlign: readStyle(p, "verticalAlign", DefaultVerticalAlignStyle),
    growY: readNumber(p, "growY", 0),
    url: readString(p, "url", ""),
    richText: readRichText(p),
    text: readText(p),
    scale: readNumber(p, "scale", 1),
    flipX: readBoolean(p, "flipX", false),
    flipY: readBoolean(p, "flipY", false),
  }
}

/** Measured size of a geo label (padding included), wrapped at the shape width. */
export function measureGeoLabel(
  props: Pick<GeoShapeProps, "text" | "font" | "size" | "scale" | "w"> & { richText?: unknown },
  editor?: { getCurrentTheme?(): unknown } | null,
) {
  const richText = readRichText(props)
  const font = readStyle(props, "font", DefaultFontStyle)
  const size = readStyle(props, "size", DefaultSizeStyle)
  const scale = readNumber(props, "scale", 1)
  const w = readNumber(props, "w", 100)
  return measureLabel(richText, {
    fontFamily: font,
    fontSize: FONT_SIZES[size] * scale,
    maxWidth: Math.max(1, w),
    padding: LABEL_PADDING * scale,
    editor: (editor ?? null) as never,
  })
}

/** `growY` a geo shape needs so its label fits inside `h`. Empty labels never grow the shape. */
export function getGeoGrowY(
  props: Pick<GeoShapeProps, "text" | "font" | "size" | "scale" | "w" | "h"> & { richText?: unknown },
  editor?: { getCurrentTheme?(): unknown } | null,
): number {
  if (!readText(props)) return 0
  return computeGrowY(measureGeoLabel(props, editor).h, readNumber(props, "h", 100))
}

const LABEL_KEYS: readonly (keyof GeoShapeProps)[] = ["richText", "text", "font", "size", "scale", "w", "h"]

/** Named versions of the geo shape's props, for {@link geoShapeMigrations}. */
export const geoShapeVersions = createBuiltInShapePropsMigrationIds("geo", {
  AddFlipProps: 1,
})

/**
 * The geo shape's props migrations.
 *
 * Boards saved before `flipX`/`flipY` existed have neither prop, and the
 * validator would otherwise refuse them on load; the migration backfills both
 * as `false`, which is the "not flipped" the old renderer implied. `down`
 * removes them again so an older client can still read a newer document.
 */
export const geoShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: geoShapeVersions.AddFlipProps,
      up(props) {
        props["flipX"] ??= false
        props["flipY"] ??= false
      },
      down(props) {
        delete props["flipX"]
        delete props["flipY"]
      },
    },
  ],
})

export class GeoShapeUtil extends BaseBoxShapeUtil<GeoShape> {
  static override type = "geo" as const
  static override migrations = geoShapeMigrations
  static override options: GeoShapeOptions = { getDefaultDisplayValues: getGeoDisplayValues }
  declare readonly options: GeoShapeOptions
  static override props = geoShapeProps

  getDefaultProps(): GeoShapeProps {
    return {
      geo: "rectangle",
      w: 100,
      h: 100,
      color: "black",
      labelColor: "black",
      fill: "none",
      dash: "draw",
      size: "m",
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      growY: 0,
      url: "",
      richText: toRichText(""),
      scale: 1,
      flipX: false,
      flipY: false,
    }
  }

  /**
   * The silhouette for `geo`, taking this util's `customGeoTypes` into account.
   * Falls back to the rectangle so an unknown value still draws something.
   */
  getGeoTypeDefinition(geo: string): GeoTypeDefinition {
    return (
      getGeoTypeDefinition(geo, this.options.customGeoTypes) ??
      getGeoTypeDefinition("rectangle", this.options.customGeoTypes)!
    )
  }

  /**
   * The `geo` value this util will actually draw.
   *
   * `props.geo` is a *style* prop, and its validator only knows the built-in
   * silhouettes — so reading it through the style would turn every custom geo
   * type back into a rectangle before it ever reached the table. A stored value
   * this util has a definition for is therefore kept as it is; anything else
   * falls back to the validated style, which is what keeps a value from another
   * editor's vocabulary drawing something rather than nothing.
   */
  getGeoValue(shape: { props?: unknown }): string {
    const p = propsOf(shape)
    const raw = readString(p, "geo", "")
    if (raw !== "" && getGeoTypeDefinition(raw, this.options.customGeoTypes) !== undefined) return raw
    return readStyle(p, "geo", GeoShapeGeoStyle)
  }

  /**
   * The engine has a generator for every built-in geo kind, so a built-in
   * travels as `(kind, w, h, flips)` rather than as its vertices. A custom geo
   * type returns `undefined` and keeps uploading whatever its `getPath` builds.
   */
  override getEngineGeometry(shape: GeoShape): EngineGeometry | undefined {
    const geo = this.getGeoValue(shape)
    if (this.options.customGeoTypes?.[geo]) return undefined
    const kind = GEO_KIND[geo]
    if (kind === undefined) return undefined
    const { w, h, growY, fill, flipX, flipY, size, scale } = readGeoProps(shape)
    // The label rect is always clamped inside the body box, so the group's
    // bounds stay exactly `w x (h + growY)` whether or not there is text.
    return {
      type: "geo",
      kind,
      w,
      h: h + growY,
      isClosed: true,
      isFilled: fill !== "none",
      flipX,
      flipY,
      // Only the marks inside an outline use it — the X of an x-box, whose ends
      // sit on the corners. `getGeometry` has always shortened them by this; the
      // engine draws its own copy of the path and needs to be told the same.
      strokeWidth: STROKE_SIZES[size] * scale,
    }
  }

  override getGeometry(shape: GeoShape): Geometry2d {
    const props = readGeoProps(shape)
    const { w, h, growY, fill, text, flipX, flipY, size, scale } = props
    const height = h + growY
    const body = this.getGeoTypeDefinition(this.getGeoValue(shape)).getPath(w, height, {
      isFilled: fill !== "none",
      flipX,
      flipY,
      strokeWidth: STROKE_SIZES[size] * scale,
    })
    if (!text) return body
    return new Group2d({ children: [body, this.getLabelRect(props)] })
  }

  /** Where the text label sits inside the body, in shape-local space. */
  private getLabelRect(props: GeoShapeProps): Rectangle2d {
    const { w, h, growY, align, verticalAlign } = props
    const height = h + growY
    const m = measureGeoLabel(props)
    const lw = Math.min(w, m.w)
    const lh = Math.min(height, m.h)
    const x = align === "start" || align === "start-legacy" ? 0 : align === "end" || align === "end-legacy" ? w - lw : (w - lw) / 2
    const y = verticalAlign === "start" ? 0 : verticalAlign === "end" ? height - lh : (height - lh) / 2
    return new Rectangle2d({ x, y, width: lw, height: lh, isFilled: false, isLabel: true })
  }

  override getRenderStyle(shape: GeoShape): StyleWords {
    const { color, fill, dash, size, scale } = readGeoProps(shape)
    const colors = getThemeColors(this.editor)
    return {
      stroke: getStrokeRgba(color, colors),
      strokeWidth: STROKE_SIZES[size] * scale,
      fill: getFillRgba(color, fill, colors),
      dash: getDashId(dash),
      opacity: 1,
    }
  }

  /** A geo shape needs its family's faces only while it carries a label. */
  override getFontFaces(shape: GeoShape): TLFontFace[] {
    return readText(shape.props) ? getLabelFontFaces(readGeoProps(shape).font) : []
  }

  component(shape: GeoShape): ReactNode {
    const { richText, text, font, size, scale, align, verticalAlign, w, h, growY } = readGeoProps(shape)
    const isEditing = this.editor.getEditingShapeId() === shape.id
    if (!text && !isEditing) return null
    const display = getDisplayValues<GeoShape, GeoShapeUtilDisplayValues>(this, shape)
    return (
      <TextLabel
        shape={shape}
        text={text}
        richText={richText}
        isEditing={isEditing}
        fontFamily={font}
        fontSize={FONT_SIZES[size] * scale}
        color={display.labelColor}
        textAlign={align}
        verticalAlign={verticalAlign}
        wrap
        width={w}
        height={h + growY}
        padding={LABEL_PADDING * scale}
        onChange={(next) =>
          this.editor.updateShape<GeoShape>({
            id: shape.id,
            type: "geo",
            props: { text: next, richText: applyPlainTextToRichText(richText, next) },
          })
        }
        onChangeRichText={(next) =>
          this.editor.updateShape<GeoShape>({
            id: shape.id,
            type: "geo",
            props: { richText: next, text: richTextToText(next) },
          })
        }
      />
    )
  }

  override getIndicatorPath(shape: GeoShape): Path2D {
    return svgPath(pathWordsToSvgD(this.getGeometry(shape).toPathWords()))
  }

  /** The GPU keeps drawing the body while editing; only the label lives in the DOM. */
  override needsOverlay(_shape: GeoShape): boolean {
    return false
  }

  override hasOverlayLabel(shape: GeoShape): boolean {
    return readText(shape.props).trim().length > 0 || this.editor.getEditingShapeId() === shape.id
  }

  override canEdit(_shape: GeoShape): boolean {
    return true
  }

  override getText(shape: GeoShape): string {
    return readText(shape.props)
  }

  override onBeforeCreate(next: GeoShape): GeoShape | void {
    const growY = getGeoGrowY(next.props, this.editor)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onBeforeUpdate(prev: GeoShape, next: GeoShape): GeoShape | void {
    if (!LABEL_KEYS.some((k) => propsOf(prev)[k] !== propsOf(next)[k])) return
    const growY = getGeoGrowY(next.props, this.editor)
    if (growY !== next.props.growY) return { ...next, props: { ...next.props, growY } }
  }

  override onEditEnd(shape: GeoShape): void {
    const text = readText(shape.props)
    const trimmed = trimTrailingWhitespace(text)
    if (trimmed === text) return
    this.editor.updateShape<GeoShape>({
      id: shape.id,
      type: "geo",
      props: { text: trimmed, richText: applyPlainTextToRichText(readRichText(shape.props), trimmed) },
    })
  }
}
