import type { RecordId } from "@mocanvas/store"
import { createRecordType } from "@mocanvas/store"
import { T } from "../validation/T"
import type { Validator } from "../validation/validator"
import type { JsonObject } from "../records/base"

/**
 * Who somebody *is*, as opposed to what they have configured.
 *
 * Identity and preferences are separate on purpose: a `User` is stable, shared
 * and can be looked up by id (it is what attribution and presence name), while
 * {@link ../user/userPreferences.UserPreferencesState} is local, mutable and
 * never leaves this browser.
 */
export interface User {
  readonly id: UserId
  readonly typeName: "user"
  /** Display name, as shown on a cursor chip or next to an edit. */
  name: string
  /** CSS colour used for this person's cursor and selection outlines. */
  color: string
  /** Where to fetch an avatar, or `null` when there is none. */
  avatarUrl: string | null
  meta: JsonObject
}

export type UserId = RecordId<User>

export const UserRecordType = createRecordType<User>("user", { scope: "presence" }).withDefaultProperties(() => ({
  name: "",
  color: "",
  avatarUrl: null,
  meta: {},
}))

/**
 * Mint a `user:` id. Passing `id` makes it deterministic, which is how a host
 * turns its own account id — or a synthetic actor like `agent:planner` — into a
 * stable canvas identity: `createUserId("agent:planner") === "user:agent:planner"`.
 *
 * SEMANTICS-ASSUMED: idempotent. An `id` that is already a `user:` id is
 * returned unchanged rather than prefixed again. `UserId` is a branded type, so
 * every host that stores its own ids as plain strings now has to funnel them
 * through this function; without idempotence the same value would double-prefix
 * on a second pass (a round trip through a URL, a re-read from storage) and
 * silently become a different person. The cost is that a host whose own
 * namespace literally begins with `user:` cannot mint a nested id — a trade
 * worth making against a class of silent identity bugs.
 */
export function createUserId(id?: string): UserId {
  if (id !== undefined && isUserId(id)) return id
  return UserRecordType.createId(id)
}

/** True when `id` is a `user:` id. */
export function isUserId(id: unknown): id is UserId {
  return typeof id === "string" && id.startsWith("user:") && id.length > "user:".length
}

/** Validates a `user:` id. */
export const userIdValidator = T.idOfType<UserId>("user")

/** Validates a whole `user` record. */
export const userValidator: Validator<User> = T.model(
  "user",
  T.object({
    id: userIdValidator,
    typeName: T.literal("user"),
    name: T.string,
    color: T.string,
    avatarUrl: T.string.nullable(),
    meta: T.jsonObject,
  }),
) as unknown as Validator<User>

/**
 * Where the editor asks about people.
 *
 * An app implements this over whatever it already has — a session, a members
 * table, a directory — so that attribution can name the author of a shape and
 * presence can put a face to a cursor without the editor owning any of it.
 */
export interface UserStore {
  /** The person using this editor right now, or `null` when nobody is signed in. */
  getCurrentUser(): User | null
  /**
   * Look up somebody by id. Returns `null` for an unknown id. May be async —
   * callers must tolerate a promise, and render a placeholder until it settles.
   */
  resolve(userId: UserId): User | null | Promise<User | null>
}

/**
 * A `UserStore` over a fixed list of people. The first entry (or `currentUserId`
 * when given) is the current user. Useful for tests, demos and single-player.
 */
export function createMemoryUserStore(users: readonly User[], currentUserId?: UserId): UserStore {
  const byId = new Map<UserId, User>(users.map((user) => [user.id, user]))
  const currentId = currentUserId ?? users[0]?.id
  return {
    getCurrentUser: () => (currentId ? (byId.get(currentId) ?? null) : null),
    resolve: (userId: UserId) => byId.get(userId) ?? null,
  }
}
