import { react } from "@mocanvas/state"
import {
  InstancePresenceRecordType,
  type Editor,
  type InstancePresence,
  type InstancePresenceId,
  type UserId,
} from "@mocanvas/editor"
import type { IdOf, Store, UnknownRecord } from "@mocanvas/store"

/** Presence is sent at most this often (30 Hz). */
export const DEFAULT_PRESENCE_THROTTLE_MS = Math.ceil(1000 / 30)
/** A presence record is re-sent this often even when nothing changed. */
export const DEFAULT_PRESENCE_HEARTBEAT_MS = 3000
/** A collaborator we have not heard from in this long is dropped. */
export const DEFAULT_PRESENCE_TIMEOUT_MS = 10_000

/**
 * The part of the editor presence reads. Declared structurally so that the
 * sync layer does not need a live `Editor` (and its WASM engine) to be tested.
 */
export interface PresenceEditor {
  readonly store: Store<any, any>
  readonly inputs: { readonly currentPagePoint: { x: number; y: number } }
  readonly user: { getId(): UserId; getName(): string; getColor(): string }
  getCurrentPageId(): string
  getCamera(): { x: number; y: number; z: number }
  getSelectedShapeIds(): readonly string[]
  getInstanceState(): {
    cursor: { type: string; rotation: number }
    brush: { x: number; y: number; w: number; h: number } | null
    scribbles: readonly unknown[]
    followingUserId: UserId | null
  }
  /** Optional: used to sample the cursor, which is not itself a signal. */
  on?(name: "event", fn: () => void): () => void
}

// A real Editor must satisfy the structural interface above; this fails to
// compile if the two ever drift apart.
type Assert<T extends true> = T
export type EditorIsPresenceEditor = Assert<Editor extends PresenceEditor ? true : false>

export interface PresenceSyncOptions {
  editor: PresenceEditor
  /** Identifies this tab; one user may have several. */
  clientId: string
  send(record: InstancePresence): void
  throttleMs?: number
  heartbeatMs?: number
}

export interface PresenceSync {
  start(): void
  stop(): void
  /** Ask for a send; collapses with any other request inside the throttle window. */
  poke(): void
  /** The record last handed to `send`, for tests and debugging. */
  getLastSent(): InstancePresence | null
  dispose(): void
}

/** The id a client's presence record always uses, so updates overwrite in place. */
export function presenceIdForClient(clientId: string): InstancePresenceId {
  return InstancePresenceRecordType.createId(clientId) as InstancePresenceId
}

/**
 * Watches the editor and pushes the local presence record out, at most once per
 * throttle window, plus a heartbeat so that idle collaborators do not time out.
 */
export function createPresenceSync(options: PresenceSyncOptions): PresenceSync {
  const { editor, clientId, send } = options
  const throttleMs = options.throttleMs ?? DEFAULT_PRESENCE_THROTTLE_MS
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_PRESENCE_HEARTBEAT_MS
  const id = presenceIdForClient(clientId)

  let timer: ReturnType<typeof setTimeout> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let stopReactor: (() => void) | null = null
  let stopEvents: (() => void) | null = null
  let last: InstancePresence | null = null
  let running = false

  const build = (): InstancePresence => {
    const instance = editor.getInstanceState()
    const point = editor.inputs.currentPagePoint
    return InstancePresenceRecordType.create({
      id,
      userId: editor.user.getId(),
      userName: editor.user.getName(),
      color: editor.user.getColor(),
      currentPageId: editor.getCurrentPageId() as InstancePresence["currentPageId"],
      cursor: { x: point.x, y: point.y, type: instance.cursor.type, rotation: instance.cursor.rotation },
      camera: { ...editor.getCamera() },
      selectedShapeIds: [...editor.getSelectedShapeIds()] as InstancePresence["selectedShapeIds"],
      brush: instance.brush ? { ...instance.brush } : null,
      scribbles: [...instance.scribbles] as InstancePresence["scribbles"],
      followingUserId: instance.followingUserId,
      lastActivityTimestamp: Date.now(),
      chatMessage: "",
      meta: {},
    })
  }

  const flush = (force: boolean) => {
    if (!running) return
    const next = build()
    if (!force && last && isSamePresence(last, next)) return
    last = next
    send(next)
  }

  const poke = () => {
    if (!running || timer !== null) return
    timer = setTimeout(() => {
      timer = null
      flush(false)
    }, throttleMs)
  }

  return {
    start() {
      if (running) return
      running = true
      // Camera, page and selection are signals, so a reactor covers them.
      stopReactor = react("sync.presence", () => {
        editor.getCamera()
        editor.getCurrentPageId()
        editor.getSelectedShapeIds()
        editor.getInstanceState()
        editor.user.getName()
        editor.user.getColor()
        poke()
      })
      // The pointer position lives on `inputs`, which is not reactive.
      stopEvents = editor.on?.("event", poke) ?? null
      heartbeat = setInterval(() => flush(true), heartbeatMs)
      flush(true)
    },
    stop() {
      running = false
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (heartbeat !== null) {
        clearInterval(heartbeat)
        heartbeat = null
      }
      stopReactor?.()
      stopReactor = null
      stopEvents?.()
      stopEvents = null
    },
    poke,
    getLastSent: () => last,
    dispose() {
      this.stop()
      last = null
    },
  }
}

