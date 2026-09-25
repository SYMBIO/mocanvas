import {
  Box,
  canonicalizeRotation,
  dropShapesOnFrameLike,
  getFrameLikeDropTarget,
  StateNode,
  Vec,
  type ClickEventInfo,
  type Editor,
  type KeyboardEventInfo,
  type PointerEventInfo,
  type SelectionHandle,
  type ShapeHandle,
  type ShapeId,
  type ShapePartial,
  type StateNodeConstructor,
  type UnknownShape,
} from "@mocanvas/editor"

const RESIZE_CURSORS: Partial<Record<SelectionHandle, string>> = {
  top: "ns-resize",
  bottom: "ns-resize",
  left: "ew-resize",
  right: "ew-resize",
  top_left: "nwse-resize",
  bottom_right: "nwse-resize",
  top_right: "nesw-resize",
  bottom_left: "nesw-resize",
  rotate: "grab",
}

function setCursor(editor: { updateInstanceState(p: { cursor: { type: string; rotation: number } }): unknown }, type: string): void {
  editor.updateInstanceState({ cursor: { type, rotation: 0 } })
}

/**
 * Turn edge scrolling on for a drag, and keep the drag honest while it runs.
 *
 * `EdgeScrollManager` only pans the camera; it is deliberately ignorant of what
 * the gesture on top of it is doing. But a drag reads
 * `inputs.currentPagePoint`, and edge scrolling changes what is under a
 * stationary pointer without any pointer event firing — so the gesture has to
 * be re-run on the frames where the camera actually moved, or the board scrolls
 * out from under a shape that never follows. Comparing the camera rather than
 * asking the manager also covers a camera moved during the drag by anything
 * else (a wheel zoom, a collaborator being followed).
 *
 * Returns the teardown, to be called from the state's `onExit`.
 */
function startEdgeScrolling(node: StateNode, update: () => void): () => void {
  const editor = node.editor
  editor.edgeScrollManager.start()
  let camera = editor.getCamera()
  const off = editor.on("tick", () => {
    const next = editor.getCamera()
    if (next.x === camera.x && next.y === camera.y && next.z === camera.z) return
    camera = next
    update()
  })
  return () => {
    off()
    editor.edgeScrollManager.stop()
  }
}

class Idle extends StateNode {
  static override id = "idle"

  override onEnter(): void {
    this.editor.updateInstanceState({ cursor: { type: "default", rotation: 0 } })
  }

  override onPointerMove(info: PointerEventInfo): void {
    const hovered = info.target === "shape" ? info.shape : undefined
    this.editor.setHoveredShape(hovered && !this.editor.isShapeOrAncestorLocked(hovered) ? hovered.id : null)
    if (info.target === "selection" && info.handle) setCursor(this.editor, RESIZE_CURSORS[info.handle] ?? "default")
    else if (info.target === "handle") setCursor(this.editor, "pointer")
    else setCursor(this.editor, "default")
  }

  override onPointerDown(info: PointerEventInfo): void {
    if (info.button !== 0) return
    switch (info.target) {
      case "canvas": {
        this.parent!.transition("pointing_canvas", info)
        break
      }
      case "selection": {
        if (info.handle === "rotate") this.parent!.transition("pointing_rotate_handle", info)
        else if (info.handle) this.parent!.transition("pointing_resize_handle", info)
        else this.parent!.transition("pointing_selection", info)
        break
      }
      case "handle": {
        this.parent!.transition("pointing_handle", info)
        break
      }
      case "shape": {
        if (this.editor.isShapeOrAncestorLocked(info.shape)) {
          this.parent!.transition("pointing_canvas", info)
          return
        }
        const outer = this.editor.getOutermostSelectableShape(info.shape) ?? info.shape
        this.parent!.transition("pointing_shape", { ...info, shape: outer })
        break
      }
      default:
        break
    }
  }

