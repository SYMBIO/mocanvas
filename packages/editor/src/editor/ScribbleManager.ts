import type { Scribble } from "../records/base"
import { EditorManager } from "./EditorManager"
import type { Editor } from "./Editor"

/**
 * One live scribble, plus the bookkeeping that fades it out.
 *
 * The `scribble` is what ends up in the `instance` record and on screen; the
 * rest is the manager's own state — how long the tail has left, and the last
 * point taken, so a stationary pointer does not stack duplicate points.
 */
export interface ScribbleItem {
  id: string
  scribble: Scribble
  /** Milliseconds of `delay` still to burn before points start being shed. */
  delayRemaining: number
  /** The last point appended, used to drop repeats. */
  prev: { x: number; y: number; z: number } | null
  /** The point most recently offered, appended on the next tick. */
  next: { x: number; y: number; z: number } | null
}

/** How a scribble looks and how it fades. Every field has a default. */
export interface ScribbleSessionOptions {
  /** Stroke colour, as a theme colour name or CSS colour. */
  color?: string
  /** Stroke width in page units. */
  size?: number
  /** 0..1. */
  opacity?: number
  /** Milliseconds before the tail starts to disappear. */
  delay?: number
  /** How many points are shed per tick once the tail is shrinking. */
  shrink?: number
  /** Taper the tail to a point rather than cutting it square. */
  taper?: boolean
}

const DEFAULTS: Required<ScribbleSessionOptions> = {
  color: "accent",
  size: 20,
  opacity: 0.8,
  delay: 0,
  shrink: 0.1,
  taper: true,
}

/**
 * The trails a laser pointer, an eraser or a select brush leaves behind.
 *
 * A scribble is not a shape: it is not in the document, it is not undoable, and
 * it disappears on its own. It lives on the `instance` record so that anything
 * reading the store — the renderer, a minimap, a presence encoder — sees it
 * without a separate channel, and so a collaborator's scribble arrives the same
 * way a local one is made.
 *
 * There are two ways in. The **session** API (`startSession`, `addPointToSession`,
 * `stopSession`) is for a tool driving one continuous gesture: it owns a single
 * scribble and does not have to carry its id around. The **direct** API
 * (`addScribble`, `addPoint`, `stop`) is for anything managing several at once —
 * five collaborators' lasers, for instance.
 *
 * Nothing animates until {@link tick} is called; the editor's frame loop drives
 * it, and a test can drive it by hand.
 */
export class ScribbleManager extends EditorManager {
  private readonly items = new Map<string, ScribbleItem>()
  private sessionId: string | null = null
  private nextId = 0

  constructor(editor: Editor) {
    super(editor)
    this.register(() => this.reset())
  }

  // ---- direct API ---------------------------------------------------------

  /** Start a new scribble and return it. Its `id` addresses it afterwards. */
  addScribble(options: ScribbleSessionOptions = {}, id = `scribble:${this.nextId++}`): ScribbleItem {
    const opts = { ...DEFAULTS, ...options }
    const item: ScribbleItem = {
      id,
      scribble: {
        id,
        points: [],
        size: opts.size,
        color: opts.color,
        opacity: opts.opacity,
        state: "starting",
        delay: opts.delay,
        shrink: opts.shrink,
        taper: opts.taper,
      },
      delayRemaining: opts.delay,
      prev: null,
      next: null,
    }
    this.items.set(id, item)
    this.flush()
    return item
  }

  /**
   * Offer a point to a scribble. It is appended on the next {@link tick}, not
   * now: a pointer move can fire many times per frame, and a scribble that
   * grew on every one of them would be a different shape at 120Hz than at 60.
   */
  addPoint(id: string, x: number, y: number, z = 0.5): ScribbleItem | undefined {
    const item = this.items.get(id)
    if (!item) return undefined
    item.next = { x, y, z }
    return item
  }

  /** Ask a scribble to finish: it stops growing and fades out. */
  stop(id: string): ScribbleItem | undefined {
    const item = this.items.get(id)
    if (!item) return undefined
    item.scribble = { ...item.scribble, state: "stopping" }
    item.delayRemaining = Math.min(item.delayRemaining, 200)
    this.flush()
    return item
  }

  /** Remove a scribble immediately, without fading it. */
  complete(id: string): void {
    if (!this.items.delete(id)) return
    if (this.sessionId === id) this.sessionId = null
    this.flush()
  }

  /** Drop every scribble at once. */
  reset(): void {
    if (this.items.size === 0 && this.sessionId === null) return
    this.items.clear()
    this.sessionId = null
    this.flush()
  }

  // ---- session API --------------------------------------------------------

  /**
   * Begin the one scribble this manager will treat as current. An existing
   * session is stopped first, so a tool that forgot to close one cannot leak it.
   */
  startSession(options: ScribbleSessionOptions = {}): ScribbleItem {
    if (this.sessionId !== null) this.stopSession()
    const item = this.addScribble(options)
    this.sessionId = item.id
    return item
  }

