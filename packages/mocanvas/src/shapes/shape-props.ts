/**
 * The validator map of every built-in shape — and of the built-in `arrow`
 * binding.
 *
 * A shape util's `static props` is the map that says what each prop of that
 * shape *is*: a validator, or a {@link StyleProp} (which validates and is
 * additionally shared across shape types, remembered for the next shape, and
 * editable for a whole selection at once). Publishing the maps as named values
 * rather than as anonymous object literals inside each class is what lets an
 * app extend one:
 *
 * ```ts
 * class MyGeoShapeUtil extends GeoShapeUtil {
 *   static override props = { ...geoShapeProps, badge: T.string }
 * }
 * ```
 *
 * **Which entries are styles is deliberate, not incidental.** A prop only
 * becomes a style when a shared, remembered, multi-select-editable value is
 * what the user wants; an arrow's routing `kind` and its arrowheads are per
 * arrow, so they are plain validators here even though they are enums. These
 * maps reproduce exactly the style set the built-ins already declared, so
 * wiring them changes what validates, never what the style panel shows.
 */

import {
  ARROWHEAD_KINDS,
  ARROW_SHAPE_KINDS,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultLabelColorStyle,
  DefaultSizeStyle,
  DefaultVerticalAlignStyle,
  GeoShapeGeoStyle,
  ImageShapeCrop,
  LINE_SPLINE_KINDS,
  T,
  assetIdValidator,
  type RecordProps,
  type StyleProp,
  type Validator,
} from "@mocanvas/editor"
import { isRichText, type RichText } from "../text/rich-text"
import type { ArrowBinding } from "../bindings/ArrowBindingUtil"
import type { ArrowShape } from "./ArrowShapeUtil"
import type { BookmarkShape } from "./BookmarkShapeUtil"
import type { DrawShape } from "./DrawShapeUtil"
import type { EmbedShape } from "./EmbedShapeUtil"
import type { FrameShape } from "./FrameShapeUtil"
import type { GeoShape } from "./GeoShapeUtil"
import type { GroupShape } from "./GroupShapeUtil"
import type { HighlightShape } from "./HighlightShapeUtil"
import type { ImageCrop, ImageShape } from "./ImageShapeUtil"
import type { LineShape } from "./LineShapeUtil"
import type { NoteShape } from "./NoteShapeUtil"
import type { TextShape } from "./TextShapeUtil"
import type { VideoShape } from "./VideoShapeUtil"

/* ---- shared prop validators --------------------------------------------- */

/**
 * A rich-text document, as a shape's `richText` prop holds it.
 *
 * Structural rather than exhaustive: the document is TipTap-shaped JSON whose
 * node vocabulary is open (an app may register its own nodes and marks), so
 * validating the node types would reject a document a newer editor wrote. What
 * has to hold is that it is a `doc` with a `content` array — everything the
 * text pipeline dereferences.
 */
export const richTextValidator: Validator<RichText> = T.jsonValue.refine((value) => {
  if (!isRichText(value)) throw new Error(`Expected a rich text document, got ${JSON.stringify(value)}`)
  return { type: "doc", content: value.content ?? [] }
})

/**
 * A validator that accepts exactly what `style` accepts, without *being* a
 * style.
 *
 * Used where a prop holds a style's value but the prop itself is per shape —
 * see the module comment. It defers to the live style prop rather than
 * snapshotting its values, so a palette an app registers through its themes is
 * accepted here too.
 */
function styleValue<Value>(style: StyleProp<Value>): Validator<Value> {
  return T.unknown.refine((value) => style.validate(value))
}

/**
 * An image's crop window.
 *
 * `ImageShapeCrop` validates the stored shape; the mapping afterwards rebuilds
 * the object with `isCircle` *absent* rather than present-and-undefined, which
 * is the difference between the two spellings under
 * `exactOptionalPropertyTypes` and therefore the difference between this and
 * {@link ImageCrop}.
 */