  override onDoubleClick(info: ClickEventInfo): void {
    // A double click is reported in three phases; act on the release, which is
    // the one this tool has always acted on. Acting on `down` too would enter a
    // group and then immediately act again inside it.
    if (info.phase !== "up") return
    if (info.target !== "shape") return
    const outer = this.editor.getOutermostSelectableShape(info.shape) ?? info.shape
    if (outer.type === "group" && outer.id !== info.shape.id) {
      // Focus into the group so its children become selectable.
      this.editor.updateCurrentPageState({ focusedGroupId: outer.id })
      const inner = this.editor.getOutermostSelectableShape(info.shape) ?? info.shape
      this.editor.select(inner.id)
      return
    }
    const shape = info.shape
    const util = this.editor.getShapeUtil(shape)
    if (util.canEdit(shape) && !this.editor.isShapeOrAncestorLocked(shape)) {
      this.editor.select(shape.id)
      this.editor.setEditingShape(shape.id)
    } else {
      const change = util.onDoubleClick?.(shape)
      if (change) this.editor.updateShape({ id: shape.id, type: shape.type, ...change })
    }
  }

  override onKeyDown(info: KeyboardEventInfo): void {
    const editor = this.editor
    switch (info.key) {
      case "Delete":
      case "Backspace": {
        const ids = editor.getSelectedShapeIds()
        if (ids.length) {
          editor.markHistoryStoppingPoint("delete")
          editor.deleteShapes(ids)
        }
        break
      }
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        const ids = editor.getSelectedShapeIds()
        if (!ids.length) return
        const step = info.shiftKey ? 10 : 1
        const d = new Vec(
          info.key === "ArrowLeft" ? -step : info.key === "ArrowRight" ? step : 0,
          info.key === "ArrowUp" ? -step : info.key === "ArrowDown" ? step : 0,
        )
        editor.markHistoryStoppingPoint("nudge")
        editor.updateShapes(
          ids.map((id) => {
            const s = editor.getShape(id)!
            return { id, type: s.type, x: s.x + d.x, y: s.y + d.y }
          }),
        )
        break
      }
      case "Escape": {
        if (editor.getEditingShapeId()) editor.setEditingShape(null)
        else if (editor.getCurrentPageState().focusedGroupId) {
          const g = editor.getCurrentPageState().focusedGroupId!
          editor.updateCurrentPageState({ focusedGroupId: null })
          editor.select(g)
        } else editor.selectNone()
        break
      }
      default:
        break
    }
  }

  override onCancel(): void {
    if (this.editor.getEditingShapeId()) this.editor.setEditingShape(null)
    else this.editor.selectNone()
  }
}

class PointingCanvas extends StateNode {
  static override id = "pointing_canvas"

  override onEnter(): void {
    if (!this.editor.inputs.shiftKey) {
      if (this.editor.getEditingShapeId()) this.editor.setEditingShape(null)
      if (this.editor.getCurrentPageState().focusedGroupId) this.editor.updateCurrentPageState({ focusedGroupId: null })
      this.editor.selectNone()
    }
  }

  override onPointerMove(): void {
    if (this.editor.inputs.isDragging) this.parent!.transition("brushing")
  }

  override onPointerUp(): void {
    this.parent!.transition("idle")
  }

  override onCancel(): void {
    this.parent!.transition("idle")
  }
}

class Brushing extends StateNode {
  static override id = "brushing"
  private initialSelection: ShapeId[] = []

  private stopEdgeScrolling: (() => void) | undefined

  override onEnter(): void {
    this.initialSelection = this.editor.inputs.shiftKey ? this.editor.getSelectedShapeIds() : []
    // A marquee has to be able to reach past the edge of the window, or the
    // only shapes selectable in one gesture are the ones already on screen.
    this.stopEdgeScrolling = startEdgeScrolling(this, () => this.update())
    this.update()
  }

  override onPointerMove(): void {
    this.update()
  }

  override onPointerUp(): void {
    this.finish()
  }

