/**
 * Timers that can be cancelled in bulk by whoever created them.
 *
 * Every `setTimeout` a long-lived canvas starts is a chance to run a callback
 * against an editor that has since been disposed, which shows up as an
 * unexplained error long after the real mistake. Timers are therefore tagged
 * with a *context* — an editor id, a tool, a test — and disposing that context
 * cancels everything it started.
 *
 * `Timers` is the per-editor form of the same idea; this is the process-wide
 * registry that code without an editor to hand can use.
 */

type Handle = { kind: "timeout" | "interval" | "raf"; id: number }

const byContext = new Map<string, Set<Handle>>()

/** The context id used when a caller does not name one. */
export const DEFAULT_TIME_CONTEXT = "default"

function track(context: string, handle: Handle): void {
  let set = byContext.get(context)
  if (!set) {
    set = new Set()
    byContext.set(context, set)
  }
  set.add(handle)
}

function untrack(context: string, handle: Handle): void {
  byContext.get(context)?.delete(handle)
}

function cancel(handle: Handle): void {
  switch (handle.kind) {
    case "timeout":
      clearTimeout(handle.id)
      break
    case "interval":
      clearInterval(handle.id)
      break
    case "raf":
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle.id)
      break
  }
}

/** The timer API, bound to one context. */
export interface TLTimeContext {
  setTimeout(fn: () => void, ms: number): number
  setInterval(fn: () => void, ms: number): number
  requestAnimationFrame(fn: (time: number) => void): number
  /** Cancel everything started through this context. */
  dispose(): void
}

/** The process-wide timer registry. */
export interface TLTime {
  /** Milliseconds since the page loaded, or since the epoch where there is no `performance`. */
  now(): number
  setTimeout(fn: () => void, ms: number, context?: string): number
  setInterval(fn: () => void, ms: number, context?: string): number
  requestAnimationFrame(fn: (time: number) => void, context?: string): number
  /** Cancel every timer started under `context`. */
  dispose(context?: string): void
  /** Cancel every timer under every context. */
  disposeAll(): void
  /** A handle that tags everything it starts with `context`. */
  forContext(context: string): TLTimeContext
}

/**
 * The registry itself.
 *
 * Deliberately a value rather than a class: there is one clock per process, and
 * a second instance would defeat the point of being able to cancel everything.
 */
export const tltime: TLTime = {
  now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now()
  },

  setTimeout(fn: () => void, ms: number, context: string = DEFAULT_TIME_CONTEXT): number {
    const handle: Handle = { kind: "timeout", id: 0 }
    handle.id = setTimeout(() => {
      untrack(context, handle)
      fn()
    }, ms) as unknown as number
    track(context, handle)
    return handle.id
  },

  setInterval(fn: () => void, ms: number, context: string = DEFAULT_TIME_CONTEXT): number {
    const handle: Handle = { kind: "interval", id: setInterval(fn, ms) as unknown as number }
    track(context, handle)
    return handle.id
  },

  requestAnimationFrame(fn: (time: number) => void, context: string = DEFAULT_TIME_CONTEXT): number {
    if (typeof requestAnimationFrame !== "function") {
      // No rAF (SSR, a worker, jsdom without a shim): fall back to a timeout so
      // the callback still runs rather than being silently dropped.
      return tltime.setTimeout(() => fn(tltime.now()), 16, context)
    }
    const handle: Handle = { kind: "raf", id: 0 }
    handle.id = requestAnimationFrame((time) => {
      untrack(context, handle)
      fn(time)
    })
    track(context, handle)
    return handle.id
  },

  dispose(context: string = DEFAULT_TIME_CONTEXT): void {
    const set = byContext.get(context)
    if (!set) return
    for (const handle of set) cancel(handle)
    byContext.delete(context)
  },

  disposeAll(): void {
    for (const context of [...byContext.keys()]) tltime.dispose(context)
  },

  forContext(context: string): TLTimeContext {
    return {
      setTimeout: (fn, ms) => tltime.setTimeout(fn, ms, context),
      setInterval: (fn, ms) => tltime.setInterval(fn, ms, context),
      requestAnimationFrame: (fn) => tltime.requestAnimationFrame(fn, context),
      dispose: () => tltime.dispose(context),
    }
  },
}
