/**
 * Shape operations that are more than one store write.
 *
 * Animation, opacity, packing, fitting to bounds and moving between pages all
 * have the same shape: work out the whole change first, then apply it in one
 * `run()` so it is one undo step and one render. Doing any of them shape by
 * shape produces a history a person cannot walk back through.
 */
import { Box, Vec, type BoxLike, type VecLike } from "../geometry"
import { isPageId, type PageId, type ShapeId, type ShapePartial, type UnknownShape } from "../records/base"
import type { ShapeHandle } from "./events"
import type { StyleProp } from "../records/styleProp"
import type { Editor } from "./Editor"
import { getShapeAndDescendantIds, resolveShape, type ShapeRef } from "./ancestry"

// ---- animation ------------------------------------------------------------

/** How an animated shape change is paced. */
export interface TLAnimationOptions {
  /** Milliseconds. `0` (the default) applies the change immediately. */
  duration?: number
  /** Progress curve; defaults to the editor's own ease-in-out. */
  easing?: (t: number) => number
}

/** Numeric fields of a shape that are worth interpolating. */
const ANIMATED_KEYS = ["x", "y", "rotation", "opacity"] as const

/**
 * Move a shape to a new position/rotation/opacity over time.
 *
 * Every frame is written with `history: "ignore"`, and one stopping point is
 * marked before the animation starts — so an animation is a single undo step
 * that lands on the *destination*, not a hundred steps ending wherever the
 * user happened to press undo.
 *
 * Only the numeric top-level fields are interpolated; anything else in the
 * partial (props, meta, parent) is applied once, at the start, because there is
 * no general way to interpolate an arbitrary prop.
 */
export function animateShape(
  editor: Editor,
  partial: ShapePartial<UnknownShape> | null | undefined,
  opts: TLAnimationOptions = {},
): void {
  if (partial) animateShapes(editor, [partial], opts)
}

/**
 * {@link animateShape} for many shapes on one clock, so a group of shapes
 * arrives together rather than drifting apart over the animation.
 */
export function animateShapes(
  editor: Editor,
  partials: readonly (ShapePartial<UnknownShape> | null | undefined)[],
  opts: TLAnimationOptions = {},
): void {
  const entries: { partial: ShapePartial<UnknownShape>; from: Record<string, number>; to: Record<string, number> }[] = []
  const immediate: ShapePartial<UnknownShape>[] = []

  for (const partial of partials) {
    if (!partial) continue
    const shape = editor.getShape<UnknownShape>(partial.id)
    if (!shape) continue
    const from: Record<string, number> = {}
    const to: Record<string, number> = {}
    const rest: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(partial)) {
      if ((ANIMATED_KEYS as readonly string[]).includes(key) && typeof value === "number") {
        from[key] = shape[key as (typeof ANIMATED_KEYS)[number]]
        to[key] = value
      } else {
        rest[key] = value
      }
    }
    if (Object.keys(to).length > 0) entries.push({ partial, from, to })
    if (Object.keys(rest).length > 2) immediate.push(rest as ShapePartial<UnknownShape>)
  }
  if (entries.length === 0 && immediate.length === 0) return

  const duration = opts.duration ?? 0
  if (duration <= 0) {
    editor.updateShapes(partials.filter((p): p is ShapePartial<UnknownShape> => !!p))
    return
  }

  editor.markHistoryStoppingPoint("animate shapes")
  if (immediate.length > 0) editor.updateShapes(immediate)
  const easing = opts.easing ?? defaultEasing
  const start = now()

  const step = (): void => {
    if (editor.getIsDisposed()) return
    const t = Math.min(1, (now() - start) / duration)
    const k = easing(t)
    editor.run(
      () => {
        editor.updateShapes(
          entries.map(({ partial, from, to }) => {
            const next: Record<string, unknown> = { id: partial.id, type: partial.type }
            for (const key of Object.keys(to)) next[key] = from[key]! + (to[key]! - from[key]!) * k
            return next as ShapePartial<UnknownShape>
          }),
        )
      },
      { history: "ignore" },
    )
    if (t < 1) editor.timers.requestAnimationFrame(step)
  }
  editor.timers.requestAnimationFrame(step)
}

