import { describe, expect, it } from "vitest"
import { dataUrlToFile, fileToBase64DataUrl, getDefaultCdnBaseUrl, inlineBase64AssetStore, setDefaultCdnBaseUrl } from "./inlineAssets"
import type { Asset } from "../records/asset"

const asset = { id: "asset:a", typeName: "asset", type: "image", props: {}, meta: {} } as unknown as Asset

describe("inlineBase64AssetStore", () => {
  it("inlines an upload as a data url", async () => {
    const file = new File(["hello"], "a.txt", { type: "text/plain" })
    const { src } = await inlineBase64AssetStore.upload(asset, file)
    expect(src).toBe(`data:text/plain;base64,${btoa("hello")}`)
  })

  it("has no remove: deleting the record deletes the bytes", () => {
    expect(inlineBase64AssetStore.remove).toBeUndefined()
  })
})

describe("dataUrlToFile", () => {
  it("round-trips a base64 data url", async () => {
    const file = new File(["some bytes"], "a.bin", { type: "application/octet-stream" })
    const url = await fileToBase64DataUrl(file)
    const back = await dataUrlToFile(url, "b.bin")
    expect(await back.text()).toBe("some bytes")
    expect(back.type).toBe("application/octet-stream")
  })

  it("reads a percent-encoded (non-base64) data url", async () => {
    const back = await dataUrlToFile("data:image/svg+xml,%3Csvg%2F%3E", "a.svg")
    expect(await back.text()).toBe("<svg/>")
    expect(back.type).toBe("image/svg+xml")
  })

  it("refuses anything that is not a data url", async () => {
    await expect(dataUrlToFile("https://example.com/a.png", "a.png")).rejects.toThrow()
  })
})

describe("getDefaultCdnBaseUrl", () => {
  it("points at nothing by default, so urls stay document-relative", () => {
    expect(getDefaultCdnBaseUrl()).toBe("")
  })

  it("trims a trailing slash so callers can always join with one", () => {
    setDefaultCdnBaseUrl("https://assets.example.com/")
    expect(getDefaultCdnBaseUrl()).toBe("https://assets.example.com")
    setDefaultCdnBaseUrl("")
  })
})
