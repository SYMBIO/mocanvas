import type { ReactNode } from "react"
import type { StyleWords } from "@mocanvas/wasm"
import type { Editor } from "../editor/Editor"
import type { Geometry2d, VecLike } from "../geometry"
import type { ShapeHandle, SelectionHandle } from "../editor/events"
import type { UnknownShape, Shape, ShapeCreate } from "../records/base"
import type { Asset } from "../records/asset"
import type { UnknownRecordProps } from "../records/props"
import type { PropsMigrations } from "../migrations/propsMigrations"
import type { UserId } from "../user/userRecord"
import type { TLIndicatorPathResult } from "../indicators/types"
import type { BindingCanBindOptions } from "../bindings/BindingUtil"
import type { BoundsSnapGeometry, HandleSnapGeometry } from "./snapGeometry"
import type { TLCropInfo } from "./crop"
import type { TLShapeUtilCanBeLaidOutOpts, TLShapeUtilCanvasSvgDef } from "./hookTypes"
import type { TLHandleDragInfo } from "./resize"
import type {
  TLDragShapesInInfo,
  TLDragShapesOutInfo,
  TLDragShapesOverInfo,
  TLDropShapesOverInfo,
} from "./dragInfo"
import type {
  TLColorMode,
  TLDefaultDisplayValues,
  TLFontFace,
  TLGetDefaultDisplayValues,
  TLTheme,
} from "../theme/types"

export interface ShapeUtilConstructor<T extends UnknownShape = UnknownShape, U extends ShapeUtil<T> = ShapeUtil<T>> {
  new (editor: Editor): U
  type: T["type"]
  props?: UnknownRecordProps
  migrations?: PropsMigrations
  options?: object
  /** See {@link ShapeUtil.handledAssetTypes}. */
  handledAssetTypes?: readonly string[]
}

/**
 * The per-util settings bag, read as `util.options` and set with
 * {@link ShapeUtil.configure}.
 *
 * Everything a util wants tunable *without subclassing* goes here — which is
 * what makes `GeoShapeUtil.configure({ customGeoTypes })` possible. A util that
 * needs more than the base fields declares its own interface extending this
 * one and re-declares both `static options` and the instance property with it.
 */
export interface ShapeUtilOptions<T extends UnknownShape = UnknownShape, D extends object = TLDefaultDisplayValues> {
  /**
   * How this util resolves a shape's style props into the concrete values it
   * paints with. Left undefined, {@link getDisplayValues} falls back to the
   * shared default resolution.
   *
   * Declared as a method rather than as a property of function type on
   * purpose: a util's options are read through the base class, where the shape
   * type is only `UnknownShape`, and method bivariance is what lets a
   * `ShapeUtil<NoteShape>` still be handled as a `ShapeUtil`.
   */
  getDefaultDisplayValues?(editor: unknown, shape: T, theme: TLTheme, colorMode: TLColorMode): D
}

/**
 * The patch {@link ShapeUtil.configure} accepts for a given util class: a
 * partial of whatever that class declared as its `static options`, or an open
 * bag for a util that declared none.
 */
export type ShapeUtilOptionsPatch<C> = C extends { options?: infer O }
  ? O extends object
    ? Partial<O>
    : Record<string, unknown>
  : Record<string, unknown>

/**
 * How an edit was asked for, handed to {@link ShapeUtil.canEdit} so a util can
 * accept some routes into editing and refuse others.
 *
 * The distinction is the whole point: a frame-like shape has a hollow
 * interior, so a plain double click on it can only have landed on its heading,
 * while the corner and edge gestures mean "fit to content" and are a different
 * question entirely.
 */
// SEMANTICS-ASSUMED: the route names. They are taken from the consumer's own
// `canEdit` bodies, which test for `"click-header"` and `"unknown"`; the rest
// name the gestures the select tool already distinguishes. `type` is widened
// with `(string & {})` so an app's own edit trigger stays representable.
export interface TLEditStartInfo {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  type:
    | "unknown"
    | "press_enter"
    | "click"
    | "double-click"
    | "click-header"
    | "double-click-corner"
    | "double-click-edge"
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    | (string & {})
}

