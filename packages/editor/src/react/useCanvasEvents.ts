import { useMemo } from "react"
import type { Editor } from "../editor/Editor"
import type { PointerEventInfo, PointerTarget, WheelEventInfo } from "../editor/events"
import { hitTestSelectionBounds, hitTestSelectionHandles, HANDLE_HIT_RADIUS } from "../editor/selectionHandles"

import { Vec } from "../geometry"

function modifiers(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "")
  return {
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    accelKey: isMac ? e.metaKey : e.ctrlKey,
  }
}

/** Container-relative pointer position. */
function localPoint(editor: Editor, e: { clientX: number; clientY: number }): { x: number; y: number; z: number } {
  const rect = editor.getContainer().getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top, z: 0.5 }
}

/**
 * Resolve what is under the pointer for the event target.
 *
 * `point` is container-relative (see {@link localPoint}), so it converts with
 * `viewportToPage`. `screenToPage` would additionally subtract the container's
 * position on the page — subtracting it twice, and putting every hit test off
 * by the container's offset on any page where the canvas is not at 0,0.
 */
function resolveTarget(editor: Editor, point: { x: number; y: number }): PointerTarget {
  const page = editor.viewportToPage(point)
  if (editor.getCurrentToolId() === "select") {
    const selHandle = hitTestSelectionHandles(editor, point)
    if (selHandle) return { target: "selection", handle: selHandle }
    // Shape handles (arrow ends, line points) of the only selected shape.
    const only = editor.getOnlySelectedShape()
    if (only) {
      const handles = editor.getShapeUtil(only).getHandles?.(only)
      if (handles?.length) {
        const local = editor.getPointInShapeSpace(only, page)
        const r = HANDLE_HIT_RADIUS / editor.getZoomLevel()
        let best: (typeof handles)[number] | undefined
        let bestD = r * r
        for (const h of handles) {
          const d = Vec.Dist2(h, local)
          if (d <= bestD) {
            bestD = d
            best = h
          }
        }
        if (best) return { target: "handle", shape: only, handle: best }
      }
    }
  }
  // Filled shapes hit on their interior, hollow ones only near their outline (engine decides per style).
  const shape = editor.getShapeAtPoint(page, { hitInside: true })
  if (shape) return { target: "shape", shape }
  if (editor.getCurrentToolId() === "select" && hitTestSelectionBounds(editor, page)) {
    const selected = editor.getSelectedShapes()
    const inside = selected.find((s) => editor.getShapeGeometry(s).hitTestPoint(editor.getPointInShapeSpace(s, page), 0, true))
    return inside ? { target: "shape", shape: inside } : { target: "selection" }
  }
  const filled = editor.getShapeAtPoint(page, { hitInside: true })
  if (filled && editor.getSelectedShapeIds().includes(filled.id)) return { target: "shape", shape: filled }
  return { target: "canvas" }
}

/**
 * The layer `TLEditorComponents.InFrontOfTheCanvas` renders into. Kept here as
 * well as in `Canvas` because the canvas's event handlers have to recognise it.
 */
export const IN_FRONT_OF_CANVAS_CLASS = "mocanvas-in-front-of-canvas"
const IN_FRONT_OF_CANVAS_SELECTOR = `.${IN_FRONT_OF_CANVAS_CLASS}`

