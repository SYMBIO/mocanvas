import { atom, computed, type Signal } from "@mocanvas/state"
import {
  CameraRecordType,
  INSTANCE_ID,
  InstancePageStateRecordType,
  type JsonObject,
  type PageId,
} from "../records/base"
import {
  InstancePresenceRecordType,
  PRESENCE_COLORS,
  type InstancePresence,
  type InstancePresenceId,
} from "../records/presence"
import type { EditorStore } from "../editor/createStore"
import type { UserId } from "./userRecord"

/**
 * The identity half of a presence record: everything the derivation cannot read
 * off the store because it is about *who* rather than *what they are doing*.
 *
 * Structural on purpose — a `User` record satisfies it, and so does the plain
 * `{ id, name, color }` a host already has from its own session.
 */
export interface PresenceUser {
  /** A branded {@link UserId} — this is what lands on `InstancePresence.userId`. */
  id: UserId
  name?: string
  color?: string
  meta?: JsonObject
}

/** A page-space point. Structural so a `Vec` can stand in for one. */
export interface PointLike {
  x: number
  y: number
}

/**
 * What one client broadcasts about itself, minus the record's own identity.
 *
 * The presence *record* has an `id` (this tab) and a `typeName`; neither is
 * something a host decides, so a custom `getUserPresence` never has to produce
 * them. Everything else — where the cursor is, what is selected, which page —
 * is the state, and this is its type.
 */
export type TLPresenceStateInfo = Omit<InstancePresence, "id" | "typeName">

/**
 * Options for {@link createPresenceStateDerivation}, under the documented name.
 *
 * {@link getUserPresence} is the override point: replace it to broadcast
 * something other than the default reading of the store — an agent that has a
 * selection but no cursor, a viewer whose camera should stay private, a host
 * that wants to attach its own `meta`. Return `null` to broadcast nothing at
 * all this tick, which is how a client goes quiet without disconnecting.
 */
export interface CreatePresenceStateDerivationOpts {
  /**
   * The id to publish under. Defaults to a fresh one per derivation, which is
   * the right thing: presence is per *instance*, so a second tab belonging to
   * the same person is a second cursor.
   */
  instanceId?: InstancePresenceId
  /** Override how presence state is read out of the store. */
  getUserPresence?(store: EditorStore, user: PresenceUser): TLPresenceStateInfo | null
}

export interface PresenceStateDerivationOptions extends CreatePresenceStateDerivationOpts {
  /**
   * The id to publish under. Defaults to a fresh one per derivation, which is
   * the right thing: presence is per *instance*, so a second tab belonging to
   * the same person is a second cursor.
   */
  id?: InstancePresenceId
  /**
   * Where this client's pointer is, in page space.
   *
   * mocanvas keeps the live pointer on `editor.inputs`, which is a plain object
   * and therefore invisible to a signal graph. Pass a signal — see
   * {@link trackPointer} — to make the broadcast cursor actually move; without
   * one the cursor sits at the origin while camera, selection and brush still
   * update.
   */
  pointer?: Signal<PointLike>
  /** The "say something" bubble above the cursor. Empty string means no bubble. */
  chatMessage?: Signal<string>
  /** Clock for `lastActivityTimestamp`. Injectable so tests are deterministic. */
  now?: () => number
}

/**
 * Build the signal that says what to broadcast about this client.
 *
 * Curried the way a sync layer wants it: bind the identity once, then apply it
 * to a store to get a derived `instance_presence` record that recomputes
 * whenever the camera moves, the selection changes, the brush is dragged or the
 * current page changes. Push its value at whatever rate the transport likes —
 * the signal itself does no scheduling.
 *
 * Returns `null` before the store has an `instance` record, i.e. before the
 * editor has finished starting up.
 */
