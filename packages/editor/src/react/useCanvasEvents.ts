import { useMemo } from "react"
import type { Editor } from "../editor/Editor"
import type { ClickEventInfo, PointerEventInfo, PointerTarget, WheelEventInfo } from "../editor/events"
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

/** Resolve what is under the pointer for the event target. */
function resolveTarget(editor: Editor, point: { x: number; y: number }): PointerTarget {
  const page = editor.screenToPage(point)
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

/** DOM handlers that translate browser events into editor events. */
export function useCanvasEvents(editor: Editor) {
  return useMemo(() => {
    let lastDownTime = 0
    let clickCount = 0
    let lastDownPoint = { x: 0, y: 0 }

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

    return {
      onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (e.button === 2) {
          editor.dispatch(pointerInfo(e, "right_click"))
          return
        }
        if (e.button === 1) {
          editor.dispatch(pointerInfo(e, "middle_click"))
        }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        editor.getContainer().focus({ preventScroll: true })
        const now = performance.now()
        const p = localPoint(editor, e)
        if (now - lastDownTime < 400 && Math.hypot(p.x - lastDownPoint.x, p.y - lastDownPoint.y) < 8) clickCount++
        else clickCount = 1
        lastDownTime = now
        lastDownPoint = p
        editor.dispatch(pointerInfo(e, "pointer_down"))
      },
      onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (e.pointerType === "mouse" && e.buttons === 0 && editor.inputs.isPointing) {
          // Missed a pointer up (e.g. released outside the window).
          editor.dispatch(pointerInfo(e, "pointer_up"))
          return
        }
        editor.dispatch(pointerInfo(e, "pointer_move"))
      },
      onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
        if (e.button === 2) return
        const el = e.currentTarget as HTMLElement
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
        editor.dispatch(pointerInfo(e, "pointer_up"))
        if (clickCount >= 2) {
          const name: ClickEventInfo["name"] = clickCount === 2 ? "double_click" : clickCount === 3 ? "triple_click" : "quadruple_click"
          const point = localPoint(editor, e)
          editor.dispatch({
            type: "click",
            name,
            phase: "up",
            point,
            pointerId: e.pointerId,
            button: e.button,
            isPen: e.pointerType === "pen",
            ...modifiers(e),
            ...resolveTarget(editor, point),
          })
        }
      },
      onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
        editor.dispatch(pointerInfo(e, "pointer_up"))
        editor.cancel()
      },
      onWheel(e: WheelEvent) {
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
        e.preventDefault()
      },
      onKeyDown(e: KeyboardEvent) {
        if (isEditableTarget(e.target)) return
        editor.dispatch({ type: "keyboard", name: e.repeat ? "key_repeat" : "key_down", key: e.key, code: e.code, ...modifiers(e) })
      },
      onKeyUp(e: KeyboardEvent) {
        if (isEditableTarget(e.target)) return
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