  override onCancel(): void {
    this.editor.setSelectedShapes(this.initialSelection)
    this.finish()
  }

  override onExit(): void {
    this.stopEdgeScrolling?.()
    this.stopEdgeScrolling = undefined
    this.editor.updateInstanceState({ brush: null })
  }

  private update(): void {
    const { originPagePoint, currentPagePoint, ctrlKey } = this.editor.inputs
    const box = Box.FromPoints([originPagePoint, currentPagePoint])
    this.editor.updateInstanceState({ brush: box.toJson() })
    const hits = ctrlKey ? this.editor.getShapesInsideBounds(box) : this.editor.getShapesIntersectingBounds(box)
    const pageId = this.editor.getCurrentPageId()
    const ids = new Set<ShapeId>(this.initialSelection)
    for (const s of hits) {
      if (s.isLocked) continue
      // select top-level ancestors only
      let top: UnknownShape = s
      while (top.parentId !== pageId) {
        const p = this.editor.getShape(top.parentId as ShapeId)
        if (!p) break
        top = p
      }
      ids.add(top.id)
    }
    this.editor.setSelectedShapes([...ids])
  }

  private finish(): void {
    this.parent!.transition("idle")
  }
}

class PointingShape extends StateNode {
  static override id = "pointing_shape"
  private hitShape: UnknownShape | undefined
  private wasSelected = false

  override onEnter(info: Record<string, unknown>): void {
    const shape = (info as { shape?: UnknownShape }).shape
    this.hitShape = shape
    if (!shape) return
    const editor = this.editor
    const selected = editor.getSelectedShapeIds()
    this.wasSelected = selected.includes(shape.id)
    if (editor.inputs.shiftKey) {
      if (!this.wasSelected) editor.setSelectedShapes([...selected, shape.id])
    } else if (!this.wasSelected) {
      editor.setSelectedShapes([shape.id])
    }
  }

  override onPointerMove(): void {
    if (this.editor.inputs.isDragging) {
      this.parent!.transition("translating")
    }
  }

  override onPointerUp(): void {
    const editor = this.editor
    if (editor.inputs.shiftKey && this.wasSelected && this.hitShape) {
      editor.setSelectedShapes(editor.getSelectedShapeIds().filter((id) => id !== this.hitShape!.id))
    }
    this.parent!.transition("idle")
  }

  override onCancel(): void {
    this.parent!.transition("idle")
  }
}

/**
 * Whether a drag lines the selection up with other shapes.
 *
 * tldraw's rule, and the one an app's users will expect: the accelerator key
 * asks for shape snapping, and "always snap" in the user's preferences turns
 * that around so the key asks for the opposite. mocanvas used to snap to shapes
 * whenever the key was *not* held, which is neither of those.
 */
function snapsToShapes(editor: Editor): boolean {
  const { ctrlKey, accelKey } = editor.inputs
  const asked = ctrlKey || accelKey
  return editor.user.getIsSnapMode() ? !asked : asked
}

/** The grid step to move and resize in, or 0 when the grid is off. */
function gridStep(editor: Editor): number {
  if (!editor.getInstanceState().isGridMode) return 0
  const size = editor.getDocumentSettings().gridSize
  return Number.isFinite(size) && size > 0 ? size : 0
}

class Translating extends StateNode {
  static override id = "translating"
  private initialShapes = new Map<ShapeId, UnknownShape>()
  private markId = ""
  private stopEdgeScrolling: (() => void) | undefined

  override onEnter(): void {
    const editor = this.editor
    this.markId = editor.markHistoryStoppingPoint("translate")
    // Dragging a shape to somewhere off screen is only possible if the board
    // scrolls under the drag.
    this.stopEdgeScrolling = startEdgeScrolling(this, () => this.update())
    this.initialShapes.clear()
    for (const s of editor.getSelectedShapes()) {
      this.initialShapes.set(s.id, s)
      editor.getShapeUtil(s).onTranslateStart?.(s)
    }
    editor.updateInstanceState({ cursor: { type: "move", rotation: 0 } })
    this.update()
  }

