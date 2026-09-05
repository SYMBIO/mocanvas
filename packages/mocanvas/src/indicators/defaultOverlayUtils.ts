/**
 * The overlay painters a board gets unless it says otherwise.
 *
 * Registration order is only a tie-break: the real painting order is each
 * util's static `zIndex`, which the manager sorts by. The array is listed in
 * that order anyway, because a reader should not have to open eight files to
 * find out what ends up on top of what.
 *
 * Bottom to top:
 *
 * 1. other people's selections, then our own — a shape both of us have selected
 *    shows our outline over theirs, because ours is the one we can act on;
 * 2. the brushes, which are transparent and belong under everything;
 * 3. snap guides and arrow hints, the feedback for a gesture in flight;
 * 4. scribbles;
 * 5. the selection box, then the handles that sit on it;
 * 6. collaborator cursors and off-screen markers, last, because a cursor that
 *    can be hidden by a handle is a cursor you cannot follow.
 */
import type { TLAnyOverlayUtilConstructor } from "@mocanvas/editor"
import { ArrowBindingHintOverlayUtil, ArrowHintOverlayUtil } from "./ArrowHintOverlayUtil"
import { BrushOverlayUtil, ZoomBrushOverlayUtil } from "./BrushOverlayUtil"
import {
  CollaboratorBrushOverlayUtil,
  CollaboratorCursorOverlayUtil,
  CollaboratorHintOverlayUtil,
  CollaboratorScribbleOverlayUtil,
  CollaboratorShapeIndicatorOverlayUtil,
} from "./CollaboratorOverlayUtils"
import { ScribbleOverlayUtil } from "./ScribbleOverlayUtil"
import { SelectionForegroundOverlayUtil } from "./SelectionForegroundOverlayUtil"
import { ShapeHandleOverlayUtil } from "./ShapeHandleOverlayUtil"
import { ShapeIndicatorOverlayUtil } from "./ShapeIndicatorOverlayUtil"
import { SnapIndicatorOverlayUtil } from "./SnapIndicatorOverlayUtil"

/**
 * Pass to `Editor`/`<Mocanvas>` as `overlayUtils`, or spread it to add one:
 *
 * ```ts
 * <Mocanvas overlayUtils={[...defaultOverlayUtils, MyOverlayUtil]} />
 * ```
 *
 * To *replace* one of the defaults, register a util with the same `type` —
 * `OverlayManager.registerUtil` treats a repeated type as an override rather
 * than a duplicate, so a subclass slots in without filtering the array.
 */
export const defaultOverlayUtils: readonly TLAnyOverlayUtilConstructor[] = [
  CollaboratorShapeIndicatorOverlayUtil,
  // The one cast in this file. `ShapeIndicatorOverlayUtil` is constructed with
  // the structural `TLIndicatorHost` rather than with `Editor` — the editor
  // package cannot name its own `Editor` in that seam without a cycle — and
  // `Editor` satisfies the interface at runtime while being a wider type than
  // it at compile time. Every other util in this list is checked normally.
  ShapeIndicatorOverlayUtil as unknown as TLAnyOverlayUtilConstructor,
  BrushOverlayUtil,
  ZoomBrushOverlayUtil,
  CollaboratorBrushOverlayUtil,
  SnapIndicatorOverlayUtil,
  ArrowHintOverlayUtil,
  ArrowBindingHintOverlayUtil,
  ScribbleOverlayUtil,
  CollaboratorScribbleOverlayUtil,
  SelectionForegroundOverlayUtil,
  ShapeHandleOverlayUtil,
  CollaboratorCursorOverlayUtil,
  CollaboratorHintOverlayUtil,
]