/** The edit-start info a caller with no more specific answer passes. */
export const UNKNOWN_EDIT_START_INFO: TLEditStartInfo = { type: "unknown" }


export interface ResizeInfo<T extends UnknownShape> {
  newPoint: VecLike
  handle: SelectionHandle
  mode: "scale_shape" | "resize_bounds"
  scaleX: number
  scaleY: number
  initialBounds: { x: number; y: number; w: number; h: number }
  initialShape: T
}

export interface TranslateInfo<T extends UnknownShape> {
  initialShape: T
}

/** Export-wide settings handed to `ShapeUtil.toSvg` / `toBackgroundSvg`. */
export interface ShapeSvgContext {
  /** Whether the export is being drawn against the dark theme. */
  darkMode: boolean
  /** The page background colour of the export, as `#rrggbb`. */
  background: string
}

/**
 * What an SVG export callback may return: a raw markup string (inserted
 * verbatim, so it must be well-formed and escaped by the util) or a React node
 * the exporter serializes. `undefined` means "I have nothing to draw", which
 * lets the exporter fall through to its own renderers.
 */
export type ShapeSvgResult = string | ReactNode

/** What {@link ShapeUtil.configure} may be called on. */
export interface ShapeUtilClass {
  // A mixin base has to accept a rest parameter; the one argument every shape
  // util actually takes is the editor.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): any
  options?: object
}

/**
 * Describes how a shape type behaves: its default props, geometry, rendering
 * and interaction callbacks. One instance per shape type per editor.
 *
 * The second type argument is the util's *display values*: what its style
 * props resolve to once a theme and a colour mode have been applied. A util
 * that only paints the shared set leaves it at {@link TLDefaultDisplayValues};
 * one that adds its own (a note's body size, a label's padding) names its own
 * interface, and `getDisplayValues(util, shape)` then returns it.
 */
/**
 * A built-in shape's outline, described by the numbers that generate it.
 *
 * The engine has a generator per `kind`, so nothing has to send vertices.
 * See {@link ShapeUtil.getEngineGeometry}.
 */
export type EngineGeometry = { w: number; h: number; isClosed: boolean; isFilled: boolean } & (
  | { type: "geo"; kind: number; flipX?: boolean; flipY?: boolean }
  | { type: "spline" | "poly"; points: ArrayLike<number>; closed?: boolean }
  | { type: "draw"; segments: readonly { points: ArrayLike<number>; freehand: boolean }[]; closed?: boolean }
)

export abstract class ShapeUtil<T extends UnknownShape = UnknownShape, D extends object = TLDefaultDisplayValues> {
  static type: string
  /**
   * One validator per prop of the shape this util describes — the contract the
   * store checks a record against before it is written, and what
   * `createSchema()` reads to build the document schema.
   *
   * A {@link StyleProp} counts as a validator and additionally makes the prop
   * *shared*: changing it on one selected shape changes it on all of them.
   */
  static props?: UnknownRecordProps
  /**
   * How this shape's props have changed over time, as a
   * {@link PropsMigrations} sequence. A shape that is ever persisted should
   * declare one from the start, even empty: the first prop that is added later
   * then has somewhere to go.
   */
  static migrations?: PropsMigrations
  /** The defaults every instance of this util starts its `options` from. */
  static options?: object
  /**
   * Asset types this shape can be created for — `["image"]` on an image shape.
   *
   * It is how a dropped file finds its shape: the asset utils turn the file
   * into an asset record, and the editor then looks for the shape util that
   * claims that asset's type and asks it to
   * {@link ShapeUtil.createShapeForAsset}. Leaving it undefined means "no
   * asset ever produces this shape", which is right for every shape that is
   * drawn rather than dropped.
   */
  static handledAssetTypes?: readonly string[]