  override onPointerMove(): void {
    this.update()
  }

  override onPointerUp(): void {
    this.complete()
  }

  override onComplete(): void {
    this.complete()
  }

  override onCancel(): void {
    this.editor.bailToMark(this.markId)
    this.parent!.transition("idle")
  }

  override onKeyDown(info: KeyboardEventInfo): void {
    if (info.key === "Shift" || info.key === "Alt") this.update()
  }

  override onKeyUp(info: KeyboardEventInfo): void {
    if (info.key === "Shift" || info.key === "Alt") this.update()
  }

  private initialBounds: Box | undefined

  private update(): void {
    const editor = this.editor
    const { originPagePoint, currentPagePoint, shiftKey } = editor.inputs
    let delta = Vec.Sub(currentPagePoint, originPagePoint)
    let lockX = false
    let lockY = false
    if (shiftKey) {
      // lock to the dominant axis
      if (Math.abs(delta.x) > Math.abs(delta.y)) {
        delta = new Vec(delta.x, 0)
        lockY = true
      } else {
        delta = new Vec(0, delta.y)
        lockX = true
      }
    }
    this.initialBounds ??= Box.Common(
      [...this.initialShapes.values()].map((s) => editor.getShapePageBounds(s)).filter((b): b is Box => !!b),
    )
    if (snapsToShapes(editor) && editor.inputs.isDragging) {
      if (this.initialBounds) {
        const moving = new Box(this.initialBounds.x + delta.x, this.initialBounds.y + delta.y, this.initialBounds.w, this.initialBounds.h)
        const { nudge } = editor.snaps.snapTranslate(moving, new Set(this.initialShapes.keys()), { lockX, lockY })
        delta = Vec.Add(delta, nudge)
      }
    } else {
      editor.snaps.clearLines()
      // Grid mode moves in grid steps. Not both at once: shape snapping already
      // decides where the shape lands, and rounding that to the grid afterwards
      // would pull it back off the edge it just lined up with.
      const grid = gridStep(editor)
      if (grid && this.initialBounds) {
        const moved = new Vec(this.initialBounds.x + delta.x, this.initialBounds.y + delta.y)
        const snapped = moved.clone().snapToGrid(grid)
        delta = new Vec(lockX ? delta.x : delta.x + (snapped.x - moved.x), lockY ? delta.y : delta.y + (snapped.y - moved.y))
      }
    }
    const updates: ShapePartial[] = []
    for (const [id, initial] of this.initialShapes) {
      // delta is in page space; convert to parent space for nested shapes
      const parent = editor.getShapeParent(initial)
      let d = delta
      if (parent) {
        const m = editor.getShapePageTransform(parent)
        const det = m.a * m.d - m.b * m.c || 1
        d = new Vec((m.d * delta.x - m.c * delta.y) / det, (-m.b * delta.x + m.a * delta.y) / det)
      }
      const next = { ...initial, x: initial.x + d.x, y: initial.y + d.y }
      const change = editor.getShapeUtil(initial).onTranslate?.(initial, next)
      updates.push({ id, type: initial.type, x: next.x, y: next.y, ...(change ?? {}) })
    }
    editor.updateShapes(updates)
    this.updateDropTarget()
  }

  /** The container the pointer is currently over, and whether a drag happened at all. */
  private dropTarget: UnknownShape | undefined
  private didDrag = false

  /**
   * Mark the container the drag is currently over, so its indicator draws in
   * the heavier "hinting" weight while the pointer is inside it. Cleared on
   * exit, including a cancel — a stale hint outlives the gesture otherwise.
   */
  private updateDropTarget(): void {
    const editor = this.editor
    if (!editor.inputs.isDragging) return
    this.didDrag = true
    const dragging = [...this.initialShapes.keys()]
      .map((id) => editor.getShape<UnknownShape>(id))
      .filter((s): s is UnknownShape => !!s)
    this.dropTarget = getFrameLikeDropTarget(editor, editor.inputs.currentPagePoint, dragging)
    editor.setHintingShapes(this.dropTarget ? [this.dropTarget.id] : [])
  }

