/**
 * Making the `user` record type your own, and looking people up without
 * hammering whatever is behind the lookup.
 *
 * Attribution is a *local* adapter onto the host application's own accounts.
 * The editor has no directory of its own and talks to no service; it asks a
 * {@link UserStore} for a name and a colour, and that store is the app's.
 */
import { createRecordType, type RecordId, type RecordType } from "@mocanvas/store"
import type { JsonObject } from "../records/base"
import type { User, UserId, UserStore } from "./userRecord"

/**
 * A `user` record type carrying the app's own fields.
 *
 * The built-in {@link ./userRecord.UserRecordType} has the four properties the
 * canvas itself needs. An app that wants people to carry more — a team, a role,
 * a handle to render an avatar from — declares them here rather than stuffing
 * them into `meta`, so its own code gets them typed.
 *
 * The record stays in the `presence` scope: identities are shared with
 * collaborators but never written to a file, because who was in the room is
 * not part of the document.
 */
export function createUserRecordType<U extends User = User>(
  defaults: () => Omit<U, "id" | "typeName">,
): RecordType<U, "id" | "typeName"> {
  return createRecordType<U>("user", { scope: "presence" }).withDefaultProperties(defaults) as unknown as RecordType<
    U,
    "id" | "typeName"
  >
}

/** The default properties the built-in `user` record type starts from. */
export function getDefaultUserProperties(): { name: string; color: string; avatarUrl: string | null; meta: JsonObject } {
  return { name: "", color: "", avatarUrl: null, meta: {} }
}

/** A {@link UserStore.resolve} wrapped in a cache. */
export type CachedUserResolve = (userId: UserId) => User | null | Promise<User | null>

/** How long a cached answer stays fresh, in milliseconds. */
const DEFAULT_TTL_MS = 60_000

/** Options for {@link createCachedUserResolve}. */
export interface CreateCachedUserResolveOptions {
  /** How long an answer is reused. Defaults to a minute. */
  ttlMs?: number
  /** Clock, injectable so tests are deterministic. */
  now?: () => number
}

/**
 * Wrap a {@link UserStore}'s `resolve` so the same id is not looked up twice.
 *
 * The render path asks for a name once per attributed shape, per frame. Without
 * a cache that is one lookup per shape per frame — and if the store is async,
 * one *request*. This collapses them: an in-flight promise is shared rather
 * than duplicated, and a settled answer is reused until it expires.
 *
 * A `null` answer is cached too, deliberately. "This id is not a person I know"
 * is a real answer, and re-asking for it on every frame is exactly the case a
 * cache exists to prevent — a board full of shapes attributed to a departed
 * colleague would otherwise never stop asking.
 *
 * Failures are *not* cached: a lookup that threw gets another chance, because a
 * network blip should not blank out a name for the rest of the session.
 */
export function createCachedUserResolve(
  resolve: UserStore["resolve"],
  options: CreateCachedUserResolveOptions = {},
): CachedUserResolve {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? (() => Date.now())

  const settled = new Map<UserId, { value: User | null; at: number }>()
  const pending = new Map<UserId, Promise<User | null>>()

  return (userId: UserId) => {
    const hit = settled.get(userId)
    if (hit && now() - hit.at < ttlMs) return hit.value

    const inFlight = pending.get(userId)
    if (inFlight) return inFlight

    const answer = resolve(userId)
    if (!(answer instanceof Promise)) {
      settled.set(userId, { value: answer, at: now() })
      return answer
    }

    const promise = answer.then(
      (value) => {
        settled.set(userId, { value, at: now() })
        pending.delete(userId)
        return value
      },
      (error: unknown) => {
        pending.delete(userId)
        throw error
      },
    )
    pending.set(userId, promise)
    return promise
  }
}

/** The id type a `user` record is keyed by, for an app declaring its own. */
export type UserRecordId<U extends User = User> = RecordId<U>
