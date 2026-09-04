import { describe, expect, it, vi } from "vitest"
import type { RenderBackend, TextureSource } from "../../render/backend"
import { bucketTextureResolution, TextureManager } from "../TextureManager"

/** Records uploads/deletes; nothing here touches a GPU. */
function fakeBackend() {
  const uploaded = new Map<number, TextureSource>()
  const deleted: number[] = []
  const backend = {
    kind: "webgl2",
    resize: vi.fn(),
    draw: vi.fn(),
    uploadTexture: vi.fn((id: number, source: TextureSource) => {
      uploaded.set(id, source)
    }),
    deleteTexture: vi.fn((id: number) => {
      uploaded.delete(id)
      deleted.push(id)
    }),
    dispose: vi.fn(),
  } as unknown as RenderBackend
  return { backend, uploaded, deleted }
}

const source = (w = 2, h = 3) => ({ width: w, height: h }) as unknown as TextureSource

/** Let the loader promise and its `then` chain settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("TextureManager", () => {
  it("allocates 1-based ids per key and reuses them", () => {
    const m = new TextureManager()
    const a = m.acquire("a", async () => source())
    const b = m.acquire("b", async () => source())
    expect(a).toBe(1)
    expect(b).toBe(2)
    expect(m.acquire("a", async () => source())).toBe(1)
    expect(m.getInfo("a")?.refs).toBe(2)
    expect(m.size).toBe(2)
  })

  it("uploads through the backend when the load resolves and reports readiness", async () => {
    const { backend, uploaded } = fakeBackend()
    const onChange = vi.fn()
    const m = new TextureManager({ onChange })
    m.setBackend(backend)

    const id = m.acquire("img", async () => source(8, 4))
    expect(id).toBe(1)
    expect(m.getState("img")).toBe("pending")
    expect(m.isReady("img")).toBe(false)

    await settle()
    expect(m.isReady("img")).toBe(true)
    expect(uploaded.has(1)).toBe(true)
    expect(m.getInfo("img")).toMatchObject({ id: 1, state: "ready", width: 8, height: 4 })
    expect(onChange).toHaveBeenCalledWith(["img"])
  })

  it("resolves failed keys to 0 and keeps them out of the ready set", async () => {
    const onChange = vi.fn()
    const m = new TextureManager({ onChange })
    const first = m.acquire("bad", async () => {
      throw new Error("boom")
    })
    expect(first).toBe(1)
    await settle()
    expect(m.getState("bad")).toBe("error")
    expect(m.isReady("bad")).toBe(false)
    expect(m.getId("bad")).toBe(0)
    // Re-deriving the style now yields no texture, so the shape falls back to its fill.
    expect(m.acquire("bad", async () => source())).toBe(0)
    expect(onChange).toHaveBeenCalledWith(["bad"])
  })

  it("a loader that throws synchronously fails the same way", async () => {
    const m = new TextureManager()
    m.acquire("sync", () => {
      throw new Error("nope")
    })
    await settle()
    expect(m.getState("sync")).toBe("error")
  })

  it("refcounts: the texture is deleted only when the last reference goes", async () => {
    const { backend, deleted } = fakeBackend()
    const m = new TextureManager()
    m.setBackend(backend)
    m.acquire("shared", async () => source())
    m.acquire("shared", async () => source())
    await settle()

    m.release("shared")
    expect(deleted).toEqual([])
    expect(m.size).toBe(1)

    m.release("shared")
    expect(deleted).toEqual([1])
    expect(m.size).toBe(0)
    expect(m.getState("shared")).toBeUndefined()

    // A fresh acquire of the same key gets a new id.
    expect(m.acquire("shared", async () => source())).toBe(2)
  })

  it("releasing an unknown key is a no-op", () => {
    const m = new TextureManager()
    expect(() => m.release("nope")).not.toThrow()
  })

  it("withOwner reconciles the keys a shape holds instead of piling up refs", async () => {
    const { backend, deleted } = fakeBackend()
    const m = new TextureManager()
    m.setBackend(backend)

    const write = (key: string) => m.withOwner("shape:a", () => m.acquire(key, async () => source()))
    expect(write("k1")).toBe(1)
    expect(write("k1")).toBe(1)
    expect(write("k1")).toBe(1)
    expect(m.getInfo("k1")?.refs).toBe(1)
    expect(m.getOwners("k1")).toEqual(["shape:a"])

    // The shape's key changed (new asset / new resolution bucket): the old one goes.
    expect(write("k2")).toBe(2)
    expect(m.getState("k1")).toBeUndefined()
    expect(deleted).toEqual([1])
    expect(m.getAllOwners()).toEqual(["shape:a"])

    m.releaseOwner("shape:a")
    expect(m.size).toBe(0)
    expect(m.getOwners("k2")).toEqual([])
    expect(m.getAllOwners()).toEqual([])
    await settle()
  })

  it("two owners of one key keep it alive until both let go", () => {
    const m = new TextureManager()
    const a = m.withOwner("shape:a", () => m.acquire("k", async () => source()))
    const b = m.withOwner("shape:b", () => m.acquire("k", async () => source()))
    expect(a).toBe(b)
    expect(m.getInfo("k")?.refs).toBe(2)
    expect(new Set(m.getOwners("k"))).toEqual(new Set(["shape:a", "shape:b"]))
    m.releaseOwner("shape:a")
    expect(m.size).toBe(1)
    m.releaseOwner("shape:b")
    expect(m.size).toBe(0)
  })

  it("re-uploads everything to a new backend", async () => {
    const first = fakeBackend()
    const m = new TextureManager()
    m.setBackend(first.backend)
    m.acquire("a", async () => source())
    m.acquire("b", async () => source())
    await settle()
    expect(first.uploaded.size).toBe(2)

    const second = fakeBackend()
    m.setBackend(second.backend)
    expect(m.getBackend()).toBe(second.backend)
    expect(second.uploaded.size).toBe(2)
    expect([...second.uploaded.keys()].sort()).toEqual([1, 2])
  })

  it("uploads a pending texture that resolves after the backend appears", async () => {
    const { backend, uploaded } = fakeBackend()
    const m = new TextureManager()
    m.acquire("late", async () => source())
    await settle()
    expect(uploaded.size).toBe(0)
    m.setBackend(backend)
    expect(uploaded.has(1)).toBe(true)
  })

  it("dispose frees the textures and stops handing out ids", async () => {
    const { backend, deleted } = fakeBackend()
    const m = new TextureManager()
    m.setBackend(backend)
    m.acquire("a", async () => source())
    await settle()
    m.dispose()
    expect(deleted).toEqual([1])
    expect(m.acquire("b", async () => source())).toBe(0)
    expect(m.getBackend()).toBeNull()
  })
})

describe("bucketTextureResolution", () => {
  it("snaps the zoom up to a power of two and multiplies by the dpr", () => {
    expect(bucketTextureResolution(1, 1)).toBe(1)
    expect(bucketTextureResolution(1, 2)).toBe(2)
    expect(bucketTextureResolution(1.01, 1)).toBe(2)
    expect(bucketTextureResolution(2, 1)).toBe(2)
    expect(bucketTextureResolution(0.3, 1)).toBe(0.5)
    expect(bucketTextureResolution(0.05, 1)).toBe(0.25)
  })

  it("clamps to the zoom and resolution ceilings", () => {
    expect(bucketTextureResolution(100, 1)).toBe(4)
    expect(bucketTextureResolution(100, 3)).toBe(8)
    expect(bucketTextureResolution(4, 2)).toBe(8)
  })

  it("is stable across a range of zooms inside one bucket", () => {
    const values = [1.05, 1.3, 1.7, 2].map((z) => bucketTextureResolution(z, 2))
    expect(new Set(values).size).toBe(1)
  })

  it("falls back to 1 for a nonsense zoom or dpr", () => {
    expect(bucketTextureResolution(Number.NaN, Number.NaN)).toBe(1)
    expect(bucketTextureResolution(0, 0)).toBe(1)
  })
})
