import { afterEach, describe, expect, it } from "vitest"
import {
  getIndexAbove,
  getIndexBetween,
  getIndices,
  getIndicesBetween,
  isIndexJitterEnabled,
  setIndexJitterEnabled,
  validateIndexKey,
  type IndexKey,
} from "./indexKey"

/**
 * Turning jitter off for a test run.
 *
 * Jitter is what stops two clients minting one key, and it also makes every
 * generated index unpredictable — which defeats the tests a consumer writes to
 * compare two implementations of the same operation, or two profiles of one.
 * Without a way off, those tests have to stop asserting `index` at all, which
 * is the assertion they existed for.
 */

const k = (s: string) => s as IndexKey

afterEach(() => setIndexJitterEnabled(null))

describe("under a test runner, with no configuration at all", () => {
  it("is off, so the same call twice gives the same key", () => {
    // This file runs under vitest, which sets NODE_ENV=test. Nothing else is
    // needed — that is the point: a consumer's suite works out of the box.
    expect(isIndexJitterEnabled()).toBe(false)
    expect(getIndexAbove(k("a0"))).toBe(getIndexAbove(k("a0")))
    expect(getIndexBetween(k("a0"), k("a2"))).toBe(getIndexBetween(k("a0"), k("a2")))
  })

  it("gives the plain keys a parity test can be written against", () => {
    expect(getIndexAbove(k("a0"))).toBe("a1")
    expect(getIndices(2)).toEqual(["a1", "a2", "a3"])
    // Whatever the generator's own distribution of a gap is, it is the same
    // every run — which is all a parity test needs.
    expect(getIndicesBetween(k("a0"), k("a4"), 3)).toEqual(getIndicesBetween(k("a0"), k("a4"), 3))
  })

  it("still produces valid, ordered keys — off is not broken, only predictable", () => {
    const run = getIndicesBetween(k("a0"), k("a9"), 5)
    for (const key of run) validateIndexKey(key)
    expect([...run].sort()).toEqual(run)
    expect(new Set(run).size).toBe(5)
  })
})

describe("forcing it", () => {
  it("comes back on when asked, which is how the jitter itself is tested", () => {
    setIndexJitterEnabled(true)
    expect(isIndexJitterEnabled()).toBe(true)
    expect(getIndexAbove(k("a0"))).not.toBe(getIndexAbove(k("a0")))
  })

  it("goes off when asked, even outside a test runner", () => {
    setIndexJitterEnabled(false)
    expect(isIndexJitterEnabled()).toBe(false)
    expect(getIndexAbove(k("a0"))).toBe("a1")
  })

  it("restores the default when set back to null", () => {
    setIndexJitterEnabled(true)
    setIndexJitterEnabled(null)
    expect(isIndexJitterEnabled()).toBe(false) // NODE_ENV=test again
  })

  it("takes precedence over the environment variable", () => {
    const proc = globalThis.process as { env: Record<string, string | undefined> }
    const before = proc.env["MOCANVAS_INDEX_JITTER"]
    try {
      proc.env["MOCANVAS_INDEX_JITTER"] = "1"
      expect(isIndexJitterEnabled(), "the env var beats NODE_ENV").toBe(true)
      setIndexJitterEnabled(false)
      expect(isIndexJitterEnabled(), "an explicit call beats the env var").toBe(false)
    } finally {
      if (before === undefined) delete proc.env["MOCANVAS_INDEX_JITTER"]
      else proc.env["MOCANVAS_INDEX_JITTER"] = before
    }
  })

  it("reads the env var for a runner that does not set NODE_ENV", () => {
    const proc = globalThis.process as { env: Record<string, string | undefined> }
    const beforeJ = proc.env["MOCANVAS_INDEX_JITTER"]
    const beforeN = proc.env["NODE_ENV"]
    try {
      delete proc.env["NODE_ENV"]
      expect(isIndexJitterEnabled(), "no NODE_ENV, no override: jitter on").toBe(true)
      proc.env["MOCANVAS_INDEX_JITTER"] = "0"
      expect(isIndexJitterEnabled()).toBe(false)
      proc.env["MOCANVAS_INDEX_JITTER"] = "off"
      expect(isIndexJitterEnabled()).toBe(false)
    } finally {
      if (beforeJ === undefined) delete proc.env["MOCANVAS_INDEX_JITTER"]
      else proc.env["MOCANVAS_INDEX_JITTER"] = beforeJ
      if (beforeN !== undefined) proc.env["NODE_ENV"] = beforeN
    }
  })
})

describe("what the switch deliberately does NOT change", () => {
  it("leaves the start of getIndices literal either way", () => {
    // `start` is an input, echoed back — in mocanvas and in the reference. Two
    // replicas moving into the same empty parent DO get the same first key, and
    // that is faithful rather than a jitter bug.
    setIndexJitterEnabled(true)
    expect(getIndices(2)[0]).toBe("a1")
    expect(getIndices(2, k("b10"))[0]).toBe("b10")
  })
})
