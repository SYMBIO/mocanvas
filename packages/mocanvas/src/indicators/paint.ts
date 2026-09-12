/**
 * The small amount of canvas arithmetic every overlay painter repeats.
 *
 * Two rules are stated here once so no painter has to restate them:
 *
 * - **Hairlines.** Overlay chrome is measured in CSS pixels, not page units. A
 *   1.5px selection stroke has to stay 1.5px at 10 % zoom and at 800 %, which
 *   means dividing by the zoom *if and only if* the camera transform is in
 *   effect. {@link hairline} is that division, named so the intent survives.
 * - **Which space.** {@link withCamera} runs a callback with the page→screen
 *   transform installed and restores the context afterwards; painters that work
 *   in screen pixels (a handle, a cursor) simply do not call it.
 *
 * Nothing here reads a colour. Colours come from the theme, through
 * `getOverlayDisplayValues`.
 */
import type { CameraLike } from "./types"

/**
 * Run `draw` with the camera installed, so everything inside is in **page**
 * coordinates. Restores the context afterwards, even if `draw` throws.
 */
export function withCamera(
  ctx: CanvasRenderingContext2D,
  camera: CameraLike,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  ctx.save()
  try {
    ctx.transform(camera.z, 0, 0, camera.z, camera.x * camera.z, camera.y * camera.z)
    draw(ctx)
  } finally {
    ctx.restore()
  }
}

/**
 * A width given in CSS pixels, expressed in the page units the camera
 * transform is about to scale. Use inside {@link withCamera}; outside it the
 * CSS pixel value is already correct and this must not be applied.
 */
export function hairline(cssPixels: number, zoom: number): number {
  return cssPixels / (zoom || 1)
}

/** Save the paint state, run `draw`, restore. The narrow-waisted `ctx.save()`. */
export function isolate(ctx: CanvasRenderingContext2D, draw: (ctx: CanvasRenderingContext2D) => void): void {
  ctx.save()
  try {
    draw(ctx)
  } finally {
    ctx.restore()
  }
}

/**
 * Trace a rectangle with rounded corners.
 *
 * `ctx.roundRect` is not in jsdom and was late to Safari, so the path is built
 * by hand — an overlay that silently stops drawing on one browser is worse than
 * four arcs.
 */
export function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2))
  ctx.beginPath()
  if (r === 0) {
    ctx.rect(x, y, w, h)
    return
  }
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/** Trace a polyline. A single point traces nothing, which is what we want. */
export function tracePolyline(ctx: CanvasRenderingContext2D, points: readonly { x: number; y: number }[]): void {
  ctx.beginPath()
  const first = points[0]
  if (!first || points.length < 2) return
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    ctx.lineTo(p.x, p.y)
  }
}

/**
 * Trace a scribble as a *tapered* ribbon rather than a stroked line.
 *
 * A laser trail whose tail thins out cannot be drawn by stroking a polyline —
 * a stroke has one width for its whole length. So the outline is walked: down
 * one side offset by the half-width at each point, back along the other. The
 * half-width is scaled by the point's position along the stroke, which is what
 * produces the taper.
 *
 * SEMANTICS-ASSUMED: the taper profile. The docs say a scribble may taper but
 * not how; a linear ramp over the first fifth of the stroke reads as a trail
 * with a point on it at every speed, and degenerates to a constant width when
 * `taper` is false.
 */
export function traceTaperedStroke(
  ctx: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  width: number,
  taper: boolean,
): void {
  ctx.beginPath()
  if (points.length < 2) return
  const half = width / 2
  const n = points.length
  const widthAt = (i: number): number => {
    if (!taper) return half
    // Ramp in over the leading fifth of the stroke, held flat after that.
    const t = Math.min(1, i / Math.max(1, (n - 1) * 0.2))
    return half * t
  }
  const left: { x: number; y: number }[] = []
  const right: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const p = points[i]!
    const prev = points[Math.max(0, i - 1)]!
    const next = points[Math.min(n - 1, i + 1)]!
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    const len = Math.hypot(dx, dy)
    if (len === 0) {
      dx = 1
      dy = 0
    } else {
      dx /= len
      dy /= len
    }
    const w = widthAt(i)
    left.push({ x: p.x - dy * w, y: p.y + dx * w })
    right.push({ x: p.x + dy * w, y: p.y - dx * w })
  }
  ctx.moveTo(left[0]!.x, left[0]!.y)
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i]!.x, left[i]!.y)
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i]!.x, right[i]!.y)
  ctx.closePath()
}

/**
 * An `×` centred on a point, as the snap layer marks an aligned edge.
 *
 * Drawn as a path rather than two `line` calls so a caller can stroke it in one
 * go with the rest of the guide.
 */
export function traceCross(ctx: CanvasRenderingContext2D, x: number, y: number, arm: number): void {
  ctx.moveTo(x - arm, y - arm)
  ctx.lineTo(x + arm, y + arm)
  ctx.moveTo(x - arm, y + arm)
  ctx.lineTo(x + arm, y - arm)
}

/**
 * Draw a short text label on a filled, rounded chip — a collaborator's name,
 * a zoom read-out.
 *
 * Returns the chip's width so a caller can lay several out in a row. Measuring
 * costs a `measureText`, which is why the result is handed back rather than
 * recomputed.
 */
/**
 * `text`, cut to fit `maxWidth` with a trailing ellipsis.
 *
 * A binary search rather than a character-by-character walk: a chat message is
 * measured once per frame per collaborator, and `measureText` is the expensive
 * part. Returns the text unchanged when it already fits or when no cap is set.
 */
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth?: number): string {
  if (maxWidth === undefined || maxWidth <= 0) return text
  if (ctx.measureText(text).width <= maxWidth) return text
  const ellipsis = "\u2026"
  // Not even the ellipsis fits; a chip of pure padding is better than one that
  // spills, and callers still get a sensible width back.
  if (ctx.measureText(ellipsis).width > maxWidth) return ""
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + ellipsis
}

export function drawLabelChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: {
    background: string
    color: string
    font: string
    paddingX: number
    paddingY: number
    radius: number
    /**
     * Widest the whole chip may draw. Text that does not fit is cut and ends
     * with an ellipsis. Omitted means no cap, which is what every caller did
     * before — and is why one long collaborator name could draw a chip across
     * the board it was labelling.
     */
    maxWidth?: number
  },
): number {
  ctx.font = opts.font
  ctx.textBaseline = "top"
  ctx.textAlign = "left"
  text = truncateToWidth(ctx, text, opts.maxWidth === undefined ? undefined : opts.maxWidth - opts.paddingX * 2)
  const metrics = ctx.measureText(text)
  // `fontBoundingBox*` is absent in older engines and in jsdom; fall back to
  // the em size the font string implies rather than drawing a zero-height chip.
  const ascent = metrics.actualBoundingBoxAscent
  const descent = metrics.actualBoundingBoxDescent
  const lineHeight = Number.isFinite(ascent) && Number.isFinite(descent) && ascent + descent > 0 ? ascent + descent : 12
  const w = metrics.width + opts.paddingX * 2
  const h = lineHeight + opts.paddingY * 2
  ctx.fillStyle = opts.background
  traceRoundedRect(ctx, x, y, w, h, opts.radius)
  ctx.fill()
  ctx.fillStyle = opts.color
  ctx.fillText(text, x + opts.paddingX, y + opts.paddingY)
  return w
}
