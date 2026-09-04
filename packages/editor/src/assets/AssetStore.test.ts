import { describe, expect, it, vi } from "vitest"
import { AssetRecordType, type Asset, type AssetId, type ImageAsset } from "../records/asset"
import {
  createInMemoryAssetStore,
  DEFAULT_ASSET_CONTEXT,
  fileToDataUrl,
  getDefaultAssetContext,
  resolveAssetUrl,
  type AssetStore,
} from "./AssetStore"

function imageAsset(id = "asset:img1", src: string | null = null): ImageAsset {
  return AssetRecordType.create({
    id: id as AssetId,
    type: "image",
    props: { w: 10, h: 10, name: "x.png", isAnimated: false, mimeType: "image/png", src },
  }) as ImageAsset
}

function pngFile(bytes = [1, 2, 3], name = "x.png"): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/png" })
}

describe("createInMemoryAssetStore", () => {
  it("round-trips: what upload stores is what resolve returns", async () => {
    const store = createInMemoryAssetStore()
    const asset = imageAsset()

    const { src } = await store.upload(asset, pngFile([0xff, 0x00, 0x10]))

    expect(src).toBe("data:image/png;base64,/wAQ")
    expect(store.resolve?.(asset, DEFAULT_ASSET_CONTEXT)).toBe(src)
    expect(store.size).toBe(1)
  })

  it("keeps uploads apart by asset id", async () => {
    const store = createInMemoryAssetStore()
    const a = imageAsset("asset:a")
    const b = imageAsset("asset:b")

    const first = await store.upload(a, pngFile([1]))
    const second = await store.upload(b, pngFile([2]))

    expect(first.src).not.toBe(second.src)
    expect(store.resolve?.(a, DEFAULT_ASSET_CONTEXT)).toBe(first.src)
    expect(store.resolve?.(b, DEFAULT_ASSET_CONTEXT)).toBe(second.src)
  })

  it("forgets removed assets and falls back to whatever the record carries", async () => {
    const store = createInMemoryAssetStore()
    const asset = imageAsset("asset:a", "https://example.test/a.png")
    await store.upload(asset, pngFile())
    expect(store.size).toBe(1)

    await store.remove?.(["asset:a" as AssetId])

    expect(store.size).toBe(0)
    expect(store.resolve?.(asset, DEFAULT_ASSET_CONTEXT)).toBe("https://example.test/a.png")
  })

  it("encodes a file larger than one base64 chunk", async () => {
    const bytes = new Uint8Array(70_000).fill(65)
    const src = await fileToDataUrl(new File([bytes], "big.bin", { type: "application/octet-stream" }))
    expect(src.startsWith("data:application/octet-stream;base64,")).toBe(true)
    expect(atob(src.slice("data:application/octet-stream;base64,".length)).length).toBe(70_000)
  })
})

describe("resolveAssetUrl", () => {
  it("uses the store's resolve when it has one, with the given context", async () => {
    const resolve = vi.fn(() => "https://cdn.test/small.png")
    const store: AssetStore = { upload: async () => ({ src: "" }), resolve }
    const asset = imageAsset("asset:a", "https://example.test/original.png")
    const context = getDefaultAssetContext({ screenScale: 0.25 })

    await expect(resolveAssetUrl(store, asset, context)).resolves.toBe("https://cdn.test/small.png")
    expect(resolve).toHaveBeenCalledWith(asset, context)
  })

  it("awaits an async resolve", async () => {
    const store: AssetStore = {
      upload: async () => ({ src: "" }),
      resolve: async () => "https://cdn.test/later.png",
    }
    await expect(resolveAssetUrl(store, imageAsset())).resolves.toBe("https://cdn.test/later.png")
  })

  it("falls back to props.src when the store has no resolve", async () => {
    const store: AssetStore = { upload: async () => ({ src: "" }) }
    await expect(resolveAssetUrl(store, imageAsset("asset:a", "https://example.test/a.png"))).resolves.toBe(
      "https://example.test/a.png",
    )
  })

  it("falls back to props.src when there is no store at all, and to null when there is no src", async () => {
    await expect(resolveAssetUrl(undefined, imageAsset("asset:a", "https://example.test/a.png"))).resolves.toBe(
      "https://example.test/a.png",
    )
    await expect(resolveAssetUrl(undefined, imageAsset("asset:b", null))).resolves.toBeNull()
  })
})

describe("getDefaultAssetContext", () => {
  it("fills everything the caller left out", () => {
    expect(getDefaultAssetContext({ shouldResolveToOriginal: true })).toEqual({
      ...DEFAULT_ASSET_CONTEXT,
      shouldResolveToOriginal: true,
    })
  })
})

describe("a host-implemented store", () => {
  // The shape a real app writes: validate, put the bytes somewhere durable,
  // return a stable URL. Pinned here so the interface stays implementable
  // exactly the way the consumer already implements it.
  it("may reject a file by throwing from upload", async () => {
    const store: AssetStore = {
      async upload(_asset: Asset, file: File) {
        if (file.type !== "image/png") throw new Error(`unsupported type "${file.type}"`)
        return { src: `/api/assets/${_asset.id.replace(/^asset:/, "")}` }
      },
      resolve: (asset: Asset) => (asset.props as { src: string | null }).src,
    }

    await expect(store.upload(imageAsset(), new File([], "x.gif", { type: "image/gif" }))).rejects.toThrow(
      /unsupported type/,
    )
    await expect(store.upload(imageAsset("asset:abc"), pngFile())).resolves.toEqual({ src: "/api/assets/abc" })
  })
})
