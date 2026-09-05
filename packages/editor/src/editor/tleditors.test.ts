import { afterEach, describe, expect, it } from "vitest"
import { react } from "@mocanvas/state"
import type { Editor } from "@mocanvas/editor"
import { TLEditorsRegistry, tleditors } from "./tleditors"

/** A stand-in editor: the registry never looks inside one. */
function fakeEditor(name: string): Editor {
  return { name } as unknown as Editor
}

describe("the tleditors registry", () => {
  const removers: (() => void)[] = []

  afterEach(() => {
    while (removers.length) removers.pop()!()
  })

  it("starts empty and hands back what was registered, in mount order", () => {
    const registry = new TLEditorsRegistry()
    expect(registry.getMounted()).toEqual([])
    const a = fakeEditor("a")
    const b = fakeEditor("b")
    registry.register(a)
    registry.register(b)
    expect(registry.getMounted()).toEqual([a, b])
  })

  it("removes an editor through the function register returned", () => {
    const registry = new TLEditorsRegistry()
    const a = fakeEditor("a")
    const b = fakeEditor("b")
    const removeA = registry.register(a)
    registry.register(b)
    removeA()
    expect(registry.getMounted()).toEqual([b])
    // Removing twice is not an error, and does not take anything else with it.
    removeA()
    expect(registry.getMounted()).toEqual([b])
  })

  it("never registers the same editor twice, so a double-invoked effect is safe", () => {
    const registry = new TLEditorsRegistry()
    const a = fakeEditor("a")
    const first = registry.register(a)
    registry.register(a)
    expect(registry.getMounted()).toEqual([a])
    first()
    expect(registry.getMounted()).toEqual([])
  })

  it("ignores unregistering something that was never there", () => {
    const registry = new TLEditorsRegistry()
    const a = fakeEditor("a")
    registry.register(a)
    const before = registry.getMounted()
    registry.unregister(fakeEditor("other"))
    // Same array identity: nothing was rebuilt, so nothing downstream is woken.
    expect(registry.getMounted()).toBe(before)
  })

  it("is reactive: a reader is re-run when an editor mounts or unmounts", () => {
    const registry = new TLEditorsRegistry()
    const seen: number[] = []
    const stop = react("count", () => seen.push(registry.getMounted().length))
    const a = fakeEditor("a")
    const remove = registry.register(a)
    registry.register(a) // a no-op must not wake the reader
    remove()
    stop()
    expect(seen).toEqual([0, 1, 0])
  })

  it("exposes the same list as a signal, for readers outside React", () => {
    const registry = new TLEditorsRegistry()
    const a = fakeEditor("a")
    registry.register(a)
    expect(registry.mounted.get()).toEqual(registry.getMounted())
  })

  it("ships one shared instance, which is what code outside a React tree reaches for", () => {
    expect(tleditors).toBeInstanceOf(TLEditorsRegistry)
    const a = fakeEditor("shared")
    removers.push(tleditors.register(a))
    expect(tleditors.getMounted()).toContain(a)
  })
})