const imageCropValidator: Validator<ImageCrop> = ImageShapeCrop.refine((crop) =>
  crop.isCircle === undefined
    ? { topLeft: crop.topLeft, bottomRight: crop.bottomRight }
    : { topLeft: crop.topLeft, bottomRight: crop.bottomRight, isCircle: crop.isCircle },
)

/** A point on a shape, in the shape's own space. */
const pointValidator = T.object({ x: T.number, y: T.number })

/** A point of a freehand stroke: a position plus optional pen pressure. */
const drawPointValidator = T.object({ x: T.number, y: T.number, z: T.number.optional() })

/** One run of a freehand stroke — a pen-down-to-pen-up pass, or a straight leg. */
const drawSegmentValidator = T.object({
  type: T.literalEnum("free", "straight"),
  points: T.arrayOf(drawPointValidator),
})

/**
 * The derived plain-text label.
 *
 * Optional on purpose: a v5 writer stores only `richText`, so a record that
 * arrives without `text` is correct and must validate. See
 * `NoteShapeProps.text`.
 */
const derivedTextValidator = T.string.optional()

/* ---- shapes -------------------------------------------------------------- */

/** `GeoShapeUtil`'s props; see the module comment. */
export const geoShapeProps: RecordProps<GeoShape> = {
  geo: GeoShapeGeoStyle,
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  color: DefaultColorStyle,
  labelColor: DefaultLabelColorStyle,
  fill: DefaultFillStyle,
  dash: DefaultDashStyle,
  size: DefaultSizeStyle,
  font: DefaultFontStyle,
  align: DefaultHorizontalAlignStyle,
  verticalAlign: DefaultVerticalAlignStyle,
  growY: T.positiveNumber,
  url: T.linkUrl,
  richText: richTextValidator,
  text: derivedTextValidator,
  scale: T.nonZeroNumber,
  flipX: T.boolean,
  flipY: T.boolean,
}

/**
 * `ArrowShapeUtil`'s props.
 *
 * `kind`, `arrowheadStart` and `arrowheadEnd` are plain enums rather than
 * styles — see the module comment for why routing and terminals belong to the
 * one arrow.
 */
export const arrowShapeProps: RecordProps<ArrowShape> = {
  kind: T.literalEnum(...ARROW_SHAPE_KINDS),
  start: pointValidator,
  end: pointValidator,
  bend: T.number,
  elbowMidPoint: T.number,
  color: DefaultColorStyle,
  labelColor: DefaultLabelColorStyle,
  fill: DefaultFillStyle,
  dash: DefaultDashStyle,
  size: DefaultSizeStyle,
  arrowheadStart: T.literalEnum(...ARROWHEAD_KINDS),
  arrowheadEnd: T.literalEnum(...ARROWHEAD_KINDS),
  font: DefaultFontStyle,
  richText: richTextValidator,
  text: derivedTextValidator,
  labelPosition: T.number,
  scale: T.nonZeroNumber,
}

/** `DrawShapeUtil`'s props. */
export const drawShapeProps: RecordProps<DrawShape> = {
  segments: T.arrayOf(drawSegmentValidator),
  color: DefaultColorStyle,
  fill: DefaultFillStyle,
  dash: DefaultDashStyle,
  size: DefaultSizeStyle,
  isComplete: T.boolean,
  isClosed: T.boolean,
  isPen: T.boolean,
  scale: T.nonZeroNumber,
}

/** `HighlightShapeUtil`'s props: a draw stroke with no fill and no dash. */
export const highlightShapeProps: RecordProps<HighlightShape> = {
  segments: T.arrayOf(drawSegmentValidator),
  color: DefaultColorStyle,
  size: DefaultSizeStyle,
  isComplete: T.boolean,
  isPen: T.boolean,
  scale: T.nonZeroNumber,
}