  /**
   * This util with `options` merged over its defaults, as a new class.
   *
   * Nothing is mutated: the original util keeps its own options, so two
   * editors on one page can register differently configured copies of the same
   * shape type. `type`, `props` and `migrations` are inherited, so the copy is
   * the same shape as far as the store is concerned.
   *
   * ```ts
   * const utils = [GeoShapeUtil.configure({ customGeoTypes: { cog } })]
   * ```
   */
  static configure<C extends ShapeUtilClass>(this: C, options: ShapeUtilOptionsPatch<C>): C {
    const Base = this
    const merged = { ...((Base as { options?: object }).options ?? {}), ...(options as object) }
    const Configured = class extends Base {}
    Object.defineProperty(Configured, "options", { value: merged, writable: true, configurable: true, enumerable: true })
    Object.defineProperty(Configured, "name", {
      value: `${(Base as { name?: string }).name ?? "ShapeUtil"}(configured)`,
      configurable: true,
    })
    return Configured as unknown as C
  }

  /** This util's settings; see {@link ShapeUtilOptions} and {@link ShapeUtil.configure}. */
  readonly options: ShapeUtilOptions<T, D>

  constructor(readonly editor: Editor) {
    this.options = ((this.constructor as { options?: object }).options ?? {}) as ShapeUtilOptions<T, D>
  }

  get type(): T["type"] {
    return (this.constructor as ShapeUtilConstructor<T>).type
  }

  /**
   * Override *some* of the display values this util resolves, leaving the rest
   * to {@link ShapeUtilOptions.getDefaultDisplayValues}.
   *
   * The override point for a shape whose paint depends on more than its style
   * props — a note that tints itself by the board's mode, a card that reads a
   * colour off its own props. Return `undefined` to change nothing.
   *
   * `editor` is typed `unknown` to match `TLGetCustomDisplayValues`, which is
   * what `getDisplayValues` reads this through; inside a util `this.editor` is
   * the same object, fully typed, so the parameter is rarely the one you want.
   */
  getCustomDisplayValues?(editor: unknown, shape: T, theme: TLTheme, colorMode: TLColorMode): Partial<D> | undefined

  /**
   * The typefaces this shape needs before it can be drawn correctly.
   *
   * The font manager collects these across the current page and loads them;
   * until a face has loaded the shape is measured and painted with whatever
   * the browser substitutes, so a util that draws text should answer here
   * rather than assume its family is present.
   *
   * Returning an empty array (the default when unimplemented) means "nothing
   * to load" — a shape drawn entirely from geometry.
   */
  getFontFaces?(shape: T): TLFontFace[]

  abstract getDefaultProps(): T["props"]
  abstract getGeometry(shape: T): Geometry2d

  /**
   * Describe this shape's outline to the engine by its *parameters*, so the
   * engine builds it, instead of constructing a `Geometry2d` here and uploading
   * its vertices.
   *
   * Returning `undefined` — the default, and what every custom shape does —
   * keeps the `getGeometry` path. A built-in whose silhouette the engine already
   * knows how to draw returns a descriptor instead: at 20,000 shapes that is
   * 15-25x less work on the JavaScript side and up to 4.6x fewer words copied
   * across the boundary, because a rectangle travels as `(kind, w, h)` rather
   * than as its vertices.
   *
   * `w`, `h`, `isClosed` and `isFilled` must agree with what `getGeometry`
   * would have reported: they are what the scene is told about the shape.
   */
  getEngineGeometry?(shape: T): EngineGeometry | undefined
  abstract component(shape: T): ReactNode