  private complete(): void {
    const editor = this.editor
    for (const [id, initial] of this.initialShapes) {
      const current = editor.getShape(id)
      if (current) {
        const change = editor.getShapeUtil(initial).onTranslateEnd?.(initial, current)
        if (change) editor.updateShape({ id, type: initial.type, ...change })
      }
    }
    this.dropOnTarget()
    this.parent!.transition("idle")
  }

  /**
   * Hand the dragged shapes to whatever container they were released over —
   * or back to the page when they were released over nothing.
   *
   * Reads the target the last move computed rather than re-deriving it: by the
   * time the gesture completes the pointer is already up, so "is the user
   * dragging" is no longer true and the point is no longer the drop point.
   */
  private dropOnTarget(): void {
    // A click that happens to land inside a frame must not silently reparent
    // the shape it selected.
    if (!this.didDrag) return
    const editor = this.editor
    const dragging = [...this.initialShapes.keys()]
      .map((id) => editor.getShape<UnknownShape>(id))
      .filter((s): s is UnknownShape => !!s)
    if (dragging.length === 0) return
    dropShapesOnFrameLike(editor, this.dropTarget, dragging)
  }

  override onExit(): void {
    this.stopEdgeScrolling?.()
    this.stopEdgeScrolling = undefined
    this.editor.snaps.clearLines()
    this.editor.setHintingShapes([])
    this.initialBounds = undefined
    this.dropTarget = undefined
    this.didDrag = false
  }
}

class PointingSelection extends StateNode {
  static override id = "pointing_selection"
  override onPointerMove(): void {
    if (this.editor.inputs.isDragging) this.parent!.transition("translating")
  }
  override onPointerUp(): void {
    this.parent!.transition("idle")
  }
  override onCancel(): void {
    this.parent!.transition("idle")
  }
}

class PointingResizeHandle extends StateNode {
  static override id = "pointing_resize_handle"
  private handle: SelectionHandle = "bottom_right"
  override onEnter(info: Record<string, unknown>): void {
    this.handle = (info as { handle?: SelectionHandle }).handle ?? "bottom_right"
  }
  override onPointerMove(): void {
    if (this.editor.inputs.isDragging) this.parent!.transition("resizing", { handle: this.handle })
  }
  override onPointerUp(): void {
    this.parent!.transition("idle")
  }
  override onCancel(): void {
    this.parent!.transition("idle")
  }
}

class PointingRotateHandle extends StateNode {
  static override id = "pointing_rotate_handle"
  override onPointerMove(): void {
    if (this.editor.inputs.isDragging) this.parent!.transition("rotating")
  }
  override onPointerUp(): void {
    this.parent!.transition("idle")
  }
  override onCancel(): void {
    this.parent!.transition("idle")
  }
}

class PointingHandle extends StateNode {
  static override id = "pointing_handle"
  private info: { shape: UnknownShape; handle: ShapeHandle } | null = null
  override onEnter(info: Record<string, unknown>): void {
    const i = info as { shape?: UnknownShape; handle?: ShapeHandle }
    this.info = i.shape && i.handle ? { shape: i.shape, handle: i.handle } : null
  }
  override onPointerMove(): void {
    if (this.editor.inputs.isDragging && this.info) this.parent!.transition("dragging_handle", this.info)
  }
  override onPointerUp(): void {
    this.parent!.transition("idle")
  }
  override onCancel(): void {
    this.parent!.transition("idle")
  }
}

interface ResizeSnapshot {
  shape: UnknownShape
  /** Shape-local geometry bounds. */
  bounds: Box
  /** Page position of the shape origin. */
  pagePos: Vec
}

