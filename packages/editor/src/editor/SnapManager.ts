import { atom, type Atom } from "@mocanvas/state"
import type { Editor } from "./Editor"
import { Box, Vec, type BoxLike } from "../geometry"
import type { ShapeId } from "../records/base"

export interface SnapLine {
  id: string
  /** Page-space points along the line (at least two). */
  points: Vec[]
}

export interface SnapResult {
  /** Adjustment to add to the proposed delta/position. */
  nudge: Vec
  lines: SnapLine[]
}

interface SnapPoints {
  xs: { value: number; y: number }[]
  ys: { value: number; x: number }[]
}

/**
 * Edge and center snapping against nearby shapes. Candidate shapes are taken
 * from the engine's spatial index (viewport query), so cost does not grow with
 * page size.
 */
export class SnapManager {
  private readonly _lines: Atom<SnapLine[]>
  /** Snap distance in screen pixels. */
  threshold = 8

  constructor(private readonly editor: Editor) {
    this._lines = atom<SnapLine[]>("snap.lines", [])
  }

  getLines(): SnapLine[] {
    return this._lines.get()
  }

  clearLines(): void {
    if (this._lines.get().length) this._lines.set([])
  }

  /** Bounds of shapes near the viewport that are not being moved. */
  private getSnapTargets(exclude: ReadonlySet<ShapeId>): Box[] {
    const editor = this.editor
    const vp = editor.getViewportPageBounds()
    const pad = Math.max(vp.w, vp.h)
    const shapes = editor.getShapesIntersectingBounds(Box.Expand(vp, pad))
    const out: Box[] = []
    for (const s of shapes) {
      if (exclude.has(s.id)) continue
      if (s.parentId !== editor.getCurrentPageId()) continue
      const b = editor.getShapePageBounds(s)
      if (b) out.push(b)
    }
    return out
  }

  private static pointsOf(b: BoxLike): SnapPoints {
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    return {
      xs: [
        { value: b.x, y: cy },
        { value: cx, y: cy },
        { value: b.x + b.w, y: cy },
      ],
      ys: [
        { value: b.y, x: cx },
        { value: cy, x: cx },
        { value: b.y + b.h, x: cx },
      ],
    }
  }

  /**
   * Snap a moving box (already offset by the proposed delta) to nearby shapes.
   * Returns the extra nudge to apply and the guide lines to show.
   */
  snapTranslate(moving: BoxLike, exclude: ReadonlySet<ShapeId>, opts: { lockX?: boolean; lockY?: boolean } = {}): SnapResult {
    const editor = this.editor
    const th = this.threshold / editor.getZoomLevel()
    const targets = this.getSnapTargets(exclude)
    const mine = SnapManager.pointsOf(moving)
    let bestX: { d: number; nudge: number } | null = null
    let bestY: { d: number; nudge: number } | null = null
    for (const t of targets) {
      const tp = SnapManager.pointsOf(t)
      if (!opts.lockX) {
        for (const a of mine.xs) {
          for (const b of tp.xs) {
            const d = Math.abs(a.value - b.value)
            if (d <= th && (!bestX || d < bestX.d)) bestX = { d, nudge: b.value - a.value }
          }
        }
      }
      if (!opts.lockY) {
        for (const a of mine.ys) {
          for (const b of tp.ys) {
            const d = Math.abs(a.value - b.value)
            if (d <= th && (!bestY || d < bestY.d)) bestY = { d, nudge: b.value - a.value }
          }
        }
      }
    }
    const nudge = new Vec(bestX?.nudge ?? 0, bestY?.nudge ?? 0)
    // Build guide lines for every aligned edge/center after nudging.
    const snapped = new Box(moving.x + nudge.x, moving.y + nudge.y, moving.w, moving.h)
    const sp = SnapManager.pointsOf(snapped)
    const lines: SnapLine[] = []
    const eps = 0.01
    for (const t of targets) {
      const tp = SnapManager.pointsOf(t)
      for (const a of sp.xs) {
        for (const b of tp.xs) {
          if (Math.abs(a.value - b.value) < eps) {
            const ys = [snapped.y, snapped.maxY, t.y, t.y + t.h]
            lines.push({ id: `x:${a.value.toFixed(2)}`, points: [new Vec(a.value, Math.min(...ys)), new Vec(a.value, Math.max(...ys))] })
          }
        }
      }
      for (const a of sp.ys) {
        for (const b of tp.ys) {
          if (Math.abs(a.value - b.value) < eps) {
            const xs = [snapped.x, snapped.maxX, t.x, t.x + t.w]
            lines.push({ id: `y:${a.value.toFixed(2)}`, points: [new Vec(Math.min(...xs), a.value), new Vec(Math.max(...xs), a.value)] })
          }
        }
      }
    }
    // Merge lines with the same id (extend extents)
    const merged = new Map<string, SnapLine>()
    for (const l of lines) {
      const prev = merged.get(l.id)
      if (!prev) merged.set(l.id, l)
      else {
        const pts = [...prev.points, ...l.points]
        const isX = l.id.startsWith("x:")
        const vals = pts.map((p) => (isX ? p.y : p.x))
        const min = Math.min(...vals)
        const max = Math.max(...vals)
        prev.points = isX ? [new Vec(pts[0]!.x, min), new Vec(pts[0]!.x, max)] : [new Vec(min, pts[0]!.y), new Vec(max, pts[0]!.y)]
      }
    }
    const result = [...merged.values()]
    this._lines.set(result)
    return { nudge, lines: result }
  }
}
