import { atom, type Atom } from "@mocanvas/state"
import type { RecordId } from "@mocanvas/store"
import { createRecordType, uniqueId } from "@mocanvas/store"
import type { JsonObject, PageId, Scribble, ShapeId } from "./base"

/** Eight colours that stay readable on the canvas background in any order. */
export const PRESENCE_COLORS = [
  "#e0575b",
  "#ef8b3a",
  "#d8a72e",
  "#4f9d55",
  "#2fa39a",
  "#3f86d8",
  "#7a63d8",
  "#c05aa8",
] as const

export function randomPresenceColor(): string {
  return PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)]!
}

/**
 * What one other person is doing right now: where their cursor is, what they
 * have selected, which page they are on.
 *
 * Presence records live in the `presence` scope: they are shared with
 * collaborators but never written to a `.tldr` file and never enter history.
 */
export interface InstancePresence {
  readonly id: InstancePresenceId
  readonly typeName: "instance_presence"
  /** Stable id of the person (survives reconnects; one person may have many tabs). */
  userId: string
  userName: string
  /** CSS colour used for their cursor, name chip and selection outlines. */
  color: string
  currentPageId: PageId
  cursor: { x: number; y: number; type: string; rotation: number }
  camera: { x: number; y: number; z: number }
  selectedShapeIds: ShapeId[]
  brush: { x: number; y: number; w: number; h: number } | null
  scribbles: Scribble[]
  followingUserId: string | null
  /** `Date.now()` on the sender when the record was produced. */
  lastActivityTimestamp: number
  chatMessage: string
  meta: JsonObject
}

export type InstancePresenceId = RecordId<InstancePresence>

export const InstancePresenceRecordType = createRecordType<InstancePresence>("instance_presence", {
  scope: "presence",
}).withDefaultProperties(() => ({
  userName: "",
  color: PRESENCE_COLORS[0]!,
  cursor: { x: 0, y: 0, type: "default", rotation: 0 },
  camera: { x: 0, y: 0, z: 1 },
  selectedShapeIds: [],
  brush: null,
  scribbles: [],
  followingUserId: null,
  lastActivityTimestamp: 0,
  chatMessage: "",
  meta: {},
}))

export function isInstancePresenceId(id: string): id is InstancePresenceId {
  return id.startsWith("instance_presence:")
}

/**
 * The local person's identity, held in a signal so that renaming or
 * recolouring re-renders anything that shows it. Session-only: nothing here is
 * persisted with the document.
 */
export interface UserPreferences {
  getId(): string
  getName(): string
  getColor(): string
  setName(name: string): void
  setColor(color: string): void
}

export interface UserPreferencesInit {
  id?: string
  name?: string
  color?: string
}

/** Create a `UserPreferences` backed by one session atom. */
export function createUserPreferences(init: UserPreferencesInit = {}): UserPreferences {
  const id = init.id ?? `user:${uniqueId(12)}`
  const state: Atom<{ name: string; color: string }> = atom("editor.user", {
    name: init.name ?? `User ${id.slice(-4)}`,
    color: init.color ?? randomPresenceColor(),
  })
  return {
    getId: () => id,
    getName: () => state.get().name,
    getColor: () => state.get().color,
    setName: (name: string) => state.update((s) => ({ ...s, name })),
    setColor: (color: string) => state.update((s) => ({ ...s, color })),
  }
}