  /**
   * The outline drawn over the shape when it is selected, hovered or hinted,
   * in **shape-local** coordinates, as a canvas path.
   *
   * The compositor supplies everything else: it applies the shape's page
   * transform, strokes in the theme's selection colour, and picks a
   * zoom-independent width (1.5 CSS px selected or hovered, 2.5 hinted). So an
   * indicator is usually three lines:
   *
   * ```ts
   * override getIndicatorPath(shape: MyShape): Path2D {
   *   const path = new Path2D()
   *   path.rect(0, 0, shape.props.w, shape.props.h)
   *   return path
   * }
   * ```
   *
   * Return a {@link TLIndicatorPath} instead of a bare `Path2D` to punch a hole
   * in the outline (a label strip) or to add strokes outside that hole.
   * Return `undefined`, or an empty path, to draw no outline at all.
   *
   * Leaving the method unimplemented falls back to a rectangle around the
   * shape's geometry bounds.
   */
  getIndicatorPath?(shape: T): TLIndicatorPathResult

  /**
   * @deprecated Implement {@link ShapeUtil.getIndicatorPath} instead.
   *
   * The v4 indicator: an SVG fragment in shape-local coordinates, drawn on a
   * separate SVG layer. Still honoured for a util that has not been ported —
   * but only when that util does *not* implement `getIndicatorPath`, so a util
   * mid-port is never drawn twice.
   */
  indicator?(shape: T): ReactNode

  /**
   * A DOM element that holds this shape's **stateful** content — a cross-origin
   * iframe, a `<video>` mid-playback, a third-party widget that authenticated
   * once and cannot cheaply do it again.
   *
   * `component()` re-runs whenever React feels like it, and anything it
   * *creates* is destroyed and rebuilt with it: an iframe reloads, a video
   * restarts, a session is lost. An element returned from here is created once
   * per shape, kept by the editor rather than by the React tree, and moved
   * between mount points instead of being recreated — so it survives the shape
   * scrolling out of view, a re-render, and the editor's own unmount.
   *
   * The element is *positioned and sized* by the editor. Return a container and
   * put the stateful thing inside it; do not read layout off it.
   *
   * Implement it and `component()` no longer needs to render the content at all
   * — whatever it returns is rendered *around* the element, which is appended
   * as a child of the shape's node.
   */
  getContentElement?(shape: T): HTMLElement | undefined

  /**
   * The editor has finished with the element `getContentElement` returned:
   * the shape was deleted, or the editor was disposed. Tear down whatever the
   * element owns — a player, an observer, a message channel.
   *
   * Not called when the shape merely unmounts, which is the entire point of
   * the pair. `shape` is the last version of the shape the editor saw, and may
   * already be gone from the store.
   */
  onReleaseContentElement?(shape: T, element: HTMLElement): void

  /**
   * The shape as SVG, in shape-local coordinates: the exporter wraps the
   * result in a `<g>` carrying the shape's page transform and opacity.
   * Implement it to make a custom shape exportable without registering
   * anything; leave it undefined to fall through to the exporter's own
   * renderers.
   */
  toSvg?(shape: T, ctx: ShapeSvgContext): ShapeSvgResult

  /**
   * Extra SVG drawn *behind* every exported shape (a backdrop, a drop shadow,
   * a grid). Same coordinate space and wrapping as `toSvg`.
   */
  toBackgroundSvg?(shape: T, ctx: ShapeSvgContext): ShapeSvgResult

  /**
   * GPU style for the shape's geometry. Return `null` (the default) to render
   * the shape through `component` in the DOM overlay instead.
   */
  getRenderStyle(_shape: T): StyleWords | null {
    return null
  }

  /** Whether the shape should be drawn by the DOM overlay even if it has a render style (e.g. while editing). */
  needsOverlay(shape: T): boolean {
    return this.editor.getEditingShapeId() === shape.id
  }

  /**
   * Whether `component` should be rendered in the DOM overlay *in addition to*
   * the GPU geometry (e.g. a text label on a filled shape).
   */
  hasOverlayLabel(_shape: T): boolean {
    return false
  }