/** DOM handlers that translate browser events into editor events. */
export function useCanvasEvents(editor: Editor) {
  return useMemo(() => {

    const pointerInfo = (e: PointerEvent | React.PointerEvent, name: PointerEventInfo["name"]): PointerEventInfo => {
      const point = localPoint(editor, e)
      return {
        type: "pointer",
        name,
        point,
        pointerId: e.pointerId,
        button: e.button,
        isPen: e.pointerType === "pen",
        ...modifiers(e),
        ...resolveTarget(editor, point),
      }
    }

    /**
     * Whether a shape's own DOM already dealt with this event.
     *
     * A shape body that handles its own pointer (a text caret, an embedded
     * iframe, a card's button) calls `editor.markEventAsHandled(e)`; the mark
     * is advisory, and this is the check that honours it. Without it the mark
     * did nothing and the canvas would start a selection or a drag underneath
     * an interaction the shape had already consumed.
     */
    const isHandled = (e: { nativeEvent?: unknown } | Event) => editor.isEventHandled(e)

    /**
     * Whether the event came out of the layer in front of the canvas.
     *
     * That layer is an app's own — a toolbar over the selection, a comment pin
     * — and it renders *inside* the element these handlers sit on, so without
     * this a press on one of its buttons also read as a press on empty canvas:
     * the selection cleared, the canvas captured the pointer, and the button
     * never saw the `pointerup` or the click. An app should not have to call
     * `markEventAsHandled` on every control it puts there.
     *
     * The layer itself takes no pointer events, so this only ever sees a
     * press on something the app deliberately made interactive.
     */
    const isInFrontOfCanvas = (target: EventTarget | null) =>
      target instanceof Element && target.closest(IN_FRONT_OF_CANVAS_SELECTOR) !== null

    return {
      onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (isHandled(e) || isInFrontOfCanvas(e.target)) return
        if (e.button === 2) {
          editor.dispatch(pointerInfo(e, "right_click"))
          return
        }
        if (e.button === 1) {
          editor.dispatch(pointerInfo(e, "middle_click"))
        }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        editor.getContainer().focus({ preventScroll: true })
        const down = pointerInfo(e, "pointer_down")
        // Double-click detection lives in `editor.click`, not here. This used
        // to keep its own timer and distance test, which made
        // `editor.click.cancelDoubleClick()` — a public method — silently do
        // nothing, because it cancelled a gesture no one was tracking.
        editor.click.handlePointerEvent(down)
        editor.dispatch(down)
      },
      onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (isHandled(e) || isInFrontOfCanvas(e.target)) return
        if (e.pointerType === "mouse" && e.buttons === 0 && editor.inputs.isPointing) {
          // Missed a pointer up (e.g. released outside the window).
          editor.dispatch(pointerInfo(e, "pointer_up"))
          return
        }
        editor.dispatch(pointerInfo(e, "pointer_move"))
      },
      onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
        if (isHandled(e) || isInFrontOfCanvas(e.target)) return
        if (e.button === 2) return
        const el = e.currentTarget as HTMLElement
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
        const up = pointerInfo(e, "pointer_up")
        editor.dispatch(up)
        // The manager dispatches the click itself, in all three phases
        // (`down`, `up`, `settle`) — a handler decides which it cares about.
        editor.click.handlePointerEvent(up)
      },
      onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
        if (isHandled(e) || isInFrontOfCanvas(e.target)) return
        editor.dispatch(pointerInfo(e, "pointer_up"))
        editor.cancel()
      },
      onWheel(e: WheelEvent) {
        // A panel in the front layer scrolls itself; the canvas does not zoom
        // under it.
        if (isHandled(e) || isInFrontOfCanvas(e.target)) return
        e.preventDefault()
        const point = localPoint(editor, e)
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
        const info: WheelEventInfo = {
          type: "wheel",
          name: "wheel",
          point,
          delta: { x: e.deltaX * scale, y: e.deltaY * scale, z: 0 },
          ...modifiers(e),
        }
        editor.dispatch(info)
      },
      onContextMenu(e: React.MouseEvent) {
        if (isInFrontOfCanvas(e.target)) return
        e.preventDefault()
      },
      onKeyDown(e: KeyboardEvent) {
        if (isHandled(e) || isEditableTarget(e.target)) return
        editor.dispatch({ type: "keyboard", name: e.repeat ? "key_repeat" : "key_down", key: e.key, code: e.code, ...modifiers(e) })
      },
      onKeyUp(e: KeyboardEvent) {
        if (isHandled(e) || isEditableTarget(e.target)) return
        editor.dispatch({ type: "keyboard", name: "key_up", key: e.key, code: e.code, ...modifiers(e) })
      },
    }
  }, [editor])
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable
}
