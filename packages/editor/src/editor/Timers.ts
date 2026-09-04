/**
 * Per-editor timers.
 *
 * Every `setTimeout`, `setInterval` and `requestAnimationFrame` scheduled
 * through this manager is remembered and cancelled when the editor is disposed.
 * Work scheduled by a tool, a side effect or a host integration therefore
 * cannot outlive the editor it belongs to and fire against a torn-down store —
 * the usual source of "cannot read properties of undefined" after unmount.
 *
 * Handles are this manager's own; they are only meaningful to its `clear*`
 * methods, never to the global ones.
 */
export class Timers {
  /** Cancellers keyed by the handle handed to the caller. */
  private readonly pending = new Map<number, () => void>()
  private nextHandle = 1
  private disposed = false

  /**
   * @param getWindow - The realm to schedule in; see `getOwnerWindow`. When it
   * yields nothing (node, SSR) the globals are used, and animation frames fall
   * back to a ~60fps timeout.
   */
  constructor(private readonly getWindow: () => Window | undefined = () => undefined) {}

  private get scope(): {
    setTimeout: (fn: () => void, ms: number) => unknown
    clearTimeout: (id: never) => void
    setInterval: (fn: () => void, ms: number) => unknown
    clearInterval: (id: never) => void
    requestAnimationFrame?: (fn: (time: number) => void) => number
    cancelAnimationFrame?: (id: number) => void
  } {
    return (this.getWindow() ?? globalThis) as never
  }

  /** Claim a handle and register how to cancel it. */
  private track(cancel: () => void): number {
    const handle = this.nextHandle++
    this.pending.set(handle, cancel)
    return handle
  }

  /** Run `fn` after `ms`. The handle is released once it fires. */
  setTimeout(fn: () => void, ms = 0): number {
    if (this.disposed) return 0
    const scope = this.scope
    let handle = 0
    const id = scope.setTimeout(() => {
      this.pending.delete(handle)
      fn()
    }, ms)
    handle = this.track(() => scope.clearTimeout(id as never))
    return handle
  }

  /** Run `fn` every `ms` until cancelled or the editor is disposed. */
  setInterval(fn: () => void, ms: number): number {
    if (this.disposed) return 0
    const scope = this.scope
    const id = scope.setInterval(fn, ms)
    return this.track(() => scope.clearInterval(id as never))
  }

  /**
   * Run `fn` before the next paint of the editor's own window. Where there is
   * no `requestAnimationFrame` (node) a 16ms timeout stands in, so scheduling
   * code does not have to branch on the environment.
   */
  requestAnimationFrame(fn: (time: number) => void): number {
    if (this.disposed) return 0
    const scope = this.scope
    let handle = 0
    const raf = scope.requestAnimationFrame
    if (raf && scope.cancelAnimationFrame) {
      const cancel = scope.cancelAnimationFrame.bind(scope)
      const id = raf.call(scope, (time) => {
        this.pending.delete(handle)
        fn(time)
      })
      handle = this.track(() => cancel(id))
      return handle
    }
    const id = scope.setTimeout(() => {
      this.pending.delete(handle)
      fn(now())
    }, 16)
    handle = this.track(() => scope.clearTimeout(id as never))
    return handle
  }

  /** Cancel a pending timeout. Unknown handles are ignored. */
  clearTimeout(handle: number | undefined): void {
    this.cancel(handle)
  }

  /** Cancel a repeating interval. Unknown handles are ignored. */
  clearInterval(handle: number | undefined): void {
    this.cancel(handle)
  }

  /** Cancel a pending animation frame. Unknown handles are ignored. */
  cancelAnimationFrame(handle: number | undefined): void {
    this.cancel(handle)
  }

  private cancel(handle: number | undefined): void {
    if (handle === undefined) return
    const stop = this.pending.get(handle)
    if (!stop) return
    this.pending.delete(handle)
    stop()
  }

  /** How much work is still scheduled. Useful in tests and leak checks. */
  getPendingCount(): number {
    return this.pending.size
  }

  /** Cancel everything. Further scheduling is a no-op. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const stops = [...this.pending.values()]
    this.pending.clear()
    for (const stop of stops) stop()
  }
}

/** `performance.now()` where available, wall clock otherwise. */
function now(): number {
  return typeof globalThis.performance === "undefined" ? Date.now() : globalThis.performance.now()
}