  /**
   * Whether the shape clips its descendants to its own geometry bounds (e.g.
   * frames). Children are then rendered with a scissor rect on the GPU.
   */
  isClipShape(_shape: T): boolean {
    return false
  }

  /**
   * Whether this shape is a *container*: something that adopts the shapes
   * dragged onto it and carries them when it moves.
   *
   * The one question every "is this a frame?" test should ask. Hardcoding
   * `shape.type === "frame"` is what this replaces: an app's own section,
   * phase or artboard shape is frame-like too, and nothing in the editor can
   * know their type names.
   *
   * Being frame-like says nothing about *clipping* — see
   * {@link ShapeUtil.getClipPath}, which a grouping container returns
   * `undefined` from while staying frame-like.
   */
  isFrameLike(_shape: T): boolean {
    return false
  }

  /**
   * Whether this shape paints a surface its children sit on, and so must be
   * drawn behind them rather than interleaved by index.
   */
  providesBackgroundForChildren(_shape?: T): boolean {
    return false
  }

  /**
   * The region descendants are clipped to, as a polygon in **shape-local**
   * coordinates, or `undefined` for "clips nothing".
   *
   * This is the difference between an artboard and a region of the board: a
   * frame crops what hangs over its edge, a section groups what sits inside it
   * and crops nothing. Returning `undefined` is the whole of the second
   * behaviour.
   */
  getClipPath(_shape?: T): VecLike[] | undefined {
    return undefined
  }

  /**
   * Whether a child of this type may be *removed* from this container.
   *
   * Deliberately separate from {@link ShapeUtil.canReceiveNewChildrenOfType}:
   * admission is allowed to be strict while recovery stays permissive, so a
   * child that arrived from an older snapshot can always be lifted back out.
   */
  canRemoveChildrenOfType(_shape: T, _type: string): boolean {
    return false
  }

  /**
   * Whether this shape may be edited in place, and — since v5 — whether it may
   * be edited *for this reason*. See {@link TLEditStartInfo}.
   *
   * `info` is optional so a caller with no opinion can keep asking the plain
   * question; it then reads as {@link UNKNOWN_EDIT_START_INFO}.
   */
  canEdit(_shape: T, _info: TLEditStartInfo = UNKNOWN_EDIT_START_INFO): boolean {
    return false
  }
  canResize(_shape: T): boolean {
    return true
  }
  /**
   * Whether a binding may attach to this shape.
   *
   * Takes the **records** rather than their type names (v5): read `.type` off
   * them for the old behaviour, or anything else the decision needs — a locked
   * target, a prop, a parent — without a second lookup.
   */
  canBind(_opts: BindingCanBindOptions): boolean {
    return true
  }
  canCrop(_shape: T): boolean {
    return false
  }
  canScroll(_shape: T): boolean {
    return false
  }
  canSnap(_shape: T): boolean {
    return true
  }
  canReceiveNewChildrenOfType(_shape: T, _type: string): boolean {
    return false
  }
  canDropShapes(_shape: T, _shapes: UnknownShape[]): boolean {
    return false
  }
  hideRotateHandle(_shape: T): boolean {
    return false
  }
  hideResizeHandles(_shape: T): boolean {
    return false
  }
  hideSelectionBoundsBg(_shape: T): boolean {
    return false
  }
  hideSelectionBoundsFg(_shape: T): boolean {
    return false
  }
  isAspectRatioLocked(_shape: T): boolean {
    return false
  }
  getHandles?(shape: T): ShapeHandle[]
  /**
   * The shape's text, for search, accessibility and the selection context.
   * Concrete rather than optional so a caller need not guard every call; the
   * base returns `undefined` for a shape that carries no text.
   */
  getText(_shape: T): string | undefined {
    return undefined
  }
  /**
   * A short description of the shape for assistive technology, when its
   * {@link ShapeUtil.getText} is not already the whole story.
   */
  getAriaDescriptor?(shape: T): string | undefined

