/**
 * The vocabulary of the editor's own timing events, plus the adapter that
 * mirrors them into the browser's Performance timeline.
 *
 * {@link PerformanceManager} is the sink; this module is the documented shape
 * of what goes into it, and the bridge to devtools. Nothing in the editor
 * behaves differently because something is listening — these are diagnostics,
 * and a profiler that is not attached costs nothing.
 */
import type { PerformanceEvents, PerformanceManager } from "./PerformanceManager"

/**
 * A user interaction began: a drag, a resize, a tool gesture.
 *
 * `time` is on the same clock as {@link ../editor/tltime.tltime.now} — a
 * monotonic millisecond reading, not a wall clock — because the only thing
 * anyone does with it is subtract two of them.
 */
export interface TLInteractionStartPerfEvent {
  /** What began, e.g. `"translating"`, `"resizing"`. Opaque to the editor. */
  name: string
  time?: number
}

/** The matching end of a {@link TLInteractionStartPerfEvent}. */
export interface TLInteractionEndPerfEvent {
  name: string
  time?: number
  /** Milliseconds from the matching start, when the emitter knows it. */
  duration?: number | undefined
}

/** A camera move began, animated or not. */
export interface TLCameraStartPerfEvent {
  /** Whether the move is being tweened rather than applied in one step. */
  animated: boolean
  time?: number
}

/** The matching end of a {@link TLCameraStartPerfEvent}. */
export interface TLCameraEndPerfEvent {
  animated: boolean
  time?: number
  duration?: number | undefined
}

/** A batch of shape records was created, changed or deleted. */
export interface TLShapeOperationPerfEvent {
  operation: "create" | "update" | "delete"
  /** How many records the batch touched. */
  count: number
  time?: number
  duration?: number | undefined
}

/** One rendered frame. */
export interface TLFramePerfEvent {
  /** Shapes actually painted. */
  drawn: number
  /** Shapes skipped because they were off screen or hidden. */
  culled: number
  /** How long the frame took, in milliseconds. */
  ms: number
  time?: number
}

/** A history step was applied. The same shape for both directions. */
export interface TLUndoRedoPerfEvent {
  /** How many marks the step covered. */
  steps: number
  time?: number
}

/**
 * Every timing event by name.
 *
 * The keys are the same ones {@link PerformanceManager} emits, so a listener
 * typed against this map can be attached to it directly.
 */
export interface TLPerfEventMap {
  "interaction-start": TLInteractionStartPerfEvent
  "interaction-end": TLInteractionEndPerfEvent
  "camera-start": TLCameraStartPerfEvent
  "camera-end": TLCameraEndPerfEvent
  "shape-operation": TLShapeOperationPerfEvent
  frame: TLFramePerfEvent
  undo: TLUndoRedoPerfEvent
  redo: TLUndoRedoPerfEvent
}

// The two names for one set of events must not drift. If a payload is added to
// `PerformanceEvents` without a documented interface here, this stops compiling.
type _PerfMapCoversEmitter = PerformanceEvents extends TLPerfEventMap ? true : never
const _perfMapCoversEmitter: _PerfMapCoversEmitter = true
void _perfMapCoversEmitter

/**
 * Summary statistics over a window of frame times, in milliseconds.
 *
 * A mean alone hides the thing anyone cares about: a canvas that averages 8ms
 * but spikes to 90 feels broken, and one that sits at 14ms does not. `p95` and
 * `max` are what a regression shows up in first.
 */
export interface TLPerfFrameTimeStats {
  /** How many frames the window covers. */
  count: number
  min: number
  max: number
  mean: number
  median: number
  p95: number
}

/**
 * One script attributed to a long animation frame, as the browser reports it.
 *
 * Mirrors the `PerformanceScriptTiming` entries the Long Animation Frames API
 * produces; every field is optional because browser support for the API is
 * partial and uneven, and an adapter must not throw on a browser that reports
 * half of it.
 */
