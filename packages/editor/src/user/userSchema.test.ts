import { describe, expect, it, vi } from "vitest"
import { createCachedUserResolve } from "./userSchema"
import { createUserId, type User, type UserId } from "./userRecord"

const id = createUserId("a")
const person: User = { id, typeName: "user", name: "A", color: "#000", avatarUrl: null, meta: {} }

describe("createCachedUserResolve", () => {
  it("asks the store once for a synchronous answer", () => {
    const resolve = vi.fn(() => person)
    const cached = createCachedUserResolve(resolve)
    expect(cached(id)).toBe(person)
    expect(cached(id)).toBe(person)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it("caches a null answer too", () => {
    const resolve = vi.fn(() => null)
    const cached = createCachedUserResolve(resolve)
    cached(id)
    cached(id)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it("shares one in-flight request between callers", async () => {
    const resolve = vi.fn(async () => person)
    const cached = createCachedUserResolve(resolve)
    const [a, b] = await Promise.all([cached(id), cached(id)])
    expect(a).toBe(person)
    expect(b).toBe(person)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it("re-asks once the answer has expired", () => {
    let time = 0
    const resolve = vi.fn(() => person)
    const cached = createCachedUserResolve(resolve, { ttlMs: 10, now: () => time })
    cached(id)
    time = 20
    cached(id)
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it("does not cache a failure", async () => {
    const resolve = vi.fn(async (): Promise<User | null> => {
      throw new Error("offline")
    })
    const cached = createCachedUserResolve(resolve)
    await expect(cached(id as UserId)).rejects.toThrow("offline")
    await expect(cached(id as UserId)).rejects.toThrow("offline")
    expect(resolve).toHaveBeenCalledTimes(2)
  })
})