  /** Whether {@link startSession} has run and the session is still open. */
  isSessionActive(): boolean {
    return this.sessionId !== null && this.items.has(this.sessionId)
  }

  /** Add a point to the current session. A no-op with no session. */
  addPointToSession(x: number, y: number, z = 0.5): ScribbleItem | undefined {
    if (this.sessionId === null) return undefined
    return this.addPoint(this.sessionId, x, y, z)
  }

  /**
   * Add a *second* scribble that shares the session's lifetime.
   *
   * A laser drawn with two fingers, or a gesture that leaves both a trail and a
   * highlight, needs more than one stroke to end together. Everything started
   * this way is cleared by {@link clearSession}.
   */
  addScribbleToSession(options: ScribbleSessionOptions = {}): ScribbleItem {
    return this.addScribble(options)
  }

  /** Let the session's scribble fade out, and close the session. */
  stopSession(): void {
    if (this.sessionId === null) return
    this.stop(this.sessionId)
    this.sessionId = null
  }

  /**
   * Keep the session open but restart its stroke — the gesture continues, the
   * trail behind it does not. Used when a drag crosses a boundary that should
   * break the line.
   */
  extendSession(options: ScribbleSessionOptions = {}): ScribbleItem | undefined {
    if (this.sessionId === null) return undefined
    const previous = this.items.get(this.sessionId)
    this.complete(this.sessionId)
    // `exactOptionalPropertyTypes` is on, so an absent key and a key set to
    // `undefined` are different things: carry only what the previous scribble
    // actually had, then let `options` override.
    const carried: ScribbleSessionOptions = {}
    if (previous) {
      const p = previous.scribble
      if (p.color !== undefined) carried.color = p.color
      if (p.size !== undefined) carried.size = p.size
      if (p.opacity !== undefined) carried.opacity = p.opacity
      if (p.delay !== undefined) carried.delay = p.delay
      if (p.shrink !== undefined) carried.shrink = p.shrink
      if (p.taper !== undefined) carried.taper = p.taper
    }
    const item = this.addScribble({
      ...carried,
      ...options,
    })
    this.sessionId = item.id
    return item
  }

  /** End the session and remove every scribble immediately, fade included. */
  clearSession(): void {
    this.sessionId = null
    this.reset()
  }

  // ---- animation ----------------------------------------------------------

  /**
   * Advance every scribble by `elapsed` milliseconds: append the point offered
   * since the last tick, burn off the delay, and shed points from the tail once
   * it has run out. Scribbles that have shed everything are removed.
   */
  tick(elapsed: number): void {
    if (this.items.size === 0) return
    let changed = false

    for (const item of [...this.items.values()]) {
      const points = [...item.scribble.points]
      let state = item.scribble.state
      /** Whether this scribble's points differ from the ones in its record. */
      let moved = false

      if (item.next && (!item.prev || item.prev.x !== item.next.x || item.prev.y !== item.next.y)) {
        points.push(item.next)
        item.prev = item.next
        moved = true
      }
      item.next = null

      if (state === "starting" && points.length > 1) state = "active"

      if (item.delayRemaining > 0) {
        item.delayRemaining = Math.max(0, item.delayRemaining - elapsed)
      } else if (state !== "starting") {
        // Shed from the head so the stroke reads as a trail following the
        // pointer rather than one that erases itself from the wrong end.
        const shed = Math.max(1, Math.ceil(points.length * item.scribble.shrink))
        if (points.length > 0) {
          points.splice(0, shed)
          moved = true
        }
      }

      if (points.length === 0 && (state === "stopping" || state === "paused")) {
        this.items.delete(item.id)
        if (this.sessionId === item.id) this.sessionId = null
        changed = true
        continue
      }

      // Whether the points *moved*, not whether there are more of them. Once a
      // trail is in equilibrium — one point committed and one shed on the same
      // frame, which is where a laser spends most of its life — the count does
      // not change from one frame to the next, and a length comparison would
      // decide there was nothing to publish and freeze the trail on screen
      // behind a pointer that is still moving.
      if (moved || state !== item.scribble.state) {
        item.scribble = { ...item.scribble, points, state }
        changed = true
      }
    }

    if (changed) this.flush()
  }

  /**
   * Whether anything here still needs frames.
   *
   * A host's frame loop asks this to decide whether to schedule another one. It
   * is deliberately "is there a scribble at all" rather than "is there anything
   * visible to redraw": a point offered through {@link addPoint} is held in
   * `next` and writes nothing to the store, so a loop that parked itself
   * because the picture had settled would never wake up to commit it, and the
   * trail would stop dead under a moving pointer.
   */
  hasPendingWork(): boolean {
    return this.items.size > 0
  }

  /** Every live scribble, in the order they were started. */
  getItems(): ScribbleItem[] {
    return [...this.items.values()]
  }

  /** Mirror the current scribbles into the `instance` record. */
  private flush(): void {
    const scribbles = [...this.items.values()].map((item) => item.scribble)
    const current = this.editor.getInstanceState().scribbles
    if (current.length === 0 && scribbles.length === 0) return
    this.editor.updateInstanceState({ scribbles })
  }
}