class Resizing extends StateNode {
  static override id = "resizing"
  private handle: SelectionHandle = "bottom_right"
  private markId = ""
  private snapshots: ResizeSnapshot[] = []
  private initialSelectionBounds = new Box()
  private single: UnknownShape | undefined
  private singleRotation = 0

  override onEnter(info: Record<string, unknown>): void {
    const editor = this.editor
    this.handle = (info as { handle?: SelectionHandle }).handle ?? "bottom_right"
    this.markId = editor.markHistoryStoppingPoint("resize")
    const selected = editor.getSelectedShapes()
    this.snapshots = selected.map((shape) => {
      const m = editor.getShapePageTransform(shape)
      return { shape, bounds: editor.getShapeGeometryBounds(shape)!.clone(), pagePos: new Vec(m.e, m.f) }
    })
    this.single = selected.length === 1 ? selected[0] : undefined
    this.singleRotation = this.single ? editor.getSelectionRotation() : 0
    this.initialSelectionBounds = this.single ? this.snapshots[0]!.bounds.clone() : editor.getSelectionPageBounds()!.clone()
    for (const s of this.snapshots) editor.getShapeUtil(s.shape).onResizeStart?.(s.shape)
    setCursor(editor, RESIZE_CURSORS[this.handle] ?? "default")
    this.update()
  }

  override onPointerMove(): void {
    this.update()
  }
  override onKeyDown(): void {
    this.update()
  }
  override onKeyUp(): void {
    this.update()
  }
  override onPointerUp(): void {
    this.complete()
  }
  override onComplete(): void {
    this.complete()
  }
  override onCancel(): void {
    this.editor.bailToMark(this.markId)
    this.parent!.transition("idle")
  }

  /** Pointer position in the resize frame (shape-local for a single shape, page for many). */
  private framePoint(pagePoint: Vec): Vec {
    if (!this.single) return pagePoint
    const s = this.snapshots[0]!
    // inverse of the initial page transform (rotation + translation only)
    const d = Vec.Sub(pagePoint, s.pagePos)
    return Vec.Rot(d, -this.singleRotation)
  }