export function createPresenceStateDerivation<U extends PresenceUser>(
  $user: Signal<U>,
  options: PresenceStateDerivationOptions = {},
): (store: EditorStore) => Signal<InstancePresence | null> {
  const now = options.now ?? (() => Date.now())
  return (store: EditorStore) => {
    const id = options.id ?? options.instanceId ?? InstancePresenceRecordType.createId()
    return computed<InstancePresence | null>(`presence:${id}`, () => {
      const user = $user.get()
      if (!user) return null

      if (options.getUserPresence) {
        const state = options.getUserPresence(store, user)
        return state === null ? null : InstancePresenceRecordType.create({ id, ...state })
      }

      const instance = store.get(INSTANCE_ID)
      if (!instance) return null

      const pageId: PageId = instance.currentPageId
      const suffix = pageId.slice("page:".length)
      const camera = store.get(CameraRecordType.createId(suffix))
      const pageState = store.get(InstancePageStateRecordType.createId(suffix))
      const pointer = options.pointer?.get() ?? ORIGIN

      return InstancePresenceRecordType.create({
        id,
        userId: user.id,
        userName: user.name ?? "",
        color: user.color || PRESENCE_COLORS[0],
        currentPageId: pageId,
        cursor: {
          x: pointer.x,
          y: pointer.y,
          type: instance.cursor.type,
          rotation: instance.cursor.rotation,
        },
        camera: camera ? { x: camera.x, y: camera.y, z: camera.z } : { x: 0, y: 0, z: 1 },
        selectedShapeIds: pageState ? [...pageState.selectedShapeIds] : [],
        brush: instance.brush ? { ...instance.brush } : null,
        scribbles: instance.scribbles.map((scribble) => ({ ...scribble, points: [...scribble.points] })),
        followingUserId: instance.followingUserId,
        // SEMANTICS-ASSUMED: stamped on every recompute rather than tracked
        // separately. A peer treats a presence record as stale after a while, so
        // the timestamp has to move whenever anything else does; a client that
        // is idle but still connected keeps itself alive by re-pushing the same
        // record on a heartbeat, which is the transport's job, not this signal's.
        lastActivityTimestamp: now(),
        chatMessage: options.chatMessage?.get() ?? "",
        meta: user.meta ?? {},
      })
    })
  }
}

const ORIGIN: PointLike = { x: 0, y: 0 }

/**
 * Anything that emits editor events and exposes the current pointer — i.e. an
 * `Editor`, expressed structurally so this module does not depend on it.
 */
export interface PointerSource {
  on(name: "event", fn: () => void): () => void
  readonly inputs: { readonly currentPagePoint: PointLike }
}

/**
 * Mirror an editor's page-space pointer into a signal, so
 * {@link createPresenceStateDerivation} can broadcast a cursor that moves.
 *
 * Call `stop()` when the editor goes away.
 */
export function trackPointer(source: PointerSource): { pointer: Signal<PointLike>; stop: () => void } {
  const $pointer = atom<PointLike>("presence.pointer", ORIGIN)
  let last = ORIGIN
  const stop = source.on("event", () => {
    const { x, y } = source.inputs.currentPagePoint
    if (x === last.x && y === last.y) return
    last = { x, y }
    $pointer.set(last)
  })
  return { pointer: $pointer, stop }
}

/**
 * Read this client's presence state out of the store: the default
 * {@link CreatePresenceStateDerivationOpts.getUserPresence}.
 *
 * Exported so a host that only wants to *adjust* the default — blank the
 * cursor, add some `meta` — can call it and edit the result, rather than
 * reimplementing the store reads and drifting out of step with them.
 *
 * Returns `null` before the store has an `instance` record, i.e. before the
 * editor has finished starting up: there is nothing meaningful to broadcast
 * about a client that is not looking at anything yet.
 */
export function getDefaultUserPresence(store: EditorStore, user: PresenceUser): TLPresenceStateInfo | null {
  const instance = store.get(INSTANCE_ID)
  if (!instance) return null

  const pageId: PageId = instance.currentPageId
  const suffix = pageId.slice("page:".length)
  const camera = store.get(CameraRecordType.createId(suffix))
  const pageState = store.get(InstancePageStateRecordType.createId(suffix))

  return {
    userId: user.id,
    userName: user.name ?? "",
    color: user.color || PRESENCE_COLORS[0],
    currentPageId: pageId,
    cursor: { x: 0, y: 0, type: instance.cursor.type, rotation: instance.cursor.rotation },
    camera: camera ? { x: camera.x, y: camera.y, z: camera.z } : { x: 0, y: 0, z: 1 },
    selectedShapeIds: pageState ? [...pageState.selectedShapeIds] : [],
    brush: instance.brush ? { ...instance.brush } : null,
    scribbles: instance.scribbles.map((scribble) => ({ ...scribble, points: [...scribble.points] })),
    followingUserId: instance.followingUserId,
    lastActivityTimestamp: Date.now(),
    chatMessage: "",
    meta: user.meta ?? {},
  }
}
