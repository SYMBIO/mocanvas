import { describe, expect, it } from "vitest"
import { ValidationError } from "../validation/validator"
import {
  assetIdValidator,
  assetValidator,
  bookmarkAssetValidator,
  imageAssetValidator,
  videoAssetValidator,
} from "./assetValidators"

const imageProps = {
  w: 100,
  h: 50,
  name: "photo.png",
  isAnimated: false,
  mimeType: "image/png",
  src: "https://example.test/photo.png",
}

function image(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "asset:img", typeName: "asset", type: "image", props: imageProps, meta: {}, ...overrides }
}

const bookmark = {
  id: "asset:bm",
  typeName: "asset",
  type: "bookmark",
  props: {
    title: "Example",
    description: "An example page",
    image: "https://example.test/og.png",
    favicon: "https://example.test/favicon.ico",
    src: "https://example.test/",
  },
  meta: {},
}

describe("assetIdValidator", () => {
  it("accepts an asset id and rejects anything else", () => {
    expect(assetIdValidator.validate("asset:abc")).toBe("asset:abc")
    expect(assetIdValidator.isValid("shape:abc")).toBe(false)
    expect(assetIdValidator.isValid("asset:")).toBe(false)
    expect(assetIdValidator.isValid(42)).toBe(false)
  })
})

describe("imageAssetValidator", () => {
  it("accepts a complete image asset", () => {
    expect(imageAssetValidator.validate(image())).toEqual(image())
  })

  it("accepts an asset that is still uploading (src is null)", () => {
    expect(imageAssetValidator.isValid(image({ props: { ...imageProps, src: null } }))).toBe(true)
  })

  it("accepts the optional fileSize and a null mimeType", () => {
    expect(imageAssetValidator.isValid(image({ props: { ...imageProps, fileSize: 2048, mimeType: null } }))).toBe(true)
  })

  it("rejects a missing dimension", () => {
    const { w: _w, ...withoutW } = imageProps
    expect(imageAssetValidator.isValid(image({ props: withoutW }))).toBe(false)
  })

  it("rejects the wrong type of a dimension", () => {
    expect(imageAssetValidator.isValid(image({ props: { ...imageProps, w: "100" } }))).toBe(false)
  })

  it("rejects a script-bearing src", () => {
    expect(imageAssetValidator.isValid(image({ props: { ...imageProps, src: "javascript:alert(1)" } }))).toBe(false)
  })

  it("rejects an unknown prop rather than silently keeping it", () => {
    expect(imageAssetValidator.isValid(image({ props: { ...imageProps, rotation: 4 } }))).toBe(false)
  })

  it("rejects a video or bookmark asset", () => {
    expect(imageAssetValidator.isValid(image({ type: "video" }))).toBe(false)
    expect(imageAssetValidator.isValid(bookmark)).toBe(false)
  })

  it("names the failing path", () => {
    let error: unknown
    try {
      imageAssetValidator.validate(image({ props: { ...imageProps, h: null } }))
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).message).toContain("image_asset.props.h")
  })
})

describe("videoAssetValidator", () => {
  it("accepts a video asset and rejects an image one", () => {
    expect(videoAssetValidator.isValid(image({ id: "asset:vid", type: "video" }))).toBe(true)
    expect(videoAssetValidator.isValid(image())).toBe(false)
  })
})

describe("bookmarkAssetValidator", () => {
  it("accepts a complete bookmark asset", () => {
    expect(bookmarkAssetValidator.validate(bookmark)).toEqual(bookmark)
  })

  it("rejects a bookmark whose src is not a link", () => {
    expect(bookmarkAssetValidator.isValid({ ...bookmark, props: { ...bookmark.props, src: "data:text/html,x" } })).toBe(
      false,
    )
  })

  it("rejects image props", () => {
    expect(bookmarkAssetValidator.isValid(image({ id: "asset:bm", type: "bookmark" }))).toBe(false)
  })
})

describe("assetValidator", () => {
  it("dispatches on type", () => {
    expect(assetValidator.isValid(image())).toBe(true)
    expect(assetValidator.isValid(image({ id: "asset:vid", type: "video" }))).toBe(true)
    expect(assetValidator.isValid(bookmark)).toBe(true)
  })

  it("rejects an unknown asset type by name", () => {
    let error: unknown
    try {
      assetValidator.validate(image({ type: "audio" }))
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).message).toContain('"image"')
  })

  it("still enforces the per-type props once it has dispatched", () => {
    expect(assetValidator.isValid(image({ props: { ...imageProps, isAnimated: "no" } }))).toBe(false)
  })
})
