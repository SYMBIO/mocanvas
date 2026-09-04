/**
 * What the editor reports about its own work.
 *
 * The names come in `*-start` / `*-end` pairs so a listener can time a span
 * without knowing what produced it; `frame` is a single point event carrying
 * the numbers of the frame that was just drawn.
 */
export interface PerformanceEvents {
  /** A user interaction (a drag, a resize, a tool gesture) began / finished. */
  "interaction-start": { name: string }
  "interaction-end": { name: string }
  /** A camera move began / finished, animated or not. */
  "camera-start": { animated: boolean }
  "camera-end": { animated: boolean }
  /** A batch of shape records was created, changed or deleted. */
  "shape-operation": { operation: "create" | "update" | "delete"; count: number }
  /** One rendered frame. */
  frame: { drawn: number; culled: number; ms: number }
  /** A history step was applied. */
  undo: { steps: number }
  redo: { steps: number }
}

export type PerformanceEventName = keyof PerformanceEvents

type Listener<K extends PerformanceEventName> = (info: PerformanceEvents[K]) => void

/**
 * A small, self-contained sink for the editor's own timing events.
 *
 * It is deliberately not the editor's main `EventEmitter`: performance
 * listeners are diagnostics, they come and go with a profiler or a dev overlay,
 * and nothing in the editor should behave differently because one is attached.
 * A listener that throws is contained here rather than breaking the frame that
 * emitted the event.
 *
 * Reach it as `editor.performance`; it is disposed with the editor.
 */
export class PerformanceManager {
  private readonly listeners = new Map<PerformanceEventName, Set<Listener<never>>>()
  private disposed = false

  /** Listen to an event. Returns a function that removes the listener. */
  on<K extends PerformanceEventName>(name: K, listener: Listener<K>): () => void {
    if (this.disposed) return () => {}
    let set = this.listeners.get(name)
    if (!set) {
      set = new Set()
      this.listeners.set(name, set)
    }
    set.add(listener as Listener<never>)
    return () => {
      set.delete(listener as Listener<never>)
    }
  }

  /** Listen to the next occurrence only. Returns a function that cancels it. */
  once<K extends PerformanceEventName>(name: K, listener: Listener<K>): () => void {
    const off = this.on(name, (info) => {
      off()
      listener(info)
    })
    return off
  }

  /** Whether anything is listening. Callers skip building `info` when not. */
  hasListeners(name: PerformanceEventName): boolean {
    const set = this.listeners.get(name)
    return set !== undefined && set.size > 0
  }

  /** Report an event. Never throws: diagnostics must not break the editor. */
  emit<K extends PerformanceEventName>(name: K, info: PerformanceEvents[K]): void {
    const set = this.listeners.get(name)
    if (!set || set.size === 0) return
    for (const listener of [...set]) {
      try {
        ;(listener as Listener<K>)(info)
      } catch {
        // A broken profiler is not a reason to drop a frame.
      }
    }
  }

  /** Drop every listener. Further `on()` calls are no-ops. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }
}