function defaultEasing(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function now(): number {
  return typeof globalThis.performance === "undefined" ? Date.now() : globalThis.performance.now()
}

// ---- handles, styles, meta ------------------------------------------------

/**
 * A shape's drag handles in its own coordinate space, or `undefined` when its
 * util defines none.
 *
 * Local space, not page space: a handle is drawn and dragged through the
 * shape's transform, and converting here would have to be undone by every
 * caller that wants to write the result back into the shape's props.
 */
export function getShapeHandles(editor: Editor, shape: ShapeRef): ShapeHandle[] | undefined {
  const record = resolveShape(editor, shape)
  if (!record) return undefined
  const util = editor.getShapeUtil<UnknownShape>(record) as { getHandles?(shape: UnknownShape): ShapeHandle[] }
  return util.getHandles?.(record)
}

/**
 * A shape's value for one style prop, or `undefined` when that shape does not
 * carry that style at all.
 *
 * The `IfExists` is the whole point: asking a text shape for its fill must be
 * answerable without throwing, because style panels are built by asking every
 * selected shape about every style.
 */
export function getShapeStyleIfExists<T>(editor: Editor, shape: ShapeRef, style: StyleProp<T>): T | undefined {
  const record = resolveShape(editor, shape)
  if (!record) return undefined
  for (const [key, prop] of editor.getStylePropsForType(record.type)) {
    if (prop !== (style as unknown as StyleProp<unknown>)) continue
    return (record.props as Record<string, unknown>)[key] as T | undefined
  }
  return undefined
}

/**
 * The `meta` every newly created shape starts with.
 *
 * The hook an app uses to stamp provenance onto shapes — who made it, which
 * campaign it belongs to, which template it came from — without having to
 * intercept every creation site. With no `getInitialMetaForShape` configured
 * this is an empty object.
 */
export function getInitialMetaForShape(editor: Editor, shape: UnknownShape): UnknownShape["meta"] {
  return editor.getInitialMetaForShapeHandler?.(shape) ?? {}
}

// ---- opacity --------------------------------------------------------------

/** Opacity shared by the selection: a value, or `"mixed"`, or `undefined`. */
export type TLSharedOpacity = { type: "shared"; value: number } | { type: "mixed" }

/**
 * The opacity of the current selection, as the style panel needs it.
 *
 * `undefined` with nothing selected (the panel falls back to the next-shape
 * value), `mixed` when the selected shapes disagree — the same three-state
 * answer every other style gives, so one control can render all of them.
 */
export function getSharedOpacity(editor: Editor): TLSharedOpacity | undefined {
  const shapes = editor.getSelectedShapes()
  if (shapes.length === 0) return undefined
  const first = shapes[0]!.opacity
  return shapes.every((shape) => shape.opacity === first) ? { type: "shared", value: first } : { type: "mixed" }
}

/** Set the opacity newly created shapes will start with. */
export function setOpacityForNextShapes(editor: Editor, opacity: number): void {
  editor.updateInstanceState({ stylesForNextShape: { ...editor.getInstanceState().stylesForNextShape, opacity: clamp01(opacity) } })
}

/**
 * Set the opacity of the selected shapes.
 *
 * Applied to the selected shapes themselves and not to their descendants: a
 * group's opacity multiplies down through its children when they are drawn, so
 * writing it to both would square it.
 */
export function setOpacityForSelectedShapes(editor: Editor, opacity: number): void {
  const value = clamp01(opacity)
  const partials = editor
    .getSelectedShapes()
    .filter((shape) => !shape.isLocked && shape.opacity !== value)
    .map((shape) => ({ id: shape.id, type: shape.type, opacity: value }))
  if (partials.length === 0) return
  editor.run(() => editor.updateShapes(partials))
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

// ---- layout ---------------------------------------------------------------

/**
 * Pack shapes into a tight block, in place.
 *
 * Shapes are laid out left to right in rows inside a square-ish area centred on
 * where they already are, keeping their reading order, with `gap` between them.
 * Sizes are never changed — packing is about removing whitespace, and a layout
 * that also resized things would be a different operation with a different undo
 * expectation.
 *
 * SEMANTICS-ASSUMED: rows, ordered by the shapes' existing reading order, in a
 * block whose target width is the square root of the total area. Row packing is
 * the only layout that is stable — nudging one shape does not reshuffle the
 * rest — which is what makes repeated packing idempotent.
 */
export function packShapes(editor: Editor, ids: readonly ShapeId[], gap = 16): void {
  const entries: { shape: UnknownShape; bounds: Box }[] = []
  for (const id of ids) {
    const shape = editor.getShape<UnknownShape>(id)
    if (!shape || shape.isLocked) continue
    const bounds = editor.getShapePageBounds(shape)
    if (bounds) entries.push({ shape, bounds })
  }
  if (entries.length < 2) return

  const common = Box.Common(entries.map((e) => e.bounds))
  entries.sort((a, b) => a.bounds.minY - b.bounds.minY || a.bounds.minX - b.bounds.minX)

  const totalArea = entries.reduce((sum, e) => sum + (e.bounds.width + gap) * (e.bounds.height + gap), 0)
  const targetWidth = Math.max(Math.sqrt(totalArea), Math.max(...entries.map((e) => e.bounds.width)))

  const placed: { shape: UnknownShape; bounds: Box; x: number; y: number }[] = []
  let x = 0
  let y = 0
  let rowHeight = 0
  for (const entry of entries) {
    if (x > 0 && x + entry.bounds.width > targetWidth) {
      x = 0
      y += rowHeight + gap
      rowHeight = 0
    }
    placed.push({ ...entry, x, y })
    x += entry.bounds.width + gap
    rowHeight = Math.max(rowHeight, entry.bounds.height)
  }

  const packed = Box.FromPoints(placed.flatMap((p) => [new Vec(p.x, p.y), new Vec(p.x + p.bounds.width, p.y + p.bounds.height)]))
  const offset = new Vec(common.center.x - packed.width / 2, common.center.y - packed.height / 2)

  editor.run(() => {
    for (const entry of placed) {
      const delta = new Vec(offset.x + entry.x - entry.bounds.minX, offset.y + entry.y - entry.bounds.minY)
      if (delta.x !== 0 || delta.y !== 0) editor.nudgeShapes([entry.shape.id], delta)
    }
  })
}

/**
 * Scale and move shapes so their common bounds become `bounds` exactly.
 *
 * The primitive behind "fit this frame's contents" and behind importing a
 * drawing at a known size. The whole set is treated as one rigid group — every
 * shape gets the same scale factor — so relative positions and sizes survive.
 */
export function resizeToBounds(editor: Editor, ids: readonly ShapeId[], bounds: BoxLike): void {
  const shapes = ids.map((id) => editor.getShape<UnknownShape>(id)).filter((s): s is UnknownShape => !!s)
  if (shapes.length === 0) return
  const boxes = shapes.map((s) => editor.getShapePageBounds(s)).filter((b): b is Box => !!b)
  if (boxes.length === 0) return
  const current = Box.Common(boxes)
  if (current.width === 0 || current.height === 0) return

  const scale: VecLike = { x: bounds.w / current.width, y: bounds.h / current.height }
  editor.run(() => {
    editor.resizeShapes(shapes.map((s) => s.id), scale, { scaleOrigin: { x: current.minX, y: current.minY } })
    const after = Box.Common(
      shapes.map((s) => editor.getShapePageBounds(s.id)).filter((b): b is Box => !!b),
    )
    const delta = new Vec(bounds.x - after.minX, bounds.y - after.minY)
    if (delta.x !== 0 || delta.y !== 0) editor.nudgeShapes(shapes.map((s) => s.id), delta)
  })
}

/**
 * Move shapes — and everything under them — to another page.
 *
 * Descendants come along whether or not they were named, because a shape
 * without its children on the same page is not a shape any more. Bindings
 * between moved shapes survive; bindings to shapes left behind are dropped,
 * since a binding cannot span two pages.
 *
 * The moved shapes end up selected on the destination page, which is what makes
 * "move to page" followed by a nudge do what it looks like it should.
 */
export function moveShapesToPage(editor: Editor, ids: readonly ShapeId[], pageId: PageId): void {
  if (ids.length === 0) return
  if (!editor.getPage(pageId)) return
  const fromPage = editor.getCurrentPageId()
  if (pageId === fromPage) return

  const moving = getShapeAndDescendantIds(editor, ids)
  if (moving.size === 0) return

  // Only the top of each moved subtree is reparented; the rest keep the parent
  // they already have, which is inside the subtree and therefore coming too.
  const roots = [...moving].filter((id) => {
    const shape = editor.getShape<UnknownShape>(id)
    return !!shape && (isPageId(shape.parentId) || !moving.has(shape.parentId))
  })

  editor.run(() => {
    for (const id of moving) {
      for (const binding of editor.getBindingsInvolvingShape(id)) {
        if (!moving.has(binding.fromId) || !moving.has(binding.toId)) editor.deleteBinding(binding.id)
      }
    }
    editor.reparentShapes(roots, pageId)
    editor.setCurrentPage(pageId)
    editor.setSelectedShapes(roots)
  })
}