  private update(): void {
    const editor = this.editor
    const { currentPagePoint, originPagePoint, shiftKey, altKey } = editor.inputs
    const b0 = this.initialSelectionBounds
    const p = this.framePoint(currentPagePoint)
    const p0 = this.framePoint(originPagePoint)
    const delta = Vec.Sub(p, p0)
    const h = this.handle

    // New frame bounds from the dragged handle.
    let minX = b0.x
    let minY = b0.y
    let maxX = b0.maxX
    let maxY = b0.maxY
    if (h.includes("left")) minX += delta.x
    if (h.includes("right")) maxX += delta.x
    if (h.includes("top")) minY += delta.y
    if (h.includes("bottom")) maxY += delta.y
    // Grid mode resizes in grid steps: the edge the handle drags lands on the
    // grid, and the edge it does not stays where it was.
    const grid = gridStep(editor)
    if (grid) {
      const toGrid = (v: number) => Math.round(v / grid) * grid
      if (h.includes("left")) minX = toGrid(minX)
      if (h.includes("right")) maxX = toGrid(maxX)
      if (h.includes("top")) minY = toGrid(minY)
      if (h.includes("bottom")) maxY = toGrid(maxY)
    }
    if (altKey) {
      // Symmetric about the centre, mirroring the edge as it ended up — which
      // in grid mode is the snapped one, so the two sides stay equal.
      if (h.includes("left")) maxX = b0.maxX + (b0.x - minX)
      if (h.includes("right")) minX = b0.x - (maxX - b0.maxX)
      if (h.includes("top")) maxY = b0.maxY + (b0.y - minY)
      if (h.includes("bottom")) minY = b0.y - (maxY - b0.maxY)
    }
    let scaleX = b0.w === 0 ? 1 : (maxX - minX) / b0.w
    let scaleY = b0.h === 0 ? 1 : (maxY - minY) / b0.h
    const lockAspect = shiftKey || (this.single ? editor.getShapeUtil(this.single).isAspectRatioLocked(this.single) : false)
    if (lockAspect && h.includes("_")) {
      const s = Math.max(Math.abs(scaleX), Math.abs(scaleY))
      scaleX = Math.sign(scaleX || 1) * s
      scaleY = Math.sign(scaleY || 1) * s
      // recompute the moving edges from the anchored ones
      if (h.includes("left")) minX = maxX - b0.w * scaleX
      else maxX = minX + b0.w * scaleX
      if (h.includes("top")) minY = maxY - b0.h * scaleY
      else maxY = minY + b0.h * scaleY
    }
    // Flipping is not supported yet: clamp to a minimum size.
    const MIN = 1
    if (maxX - minX < MIN) {
      if (h.includes("left")) minX = maxX - MIN
      else maxX = minX + MIN
      scaleX = MIN / (b0.w || MIN)
    }
    if (maxY - minY < MIN) {
      if (h.includes("top")) minY = maxY - MIN
      else maxY = minY + MIN
      scaleY = MIN / (b0.h || MIN)
    }
    const anchorX = minX - b0.x * scaleX
    const anchorY = minY - b0.y * scaleY

    const updates: ShapePartial[] = []
    for (const snap of this.snapshots) {
      const { shape, bounds } = snap
      const util = editor.getShapeUtil(shape)
      if (!util.canResize(shape)) continue
      let newOriginFrame: Vec
      if (this.single) {
        // frame == shape local space; local origin (0,0) maps to (anchorX, anchorY)
        newOriginFrame = new Vec(anchorX, anchorY)
      } else {
        const rel = Vec.Sub(snap.pagePos, new Vec(b0.x, b0.y))
        newOriginFrame = new Vec(minX + rel.x * scaleX, minY + rel.y * scaleY)
      }
      // frame → page → parent
      const pagePoint = this.single ? Vec.Add(Vec.Rot(newOriginFrame, this.singleRotation), snap.pagePos) : newOriginFrame
      const parentPoint = editor.getPointInParentSpace(shape, pagePoint)
      const change = util.onResize?.(shape, {
        newPoint: parentPoint,
        handle: h,
        mode: "scale_shape",
        scaleX,
        scaleY,
        initialBounds: bounds.toJson(),
        initialShape: shape,
      })
      updates.push({ id: shape.id, type: shape.type, x: parentPoint.x, y: parentPoint.y, ...(change ?? {}) })
    }
    editor.updateShapes(updates)
  }

  private complete(): void {
    const editor = this.editor
    for (const snap of this.snapshots) {
      const current = editor.getShape(snap.shape.id)
      if (current) editor.getShapeUtil(snap.shape).onResizeEnd?.(snap.shape, current)
    }
    this.parent!.transition("idle")
  }
}

class Rotating extends StateNode {
  static override id = "rotating"
  private markId = ""
  private center = new Vec()
  private startAngle = 0
  private initialShapes: { shape: UnknownShape; pagePos: Vec; pageRotation: number }[] = []

  override onEnter(): void {
    const editor = this.editor
    this.markId = editor.markHistoryStoppingPoint("rotate")
    this.center = editor.getSelectionPageBounds()!.center
    this.startAngle = Vec.Angle(this.center, editor.inputs.originPagePoint)
    this.initialShapes = editor.getSelectedShapes().map((shape) => {
      const m = editor.getShapePageTransform(shape)
      return { shape, pagePos: new Vec(m.e, m.f), pageRotation: Math.atan2(m.b, m.a) }
    })
    for (const i of this.initialShapes) editor.getShapeUtil(i.shape).onRotateStart?.(i.shape)
    setCursor(editor, "grabbing")
  }

  override onPointerMove(): void {
    this.update()
  }
  override onKeyDown(): void {
    this.update()
  }
  override onKeyUp(): void {
    this.update()
  }
  override onPointerUp(): void {
    this.complete()
  }
  override onComplete(): void {
    this.complete()
  }
  override onCancel(): void {
    this.editor.bailToMark(this.markId)
    this.parent!.transition("idle")
  }

