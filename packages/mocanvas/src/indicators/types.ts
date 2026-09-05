/**
 * The overlay records the built-in painters produce.
 *
 * Every one of them is a {@link TLOverlay}: an id unique within its util, the
 * util's type, optional page-space geometry for hit testing, and an optional
 * cursor. What each interface adds on top is *the state that was resolved this
 * frame* — the brush rectangle, the snap line's points, the collaborator whose
 * cursor this is.
 *
 * Splitting the record out of the painter is what makes an overlay testable
 * without a canvas: `getOverlays()` is pure and can be asserted on, and
 * `render` is the thin part that turns records into strokes.
 */
import type { Scribble, TLOverlay, VecLike } from "@mocanvas/editor"

/** A camera, as {@link Editor.getCamera} returns it. */
export interface CameraLike {
  x: number
  y: number
  z: number
}

/** A page-space rectangle. */
export interface OverlayBox {
  x: number
  y: number
  w: number
  h: number
}

/** The selection brush dragged by the select tool. */
export interface TLBrushOverlay extends TLOverlay {
  type: "brush"
  /** The brush rectangle, in page space. */
  bounds: OverlayBox
}

/**
 * The brush dragged by the zoom tool.
 *
 * A separate record from {@link TLBrushOverlay} rather than a flag on it: the
 * two are live at different times, are drawn differently (a zoom brush has no
 * fill worth speaking of), and a tool that wanted one and got the other would
 * be a silent bug.
 */
export interface TLZoomBrushOverlay extends TLOverlay {
  type: "zoomBrush"
  /** The zoom rectangle, in page space. */
  bounds: OverlayBox
}

/** One live scribble — a laser trail, an eraser stroke. */
export interface TLScribbleOverlay extends TLOverlay {
  type: "scribble"
  /** The scribble record, points in page space. */
  scribble: Scribble
}

/** One snap guide: the aligned edge or centre, plus the points it aligned. */
export interface TLSnapIndicatorOverlay extends TLOverlay {
  type: "snapIndicator"
  /** Page-space points along the guide, at least two. */
  points: readonly VecLike[]
}

/** One of a shape's own handles — an arrow terminal, a line vertex. */
export interface TLShapeHandleOverlay extends TLOverlay {
  type: "shapeHandle"
  /** The shape the handle belongs to. */
  shapeId: string
  /** The handle's id, as its shape util named it. */
  handleId: string
  /** `virtual` handles are the midpoints that only exist until you drag one. */
  handleType: "vertex" | "virtual" | "create" | "clone"
  /** Page-space position. */
  point: VecLike
}

/**
 * The selection box and one of its resize/rotate handles.
 *
 * "Foreground" because it is drawn *over* the shapes, as opposed to the
 * selection background that catches a drag on the interior. One record per
 * handle, plus one for the box itself (`handle: null`), so the manager can say
 * which handle the pointer is over.
 */
export interface TLSelectionForegroundOverlay extends TLOverlay {
  type: "selectionForeground"
  /** The handle this record is, or `null` for the box outline. */
  handle: string | null
  /** Screen-space position of the handle; `null` for the box outline. */
  point: VecLike | null
}

/**
 * The hint drawn on a shape an arrow terminal is about to bind to.
 *
 * Not the arrow: the *target*. Dragging an arrow end over a rectangle outlines
 * the rectangle, which is the only cue that letting go will attach rather than
 * drop a loose endpoint.
 */
export interface TLArrowHintOverlay extends TLOverlay {
  type: "arrowHint"
  /** The shape being hinted at. */
  shapeId: string
  /** Page-space bounds of that shape. */
  bounds: OverlayBox
}

/**
 * The anchor dot at an arrow terminal that is *already* bound.
 *
 * Distinct from {@link TLArrowHintOverlay}: that one says "this will bind",
 * this one says "this is bound, and here is the point it is bound to" — the
 * thing you need to see in order to understand why an arrow moved when you
 * dragged something else.
 */
export interface TLArrowBindingHintOverlay extends TLOverlay {
  type: "arrowBindingHint"
  /** The arrow. */
  arrowId: string
  /** The shape it is bound to. */
  boundShapeId: string
  /** Which end of the arrow. */
  terminal: "start" | "end"
  /** Page-space position of the anchor. */
  point: VecLike
}

/** What every collaborator overlay carries: who it belongs to, and their colour. */
interface TLCollaboratorOverlayBase extends TLOverlay {
  /** The collaborator's presence record id. */
  presenceId: string
  /** Their display name. */
  userName: string
  /** Their assigned colour, from the presence record. */
  color: string
  /** Whether they have gone quiet — drawn dimmer, never hidden. */
  isIdle: boolean
}

/** Another person's pointer. */
export interface TLCollaboratorCursorOverlay extends TLCollaboratorOverlayBase {
  type: "collaboratorCursor"
  /** Page-space position of their pointer. */
  point: VecLike
  /** Their pointer's rotation in radians. */
  rotation: number
  /** What they are typing into the chat bubble, or `""`. */
  chatMessage: string
}

/** Another person's selection brush. */
export interface TLCollaboratorBrushOverlay extends TLCollaboratorOverlayBase {
  type: "collaboratorBrush"
  /** Their brush rectangle, in page space. */
  bounds: OverlayBox
}

/** One of another person's live scribbles. */
export interface TLCollaboratorScribbleOverlay extends TLCollaboratorOverlayBase {
  type: "collaboratorScribble"
  /** The scribble record, points in page space. */
  scribble: Scribble
}

/** An outline around a shape another person has selected. */
export interface TLCollaboratorShapeIndicatorOverlay extends TLCollaboratorOverlayBase {
  type: "collaboratorShapeIndicator"
  /** The selected shape. */
  shapeId: string
  /** Its page transform, as `a b c d e f`. */
  transform: { a: number; b: number; c: number; d: number; e: number; f: number }
  /** Its geometry bounds, in shape-local space. */
  bounds: OverlayBox
}

/**
 * The marker that says a collaborator is off screen, and which way to look.
 *
 * Drawn on the viewport edge, pointing at where they are. Without it a person
 * who scrolls away simply vanishes, and there is no way to follow them back.
 */
export interface TLCollaboratorHintOverlay extends TLCollaboratorOverlayBase {
  type: "collaboratorHint"
  /** Screen-space point on the viewport edge where the marker is drawn. */
  point: VecLike
  /** Direction to their cursor, in radians. */
  rotation: number
}