export interface TLPerfLongAnimationFrameScript {
  name?: string | undefined
  entryType?: string | undefined
  startTime?: number | undefined
  duration?: number | undefined
  /** What ran the script: an event listener, a timer, a promise callback. */
  invoker?: string | undefined
  invokerType?: string | undefined
  sourceURL?: string | undefined
  sourceFunctionName?: string | undefined
  sourceCharPosition?: number | undefined
  /** Time spent in a synchronous pause — an `alert`, a sync XHR. */
  pauseDuration?: number | undefined
  /** Time the script forced style or layout to be recomputed. */
  forcedStyleAndLayoutDuration?: number | undefined
}

/**
 * A frame the browser considered long enough to be worth reporting.
 *
 * The useful field is `blockingDuration`: the part of the frame during which
 * the main thread could not respond to input, which is what a person actually
 * perceives as a stall.
 */
export interface TLPerfLongAnimationFrame {
  startTime?: number | undefined
  duration?: number | undefined
  /** When rendering work began within the frame. */
  renderStart?: number | undefined
  /** When style and layout began within the frame. */
  styleAndLayoutStart?: number | undefined
  /** How long the main thread was unresponsive. */
  blockingDuration?: number | undefined
  /** Scripts the browser could attribute the time to. */
  scripts: readonly TLPerfLongAnimationFrameScript[]
}

/** How many frame samples {@link PerformanceApiAdapter} keeps. */
const FRAME_WINDOW = 120

/** Options for {@link PerformanceApiAdapter}. */
export interface PerformanceApiAdapterOptions {
  /**
   * Prefix for the marks and measures written to the browser timeline, so the
   * entries from two editors on one page can be told apart.
   */
  prefix?: string
  /** Called for each long animation frame the browser reports. */
  onLongAnimationFrame?(frame: TLPerfLongAnimationFrame): void
}

/**
 * Mirrors the editor's timing events into the browser's own Performance
 * timeline, and collects long-animation-frame reports.
 *
 * The point is that a person profiling a canvas should see the editor's spans
 * — "translating", "camera", "frame" — in the same devtools flame chart as
 * everything else, instead of having to correlate two timelines by eye. It
 * writes `performance.mark` / `performance.measure` entries and nothing else;
 * it never reports anywhere, and it holds no reference to the document.
 *
 * Construct one against `editor.performance` and call {@link dispose} when the
 * editor goes away.
 */
export class PerformanceApiAdapter {
  private readonly offs: (() => void)[] = []
  private readonly openMarks = new Map<string, string>()
  private readonly frameTimes: number[] = []
  private observer: { disconnect(): void } | null = null
  private readonly prefix: string
  private disposed = false

  constructor(performance_: PerformanceManager, options: PerformanceApiAdapterOptions = {}) {
    this.prefix = options.prefix ?? "mocanvas"

    this.offs.push(
      performance_.on("interaction-start", ({ name }) => this.begin(`interaction:${name}`)),
      performance_.on("interaction-end", ({ name }) => this.end(`interaction:${name}`)),
      performance_.on("camera-start", ({ animated }) => this.begin(`camera:${animated ? "animated" : "instant"}`)),
      performance_.on("camera-end", ({ animated }) => this.end(`camera:${animated ? "animated" : "instant"}`)),
      performance_.on("shape-operation", ({ operation, count }) => this.instant(`shape-${operation}`, count)),
      performance_.on("frame", ({ ms }) => this.recordFrame(ms)),
      performance_.on("undo", ({ steps }) => this.instant("undo", steps)),
      performance_.on("redo", ({ steps }) => this.instant("redo", steps)),
    )

    this.observeLongAnimationFrames(options.onLongAnimationFrame)
  }

