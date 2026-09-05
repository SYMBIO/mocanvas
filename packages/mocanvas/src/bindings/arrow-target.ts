/**
 * What the arrow being dragged is currently pointing at.
 *
 * While a terminal is dragged, three things need the same answer at the same
 * moment: the tool, which will write the binding on pointer-up; the hint
 * overlay, which draws the highlight and the four side handles; and the arrow
 * itself, which routes towards the anchor. Recomputing it in each of them would
 * be three hit tests a frame *and* three chances to disagree about what is
 * under the cursor.
 *
 * So it is computed once and published as editor-scoped state. It is transient
 * — never written to the store, gone when the drag ends — because it describes
 * a gesture in progress, not the document.
 */

import { Vec, atom, type Editor, type UnknownShape, type VecLike } from "@mocanvas/editor"
import type { ArrowBinding } from "./ArrowBindingUtil"
import type { ArrowShape } from "../shapes/ArrowShapeUtil"
import { getArrowBindingTargetAtPoint, getNormalizedAnchor } from "./arrow-terminals"

/** One of the four side handles the hint overlay draws on a target. */
export interface ArrowTargetHandle {
  /** Whether this side may be bound to; a side the opposite terminal already uses is not. */
  isEnabled: boolean
  point: VecLike
}

/** The shape an arrow terminal is currently over, and everything derived from that. */
export interface ArrowTargetState {
  /** Where the terminal would attach, in page space. */
  anchorInPageSpace: VecLike
  /** How the arrow's body is routed — the target's handles differ between kinds. */
  arrowKind: ArrowShape["props"]["kind"]
  /** The target's centre, in page space. */
  centerInPageSpace: VecLike
  /** The four side handles, in page space. */
  handlesInPageSpace: {
    top: ArrowTargetHandle
    bottom: ArrowTargetHandle
    left: ArrowTargetHandle
    right: ArrowTargetHandle
  }
  /** Whether the pointer is inside the target rather than merely near it. */
  isExact: boolean
  /** Whether the binding should keep this exact anchor rather than re-centring. */
  isPrecise: boolean
  /** The anchor as a `0..1` fraction of the target's bounds — what the binding stores. */
  normalizedAnchor: VecLike
  /** Which side of the target an elbow arrow must leave from, when one is forced. */
  snap: "none" | "center" | "edge" | "edge-point"
  /** The shape being pointed at. */
  target: UnknownShape
}

/** Everything {@link updateArrowTargetState} needs to work out the answer. */
export interface UpdateArrowTargetStateOpts {
  /** The arrow being dragged, or `undefined` while a new one is being created. */
  arrow: ArrowShape | undefined
  /** The binding this terminal already has, if any. */
  currentBinding: ArrowBinding | undefined
  editor: Editor
  /** Whether the user is asking for an exact anchor (the modifier is held, or they hovered). */
  isPrecise: boolean
  /** The binding on the arrow's *other* terminal, whose side this one may not reuse. */
  oppositeBinding: ArrowBinding | undefined
  /** The pointer, in page space. */
  pointInPageSpace: VecLike
}

/**
 * The published state, per editor.
 *
 * Keyed by editor rather than held in a module-level variable so two editors on
 * one page do not share a drag; a `WeakMap` so an editor that goes away takes
 * its entry with it.
 */
type TargetAtom = ReturnType<typeof atom<ArrowTargetState | null>>

const targetStates = new WeakMap<Editor, TargetAtom>()

function stateAtom(editor: Editor): TargetAtom {
  let existing = targetStates.get(editor)
  if (!existing) {
    existing = atom<ArrowTargetState | null>("arrowTargetState", null)
    targetStates.set(editor, existing)
  }
  return existing
}

/**
 * What the arrow is currently pointing at, or `null` when it is over empty
 * canvas.
 *
 * Reactive: read it inside a `useValue` or a `react` and the caller re-runs as
 * the pointer moves.
 */