  /**
   * The shape was duplicated. `source` is the original and `duplicate` the new
   * record — new id, new parent, offset already applied. Return a props partial
   * to amend the copy: renaming it, clearing an id that must be unique per
   * instance, re-seeding randomness that would otherwise repeat.
   */
  onDuplicate?(source: T, duplicate: T): Partial<T> | void
  onBeforeCreate?(next: T): T | void
  onBeforeUpdate?(prev: T, next: T): T | void
  onResize?(shape: T, info: ResizeInfo<T>): Partial<T> | void
  onResizeStart?(shape: T): void
  onResizeEnd?(initial: T, current: T): void
  onTranslateStart?(shape: T): Partial<T> | void
  onTranslate?(initial: T, current: T): Partial<T> | void
  onTranslateEnd?(initial: T, current: T): Partial<T> | void
  onRotateStart?(shape: T): void
  onRotate?(initial: T, current: T): Partial<T> | void
  onRotateEnd?(initial: T, current: T): void
  onHandleDrag?(shape: T, info: TLHandleDragInfo<T>): Partial<T> | void
  /**
   * A single, clean click on the shape.
   *
   * Its mere *presence* is a semantic switch: a util that implements it moves
   * selection from pointer-down to pointer-up, so the handler runs before the
   * shape is selected and a drag (which becomes a translation before a click
   * can complete) never triggers it. That is why implementing it conditionally
   * — a prototype accessor answering `undefined` for editors that have no use
   * for it — is a supported way to use it.
   *
   * It cannot swallow the event: returning nothing lets the pointer-up
   * selection run as usual, and there is no "handled" answer to give. Return a
   * shape partial to change the shape as well.
   */
  onClick?(shape: T): Partial<T> | void
  onDoubleClick?(shape: T): Partial<T> | void
  onDoubleClickEdge?(shape: T): Partial<T> | void
  onDoubleClickHandle?(shape: T, handle: ShapeHandle): Partial<T> | void
  onEditEnd?(shape: T): void
  onChildrenChange?(shape: T): Partial<UnknownShape>[] | void
  onDragShapesOver?(shape: T, shapes: UnknownShape[], info?: TLDragShapesOverInfo): void
  /** Shapes were dragged *into* this container and should be adopted. */
  onDragShapesIn?(shape: T, shapes: UnknownShape[], info?: TLDragShapesInInfo): void
  onDragShapesOut?(shape: T, shapes: UnknownShape[], info?: TLDragShapesOutInfo): void
  onDropShapesOver?(shape: T, shapes: UnknownShape[], info?: TLDropShapesOverInfo): void

  /**
   * The points this shape offers when something is dragged near it.
   *
   * Omit it, or return no `points`, to contribute the four corners and the
   * centre of the shape's bounds — what almost every shape wants. Returning an
   * *empty* array says something different: this shape is not a snap target at
   * all.
   *
   * Answered in shape-local coordinates; the snap manager applies the page
   * transform.
   */
  getBoundsSnapGeometry?(shape: T): BoundsSnapGeometry

  /**
   * Where a dragged handle may land on this shape: discrete points to click
   * onto, an outline to slide along, or both.
   *
   * Also in shape-local coordinates.
   */
  getHandleSnapGeometry?(shape: T): HandleSnapGeometry
}

/** Shapes with `w` and `h` props. */
export abstract class BaseBoxShapeUtil<T extends UnknownShape & { props: { w: number; h: number } }> extends ShapeUtil<T> {
  override onResize(shape: T, info: ResizeInfo<T>): Partial<T> {
    const { scaleX, scaleY, initialShape, newPoint } = info
    const w = Math.max(1, Math.abs(initialShape.props.w * scaleX))
    const h = Math.max(1, Math.abs(initialShape.props.h * scaleY))
    return { x: newPoint.x, y: newPoint.y, props: { ...shape.props, w, h } } as Partial<T>
  }
}