  /** Frame-time statistics over the last {@link FRAME_WINDOW} frames, or `null` before any. */
  getFrameTimeStats(): TLPerfFrameTimeStats | null {
    if (this.frameTimes.length === 0) return null
    const sorted = [...this.frameTimes].sort((a, b) => a - b)
    const total = sorted.reduce((sum, ms) => sum + ms, 0)
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
    return {
      count: sorted.length,
      min: at(0),
      max: at(1),
      mean: total / sorted.length,
      median: at(0.5),
      p95: at(0.95),
    }
  }

  /** Stop listening, stop observing, and forget the samples. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const off of this.offs) off()
    this.offs.length = 0
    this.observer?.disconnect()
    this.observer = null
    this.openMarks.clear()
    this.frameTimes.length = 0
  }

  private recordFrame(ms: number): void {
    this.frameTimes.push(ms)
    if (this.frameTimes.length > FRAME_WINDOW) this.frameTimes.shift()
  }

  private begin(name: string): void {
    const api = globalThis.performance
    if (typeof api?.mark !== "function") return
    const mark = `${this.prefix}:${name}:start`
    // A second start without an end replaces the first: a gesture interrupted
    // by another one has no meaningful span, and keeping the stale mark would
    // measure from the wrong place.
    this.openMarks.set(name, mark)
    api.mark(mark)
  }

  private end(name: string): void {
    const api = globalThis.performance
    const mark = this.openMarks.get(name)
    if (!mark || typeof api?.measure !== "function") return
    this.openMarks.delete(name)
    try {
      api.measure(`${this.prefix}:${name}`, mark)
    } catch {
      // `measure` throws when the start mark has been cleared out from under
      // it (a devtools "clear timeline" mid-gesture). Not worth surfacing.
    }
  }

  private instant(name: string, detail: number): void {
    const api = globalThis.performance
    if (typeof api?.mark !== "function") return
    try {
      api.mark(`${this.prefix}:${name}`, { detail })
    } catch {
      // Older engines reject the options bag; the mark is diagnostic either way.
      api.mark(`${this.prefix}:${name}`)
    }
  }

  private observeLongAnimationFrames(onLongAnimationFrame?: (frame: TLPerfLongAnimationFrame) => void): void {
    if (!onLongAnimationFrame) return
    const Observer = (globalThis as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver
    if (!Observer) return
    try {
      const observer = new Observer((list) => {
        for (const entry of list.getEntries()) {
          onLongAnimationFrame(toLongAnimationFrame(entry))
        }
      })
      // `long-animation-frame` is Chromium-only today; an engine that does not
      // know the type throws from `observe`, which is why this is guarded.
      observer.observe({ type: "long-animation-frame", buffered: false } as PerformanceObserverInit)
      this.observer = observer
    } catch {
      this.observer = null
    }
  }
}

/** Read a browser performance entry into the documented shape, field by field. */
function toLongAnimationFrame(entry: PerformanceEntry): TLPerfLongAnimationFrame {
  const raw = entry as unknown as Record<string, unknown>
  const scripts = Array.isArray(raw.scripts) ? (raw.scripts as Record<string, unknown>[]) : []
  return {
    startTime: entry.startTime,
    duration: entry.duration,
    renderStart: numberOrUndefined(raw.renderStart),
    styleAndLayoutStart: numberOrUndefined(raw.styleAndLayoutStart),
    blockingDuration: numberOrUndefined(raw.blockingDuration),
    scripts: scripts.map((script) => ({
      name: stringOrUndefined(script.name),
      entryType: stringOrUndefined(script.entryType),
      startTime: numberOrUndefined(script.startTime),
      duration: numberOrUndefined(script.duration),
      invoker: stringOrUndefined(script.invoker),
      invokerType: stringOrUndefined(script.invokerType),
      sourceURL: stringOrUndefined(script.sourceURL),
      sourceFunctionName: stringOrUndefined(script.sourceFunctionName),
      sourceCharPosition: numberOrUndefined(script.sourceCharPosition),
      pauseDuration: numberOrUndefined(script.pauseDuration),
      forcedStyleAndLayoutDuration: numberOrUndefined(script.forcedStyleAndLayoutDuration),
    })),
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
