import { describe, expect, it } from "vitest"
import { ValidationError } from "../validation/validator"
import {
  createMemoryUserStore,
  createUserId,
  isUserId,
  UserRecordType,
  userIdValidator,
  userValidator,
  type User,
  type UserId,
} from "./userRecord"

function user(id: string, name: string): User {
  return UserRecordType.create({ id: id as UserId, name, color: "#ff0000" })
}

describe("createUserId", () => {
  it("prefixes the id", () => {
    expect(createUserId("ada")).toBe("user:ada")
  })

  it("turns a synthetic actor key into a stable canvas identity", () => {
    // The consumer names agents this way, and relies on the round trip staying
    // put across sessions.
    expect(createUserId("agent:planner")).toBe("user:agent:planner")
    expect(createUserId("agent:planner")).toBe(createUserId("agent:planner"))
  })

  it("mints a unique id when given nothing", () => {
    expect(createUserId()).not.toBe(createUserId())
    expect(isUserId(createUserId())).toBe(true)
  })
})

describe("isUserId", () => {
  it("accepts a user id and nothing else", () => {
    expect(isUserId("user:ada")).toBe(true)
    expect(isUserId("user:")).toBe(false)
    expect(isUserId("shape:ada")).toBe(false)
    expect(isUserId(undefined)).toBe(false)
  })
})

describe("userIdValidator", () => {
  it("throws with a useful message", () => {
    expect(userIdValidator.validate("user:ada")).toBe("user:ada")
    expect(() => userIdValidator.validate("ada")).toThrow(ValidationError)
    expect(() => userIdValidator.validate("ada")).toThrow(/user id/)
  })
})

describe("userValidator", () => {
  it("accepts a complete record", () => {
    const record = user("user:ada", "Ada")
    expect(userValidator.validate(record)).toEqual(record)
  })

  it("rejects a record with a bad id or a missing field", () => {
    expect(userValidator.isValid({ ...user("user:ada", "Ada"), id: "ada" })).toBe(false)
    const { color: _color, ...withoutColor } = user("user:ada", "Ada")
    expect(userValidator.isValid(withoutColor)).toBe(false)
  })
})

describe("UserRecordType", () => {
  it("defaults the fields a caller does not care about", () => {
    expect(UserRecordType.create({ id: createUserId("ada"), name: "Ada" })).toEqual({
      id: "user:ada",
      typeName: "user",
      name: "Ada",
      color: "",
      avatarUrl: null,
      meta: {},
    })
  })

  it("is presence-scoped: identities are shared but never written to a document", () => {
    expect(UserRecordType.scope).toBe("presence")
  })
})

describe("createMemoryUserStore", () => {
  const ada = user("user:ada", "Ada")
  const grace = user("user:grace", "Grace")

  it("treats the first entry as the current user", () => {
    expect(createMemoryUserStore([ada, grace]).getCurrentUser()).toEqual(ada)
  })

  it("honours an explicit current user", () => {
    expect(createMemoryUserStore([ada, grace], "user:grace" as UserId).getCurrentUser()).toEqual(grace)
  })

  it("resolves by id and returns null for a stranger", () => {
    const store = createMemoryUserStore([ada, grace])
    expect(store.resolve("user:grace" as UserId)).toEqual(grace)
    expect(store.resolve("user:nobody" as UserId)).toBeNull()
  })

  it("has no current user when it has no people", () => {
    expect(createMemoryUserStore([]).getCurrentUser()).toBeNull()
  })
})
