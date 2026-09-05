import { describe, expect, it, vi } from "vitest"
import type { TLFontFace } from "@mocanvas/editor"
import { allDefaultFontFaces, defaultAddFontsFromNode, defaultFonts, preloadFont } from "./index"

describe("allDefaultFontFaces", () => {
  it("flattens every family, style and weight", () => {
    // Four families × upright/italic × normal/bold.
    expect(allDefaultFontFaces).toHaveLength(16)
  })

  it("names only the four built-in families", () => {
    expect([...new Set(allDefaultFontFaces.map((face) => face.family))].sort()).toEqual([
      "tldraw_draw",
      "tldraw_mono",
      "tldraw_sans",
      "tldraw_serif",
    ])
  })

  it("loads nothing over the network", () => {
    for (const face of allDefaultFontFaces) expect(String(face.src)).toContain("local(")
  })
})

describe("defaultFonts", () => {
  it("exposes each family's four faces", () => {
    expect(defaultFonts.tldraw_serif.normal.bold.weight).toBe("bold")
    expect(defaultFonts.tldraw_serif.italic.normal.style).toBe("italic")
  })
})

describe("defaultAddFontsFromNode", () => {
  const base = { family: "tldraw_draw", weight: "normal", style: "normal" }

  it("registers the face the state names", () => {
    const seen: TLFontFace[] = []
    const next = defaultAddFontsFromNode({}, base, (face) => seen.push(face))
    expect(next).toEqual(base)
    expect(seen[0]?.family).toBe("tldraw_draw")
  })

  it("switches to bold on a bold mark", () => {
    const seen: TLFontFace[] = []
    const next = defaultAddFontsFromNode({ marks: [{ type: { name: "bold" } }] }, base, (face) => seen.push(face))
    expect(next.weight).toBe("bold")
    expect(seen[0]?.weight).toBe("bold")
  })

  it("switches to italic on an italic mark", () => {
    const next = defaultAddFontsFromNode({ marks: [{ type: "em" }] }, base, () => {})
    expect(next.style).toBe("italic")
  })

  it("switches to the mono family on a code mark", () => {
    const next = defaultAddFontsFromNode({ marks: [{ type: "code" }] }, base, () => {})
    expect(next.family).toBe("tldraw_mono")
  })

  it("combines marks", () => {
    const next = defaultAddFontsFromNode({ marks: [{ type: "bold" }, { type: "italic" }] }, base, () => {})
    expect(next).toEqual({ family: "tldraw_draw", weight: "bold", style: "italic" })
  })

  it("leaves the state alone for a mark it does not know", () => {
    expect(defaultAddFontsFromNode({ marks: [{ type: "brand" }] }, base, () => {})).toEqual(base)
  })

  it("registers nothing for a family it has no faces for", () => {
    const seen: TLFontFace[] = []
    defaultAddFontsFromNode({}, { ...base, family: "acme_display" }, (face) => seen.push(face))
    expect(seen).toEqual([])
  })
})

describe("preloadFont", () => {
  it("rejects where there is no font loading api", async () => {
    await expect(preloadFont("acme", { url: "/acme.woff2" }, undefined)).rejects.toThrow(/Font Loading API/)
  })

  it("adds the loaded face to the document it is given", async () => {
    const add = vi.fn()
    const load = vi.fn(async function (this: unknown) {
      return this
    })
    const FontFaceStub = vi.fn(function (this: Record<string, unknown>, family: string, source: string, descriptors: object) {
      Object.assign(this, { family, source, descriptors, load })
    })
    vi.stubGlobal("FontFace", FontFaceStub)

    const doc = { fonts: { add } } as unknown as Document
    await preloadFont("acme", { url: "/acme.woff2", format: "woff2", weight: "700" }, doc)

    expect(FontFaceStub).toHaveBeenCalledWith("acme", 'url("/acme.woff2") format("woff2")', { weight: "700" })
    expect(add).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