/** `LineShapeUtil`'s props. */
export const lineShapeProps: RecordProps<LineShape> = {
  color: DefaultColorStyle,
  dash: DefaultDashStyle,
  size: DefaultSizeStyle,
  spline: T.literalEnum(...LINE_SPLINE_KINDS),
  points: T.dict(T.string, T.object({ id: T.string, index: T.string, x: T.number, y: T.number })),
  scale: T.nonZeroNumber,
}

/** `TextShapeUtil`'s props. */
export const textShapeProps: RecordProps<TextShape> = {
  color: DefaultColorStyle,
  size: DefaultSizeStyle,
  font: DefaultFontStyle,
  textAlign: DefaultHorizontalAlignStyle,
  w: T.nonZeroNumber,
  richText: richTextValidator,
  text: derivedTextValidator,
  scale: T.nonZeroNumber,
  autoSize: T.boolean,
}

/** `NoteShapeUtil`'s props. */
export const noteShapeProps: RecordProps<NoteShape> = {
  color: DefaultColorStyle,
  labelColor: DefaultLabelColorStyle,
  size: DefaultSizeStyle,
  font: DefaultFontStyle,
  fontSizeAdjustment: T.positiveNumber,
  align: DefaultHorizontalAlignStyle,
  verticalAlign: DefaultVerticalAlignStyle,
  growY: T.positiveNumber,
  url: T.linkUrl,
  richText: richTextValidator,
  text: derivedTextValidator,
  // Who first edited the label by hand, or `null` while nobody has. Absent on
  // every note written before attribution existed, so optional as well.
  textFirstEditedBy: T.string.nullable().optional(),
  scale: T.nonZeroNumber,
}

/** `FrameShapeUtil`'s props. */
export const frameShapeProps: RecordProps<FrameShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  name: T.string,
  // A frame's colour is per frame: a frame is chrome around other people's
  // shapes, and recolouring a mixed selection should not repaint the frames it
  // happens to contain. Hence a style *value*, not a style.
  color: styleValue(DefaultColorStyle).optional(),
}

/** `GroupShapeUtil`'s props: a group is a container and carries none. */
export const groupShapeProps: RecordProps<GroupShape> = {}

/** `ImageShapeUtil`'s props. */
export const imageShapeProps: RecordProps<ImageShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  assetId: assetIdValidator.nullable(),
  playing: T.boolean,
  url: T.linkUrl,
  crop: imageCropValidator.nullable(),
  flipX: T.boolean,
  flipY: T.boolean,
  altText: T.string,
}

/** `VideoShapeUtil`'s props. */
export const videoShapeProps: RecordProps<VideoShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  assetId: assetIdValidator.nullable(),
  time: T.number,
  playing: T.boolean,
  url: T.linkUrl,
  altText: T.string,
}

/** `BookmarkShapeUtil`'s props. */
export const bookmarkShapeProps: RecordProps<BookmarkShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  assetId: assetIdValidator.nullable(),
  url: T.linkUrl,
}

/**
 * `EmbedShapeUtil`'s props.
 *
 * `url` is the *page* url as the document stored it, not the iframe's `src` —
 * so it validates as an ordinary link, and the permit list decides separately
 * whether it is embeddable at all.
 */
export const embedShapeProps: RecordProps<EmbedShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  url: T.linkUrl,
}

/* ---- bindings ------------------------------------------------------------ */

/**
 * `ArrowBindingUtil`'s props.
 *
 * `normalizedAnchor` is a fraction of the bound shape's geometry bounds, which
 * is what lets a bound arrow survive the shape being resized; it is validated
 * as a plain point rather than clamped, because a binding briefly outside
 * `0..1` during a drag is legal and self-correcting.
 */
export const arrowBindingProps: RecordProps<ArrowBinding> = {
  terminal: T.literalEnum("start", "end"),
  normalizedAnchor: pointValidator,
  isExact: T.boolean,
  isPrecise: T.boolean,
}