/** Equal apart from `lastActivityTimestamp`, which always moves. */
export function isSamePresence(a: InstancePresence, b: InstancePresence): boolean {
  return (
    a.userId === b.userId &&
    a.userName === b.userName &&
    a.color === b.color &&
    a.currentPageId === b.currentPageId &&
    a.chatMessage === b.chatMessage &&
    a.followingUserId === b.followingUserId &&
    sameCursor(a.cursor, b.cursor) &&
    sameCamera(a.camera, b.camera) &&
    sameIds(a.selectedShapeIds, b.selectedShapeIds) &&
    sameBrush(a.brush, b.brush) &&
    a.scribbles.length === b.scribbles.length &&
    a.scribbles.every((s, i) => s === b.scribbles[i])
  )
}

/** Cameras compare equal when both are absent, or when all three fields match. */
function sameCamera(a: InstancePresence["camera"], b: InstancePresence["camera"]): boolean {
  if (a === null || b === null) return a === b
  return a.x === b.x && a.y === b.y && a.z === b.z
}

/** Cursors compare equal when both are absent, or when all four fields match. */
function sameCursor(a: InstancePresence["cursor"], b: InstancePresence["cursor"]): boolean {
  if (a === null || b === null) return a === b
  return a.x === b.x && a.y === b.y && a.type === b.type && a.rotation === b.rotation
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function sameBrush(a: InstancePresence["brush"], b: InstancePresence["brush"]): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/**
 * Holds the presence records of everyone else: puts them in the store as they
 * arrive, drops them on `bye`, and sweeps clients that went quiet.
 */
export class PresenceRoom<R extends UnknownRecord> {
  private readonly seen = new Map<string, { id: string; at: number }>()
  private sweeper: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly store: Store<R, any>,
    private readonly timeoutMs: number = DEFAULT_PRESENCE_TIMEOUT_MS,
  ) {}

  /** Store an incoming presence record and remember when we saw its client. */
  receive(clientId: string, record: R): void {
    const previous = this.seen.get(clientId)
    if (previous && previous.id !== record.id) this.removeRecord(previous.id)
    this.seen.set(clientId, { id: record.id, at: Date.now() })
    this.store.mergeRemoteChanges(() => {
      this.store.put([record])
    })
  }

  /** Drop one client's presence (it said goodbye). */
  remove(clientId: string): void {
    const entry = this.seen.get(clientId)
    if (!entry) return
    this.seen.delete(clientId)
    this.removeRecord(entry.id)
  }

  /** Drop every client we have not heard from within the timeout. */
  sweep(now: number = Date.now()): void {
    const stale: string[] = []
    for (const [clientId, entry] of this.seen) {
      if (now - entry.at > this.timeoutMs) stale.push(clientId)
    }
    for (const clientId of stale) this.remove(clientId)
  }

  startSweeping(intervalMs: number = Math.max(1000, Math.floor(this.timeoutMs / 4))): void {
    if (this.sweeper !== null) return
    this.sweeper = setInterval(() => this.sweep(), intervalMs)
  }

  stopSweeping(): void {
    if (this.sweeper === null) return
    clearInterval(this.sweeper)
    this.sweeper = null
  }

  /** Remove every record this room put in the store. */
  clear(): void {
    const ids = Array.from(this.seen.values(), (entry) => entry.id)
    this.seen.clear()
    for (const id of ids) this.removeRecord(id)
  }

  private removeRecord(id: string): void {
    const recordId = id as IdOf<R>
    if (!this.store.unsafeGetWithoutCapture(recordId)) return
    this.store.mergeRemoteChanges(() => {
      this.store.remove([recordId])
    })
  }
}