  private update(): void {
    const editor = this.editor
    let delta = Vec.Angle(this.center, editor.inputs.currentPagePoint) - this.startAngle
    if (editor.inputs.shiftKey) {
      const step = Math.PI / 12
      // snap the resulting page rotation of the first shape to 15° steps
      const base = this.initialShapes[0]?.pageRotation ?? 0
      delta = Math.round((base + delta) / step) * step - base
    }
    const updates: ShapePartial[] = []
    for (const i of this.initialShapes) {
      const newPagePos = Vec.RotWith(i.pagePos, this.center, delta)
      const parentPoint = editor.getPointInParentSpace(i.shape, newPagePos)
      // Canonicalized for the same reason `Editor.rotateShapesBy` does it: the
      // number is persisted and synced, and an angle that only accumulates
      // makes two identical-looking documents compare unequal. Safe mid-drag —
      // each frame recomputes from the rotation captured at drag start, so
      // there is nothing to accumulate and nothing to jump.
      const next = { ...i.shape, x: parentPoint.x, y: parentPoint.y, rotation: canonicalizeRotation(i.shape.rotation + delta) }
      const change = editor.getShapeUtil(i.shape).onRotate?.(i.shape, next)
      updates.push({ id: i.shape.id, type: i.shape.type, x: next.x, y: next.y, rotation: next.rotation, ...(change ?? {}) })
    }
    editor.updateShapes(updates)
  }

  private complete(): void {
    const editor = this.editor
    for (const i of this.initialShapes) {
      const current = editor.getShape(i.shape.id)
      if (current) editor.getShapeUtil(i.shape).onRotateEnd?.(i.shape, current)
    }
    this.parent!.transition("idle")
  }
}

class DraggingHandle extends StateNode {
  static override id = "dragging_handle"
  private markId = ""
  private shape!: UnknownShape
  private handle!: ShapeHandle
  private startedAt = 0

  override onEnter(info: Record<string, unknown>): void {
    const i = info as { shape: UnknownShape; handle: ShapeHandle }
    this.shape = this.editor.getShape(i.shape.id) ?? i.shape
    this.handle = i.handle
    this.startedAt = performance.now()
    this.markId = this.editor.markHistoryStoppingPoint("drag handle")
    setCursor(this.editor, "grabbing")
    this.update()
  }

  override onPointerMove(): void {
    this.update()
  }
  override onKeyDown(): void {
    this.update()
  }
  override onKeyUp(): void {
    this.update()
  }
  override onPointerUp(): void {
    this.parent!.transition("idle")
  }
  override onComplete(): void {
    this.parent!.transition("idle")
  }
  override onCancel(): void {
    this.editor.bailToMark(this.markId)
    this.parent!.transition("idle")
  }

  private update(): void {
    const editor = this.editor
    const current = editor.getShape(this.shape.id)
    if (!current) return
    const local = editor.getPointInShapeSpace(current, editor.inputs.currentPagePoint)
    const handle: ShapeHandle = { ...this.handle, x: local.x, y: local.y }
    const isPrecise = editor.inputs.altKey || performance.now() - this.startedAt > 1200
    const change = editor.getShapeUtil(current).onHandleDrag?.(current, { handle, isPrecise, initial: this.shape })
    if (change) editor.updateShape({ id: current.id, type: current.type, ...change })
  }
}

/** Selection, brush select, drag-to-move, resize, rotate, and shape handle dragging. */
export class SelectTool extends StateNode {
  static override id = "select"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [
    Idle,
    PointingCanvas,
    Brushing,
    PointingShape,
    PointingSelection,
    PointingResizeHandle,
    PointingRotateHandle,
    PointingHandle,
    Translating,
    Resizing,
    Rotating,
    DraggingHandle,
  ]
}