export function getArrowTargetState(editor: Editor): ArrowTargetState | null {
  return stateAtom(editor).get()
}

/**
 * Recompute the target state from the current pointer position, publish it, and
 * return it.
 *
 * Called on every pointer move of a terminal drag. Returns `null` — and clears
 * the published state — when there is nothing bindable under the pointer, so a
 * caller can treat "no target" and "cleared" identically.
 */
export function updateArrowTargetState(opts: UpdateArrowTargetStateOpts): ArrowTargetState | null {
  const { editor, arrow, pointInPageSpace, isPrecise, oppositeBinding } = opts

  // A terminal being dragged before its arrow exists — the arrow tool's very
  // first pointer move — still has to know what it would bind to. The stub
  // stands in for the arrow that is about to exist: parented to the page, so
  // the ancestor walk terminates, and with an id nothing can match.
  const from: UnknownShape =
    arrow ?? ({ id: "shape:pending-arrow", type: "arrow", parentId: editor.getCurrentPageId() } as unknown as UnknownShape)
  const target = getArrowBindingTargetAtPoint(editor, from, pointInPageSpace)
  if (!target) {
    stateAtom(editor).set(null)
    return null
  }

  const bounds = editor.getShapePageBounds(target)
  if (!bounds) {
    stateAtom(editor).set(null)
    return null
  }

  const normalizedAnchor = getNormalizedAnchor(editor, target, pointInPageSpace)
  const anchorInPageSpace = isPrecise
    ? Vec.From(pointInPageSpace)
    : new Vec(bounds.minX + bounds.w / 2, bounds.minY + bounds.h / 2)

  // A side the arrow's *other* end is already bound to is not offered: an
  // elbow that leaves and enters the same side of the same shape has nowhere
  // to route.
  const usedSide = oppositeBinding?.props.terminal === (opts.currentBinding?.props.terminal === "start" ? "end" : "start") ? sideOf(editor, oppositeBinding) : null

  const handlesInPageSpace = {
    top: { isEnabled: usedSide !== "top", point: new Vec(bounds.center.x, bounds.minY) },
    bottom: { isEnabled: usedSide !== "bottom", point: new Vec(bounds.center.x, bounds.maxY) },
    left: { isEnabled: usedSide !== "left", point: new Vec(bounds.minX, bounds.center.y) },
    right: { isEnabled: usedSide !== "right", point: new Vec(bounds.maxX, bounds.center.y) },
  }

  const next: ArrowTargetState = {
    anchorInPageSpace,
    arrowKind: arrow?.props.kind ?? "arc",
    centerInPageSpace: new Vec(bounds.center.x, bounds.center.y),
    handlesInPageSpace,
    isExact: bounds.containsPoint(pointInPageSpace),
    isPrecise,
    normalizedAnchor,
    snap: isPrecise ? "edge-point" : "none",
    target,
  }

  stateAtom(editor).set(next)
  return next
}

/**
 * Forget the current target.
 *
 * Called when a drag ends or is cancelled. Leaving stale state behind would
 * keep the hint overlay drawn on a shape nothing is pointing at any more.
 */
export function clearArrowTargetState(editor: Editor): void {
  if (stateAtom(editor).get() !== null) stateAtom(editor).set(null)
}

/** Which side of its target a binding's anchor is nearest, or `null` when it is central. */
function sideOf(editor: Editor, binding: ArrowBinding | undefined): "top" | "bottom" | "left" | "right" | null {
  if (!binding) return null
  const shape = editor.getShape(binding.toId)
  if (!shape) return null
  const { x, y } = binding.props.normalizedAnchor
  const dx = Math.min(x, 1 - x)
  const dy = Math.min(y, 1 - y)
  // Only an anchor that is actually near an edge names a side; one in the
  // middle names none, which is what leaves every handle enabled.
  if (Math.min(dx, dy) > 0.25) return null
  if (dx < dy) return x < 0.5 ? "left" : "right"
  return y < 0.5 ? "top" : "bottom"
}
