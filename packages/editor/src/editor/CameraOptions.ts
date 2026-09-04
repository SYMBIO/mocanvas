import type { BoxLike } from "../geometry"

/**
 * Camera configuration, held on the editor and reachable through
 * `Editor.getCameraOptions()` / `Editor.setCameraOptions()`.
 *
 * This is the whole of the camera's policy: whether the user may move it, what
 * the wheel does, how fast panning and zooming feel, which zoom levels the
 * zoom-in/zoom-out steps land on, and — optionally — a region the camera is
 * kept inside of.
 */
export interface TLCameraOptions {
  /** When true the camera ignores user input; programmatic moves need `force`. */
  isLocked: boolean
  /** What an unmodified wheel gesture does. Ctrl/meta always zooms. */
  wheelBehavior: "zoom" | "pan" | "none"
  /** Multiplier applied to pan deltas. */
  panSpeed: number
  /** Multiplier applied to zoom deltas. */
  zoomSpeed: number
  /**
   * The zoom levels `zoomIn()` / `zoomOut()` step between, ascending. They are
   * multiples of `Editor.getBaseZoom()`, so with constraints in play the same
   * steps mean the same thing at any viewport size.
   */
  zoomSteps: number[]
  /** Keeps the camera over a fixed region. Absent means an unbounded canvas. */
  constraints?: TLCameraConstraints
}

/**
 * How a zoom level is derived from the constraint bounds and the viewport.
 *
 * SEMANTICS-ASSUMED: the `fit-min` / `fit-max` names appear in the notes without
 * a definition. Read as "fit the minimum / maximum dimension": fitting the
 * SMALLER dimension means the bounds covers the viewport and may overflow on
 * the other axis, fitting the LARGER one means all of it is visible. That is
 * the cover/contain pair, which is the only reading in which both names do
 * useful and different work.
 *
 * - `default` — no fitting; the level is 1.
 * - `fit-x` / `fit-y` — the bounds' width / height exactly spans the viewport.
 * - `fit-max` — CONTAIN: the larger dimension is the one that just fits, so all
 *   of the bounds is visible.
 * - `fit-min` — COVER: the smaller dimension is the one that just fits, so the
 *   bounds fills the viewport and may overflow on the other axis.
 */
export type TLCameraConstraintsZoom = "default" | "fit-x" | "fit-y" | "fit-min" | "fit-max"

/** A region the camera is kept over, plus how zoom relates to it. */
export interface TLCameraConstraints {
  /** The constrained region, in page space. */
  bounds: BoxLike
  /** Screen-space padding kept between the bounds and the viewport edges. */
  padding?: number | { x: number; y: number }
  /** Where the bounds sit in the viewport when smaller than it; `0.5` centres. */
  origin?: { x: number; y: number }
  /** The zoom to open at. */
  initialZoom?: TLCameraConstraintsZoom
  /** The zoom that counts as `1`; `zoomSteps` are multiples of it. */
  baseZoom?: TLCameraConstraintsZoom
  /** How the camera behaves at the edges of the bounds on each axis. */
  behavior?: "free" | "contain" | "inside" | "outside" | "fixed"
}

/** The camera options an editor starts with. */
export const DEFAULT_CAMERA_OPTIONS: TLCameraOptions = {
  isLocked: false,
  wheelBehavior: "pan",
  panSpeed: 1,
  zoomSpeed: 1,
  zoomSteps: [0.1, 0.25, 0.5, 1, 2, 4, 8],
}

/** Options accepted by every camera move (`setCamera`, `zoomToBounds`, …). */
export interface TLCameraMoveOptions {
  /** Move even when the camera is locked. */
  force?: boolean
  /** Skip any animation and land on the target immediately. */
  immediate?: boolean
  /** Animate to the target instead of jumping there. */
  animation?: {
    /** Milliseconds. `0` (or omitted) is a jump. */
    duration?: number
    /** Maps linear progress in `0..1` onto eased progress. */
    easing?: (t: number) => number
  }
}

/** The default animation curve: slow at both ends, quick through the middle. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Split `padding` into its two axes. */
function paddingOf(constraints: TLCameraConstraints): { x: number; y: number } {
  const padding = constraints.padding ?? 0
  return typeof padding === "number" ? { x: padding, y: padding } : padding
}

/**
 * The zoom level that counts as `1` for these constraints in a viewport of this
 * size. Without constraints — the ordinary infinite canvas — that is simply 1.
 */
export function getBaseZoomForCameraOptions(
  options: TLCameraOptions,
  viewport: { w: number; h: number },
): number {
  const constraints = options.constraints
  if (!constraints) return 1
  const fit = constraints.baseZoom ?? "default"
  if (fit === "default") return 1

  const padding = paddingOf(constraints)
  const usableW = Math.max(1, viewport.w - padding.x * 2)
  const usableH = Math.max(1, viewport.h - padding.y * 2)
  const fitX = constraints.bounds.w > 0 ? usableW / constraints.bounds.w : 1
  const fitY = constraints.bounds.h > 0 ? usableH / constraints.bounds.h : 1

  switch (fit) {
    case "fit-x":
      return fitX
    case "fit-y":
      return fitY
    case "fit-min":
      return Math.max(fitX, fitY)
    case "fit-max":
      return Math.min(fitX, fitY)
    default:
      return 1
  }
}
