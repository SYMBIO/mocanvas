import { describe, expect, it } from "vitest"
import {
  createAssetId,
  createShapeId,
  PATH_OP,
  type BookmarkAsset,
  type Editor,
  type PageId,
  type UnknownShape,
  type VideoAsset,
} from "@mocanvas/editor"
import type { IndexKey } from "@mocanvas/store"
import { shapeSvgRenderers, type SvgExportContext } from "../export/shape-svg"
import {
  BookmarkShapeUtil,
  BOOKMARK_HEIGHT,
  BOOKMARK_WIDTH,
  DEFAULT_EMBED_DEFINITIONS,
  EMBED_HEIGHT,
  EMBED_SANDBOX,
  EMBED_WIDTH,
  EmbedShapeUtil,
  embedDefinitions,
  getBookmarkCard,
  getBookmarkHostname,
  getBookmarkLayout,
  getEmbedDefinition,
  getEmbedInfo,
  getVideoPlayTriangle,
  getVideoSource,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  VideoShapeUtil,
  type BookmarkShape,
  type EmbedShape,
  type VideoShape,
} from "./index"

const BOOKMARK_ASSET_ID = createAssetId("bm")
const VIDEO_ASSET_ID = createAssetId("vid")

const bookmarkAsset: BookmarkAsset = {
  id: BOOKMARK_ASSET_ID,
  typeName: "asset",
  type: "bookmark",
  props: {
    title: "Example Domain",
    description: "A page reserved for documentation.",
    image: "https://example.com/banner.png",
    favicon: "https://example.com/favicon.ico",
    src: "https://example.com/page",
  },
  meta: {},
}

const videoAsset: VideoAsset = {
  id: VIDEO_ASSET_ID,
  typeName: "asset",
  type: "video",
  props: { w: 640, h: 360, name: "clip.mp4", isAnimated: true, mimeType: "video/mp4", src: "https://cdn.test/clip.mp4" },
  meta: {},
}

function stubEditor(assets: Record<string, unknown> = {}): Editor {
  return {
    getEditingShapeId: () => null,
    getAsset: (id: string) => assets[id],
  } as unknown as Editor
}

function makeShape<T extends UnknownShape>(type: T["type"], props: T["props"]): T {
  return {
    id: createShapeId(`test-${type}`),
    typeName: "shape",
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1" as IndexKey,
    parentId: "page:page" as PageId,
    isLocked: false,
    opacity: 1,
    props,
    meta: {},
  } as T
}

const ARG_COUNT: Record<number, number> = {
  [PATH_OP.MOVE]: 2,
  [PATH_OP.LINE]: 2,
  [PATH_OP.QUAD]: 4,
  [PATH_OP.CUBIC]: 6,
  [PATH_OP.CLOSE]: 0,
}

/** Every opcode is followed by exactly its argument count, all finite. */
function expectWellFormedPath(words: number[]): void {
  let i = 0
  while (i < words.length) {
    const op = words[i]!
    expect(op in ARG_COUNT).toBe(true)
    const n = ARG_COUNT[op]!
    for (let k = 1; k <= n; k++) expect(Number.isFinite(words[i + k])).toBe(true)
    i += 1 + n
  }
  expect(i).toBe(words.length)
}

const svgContext: SvgExportContext = { darkMode: false, background: "#f9fafb" }

describe("BookmarkShapeUtil", () => {
  const editor = stubEditor({ [BOOKMARK_ASSET_ID]: bookmarkAsset })
  const util = new BookmarkShapeUtil(editor)

  it("has the spec defaults", () => {
    expect(util.getDefaultProps()).toEqual({ w: BOOKMARK_WIDTH, h: BOOKMARK_HEIGHT, assetId: null, url: "" })
    expect([BOOKMARK_WIDTH, BOOKMARK_HEIGHT]).toEqual([300, 320])
  })

  it("is a filled box the size of its props, with well-formed path words", () => {
    const shape = makeShape<BookmarkShape>("bookmark", { ...util.getDefaultProps(), w: 240, h: 200 })
    const g = util.getGeometry(shape)
    expectWellFormedPath(g.toPathWords())
    expect(g.bounds.w).toBe(240)
    expect(g.bounds.h).toBe(200)
    expect(g.isFilled).toBe(true)
    // Props that arrived without a size still produce a usable box.
    expect(util.getGeometry(makeShape<BookmarkShape>("bookmark", {} as BookmarkShape["props"])).bounds.w).toBe(BOOKMARK_WIDTH)
  })

  it("renders through the overlay, never as a quad", () => {
    expect(util.getRenderStyle(makeShape<BookmarkShape>("bookmark", util.getDefaultProps()))).toBeNull()
  })

  it("reads title, description, image and favicon from its asset", () => {
    const shape = makeShape<BookmarkShape>("bookmark", {
      ...util.getDefaultProps(),
      assetId: BOOKMARK_ASSET_ID,
      url: "https://www.example.com/page",
    })
    expect(getBookmarkCard(editor, shape)).toEqual({
      title: "Example Domain",
      description: "A page reserved for documentation.",
      image: "https://example.com/banner.png",
      favicon: "https://example.com/favicon.ico",
      hostname: "example.com",
      url: "https://www.example.com/page",
      hasAsset: true,
    })
  })

  it("falls back to the host when the asset is missing", () => {
    const shape = makeShape<BookmarkShape>("bookmark", {
      ...util.getDefaultProps(),
      assetId: createAssetId("gone"),
      url: "https://docs.example.org/a/b?c=1",
    })
    const card = getBookmarkCard(editor, shape)
    expect(card.hasAsset).toBe(false)
    expect(card.title).toBe("")
    expect(card.hostname).toBe("docs.example.org")
  })

  it("reads a hostname without www, and nothing from junk", () => {
    expect(getBookmarkHostname("https://www.example.com/x")).toBe("example.com")
    expect(getBookmarkHostname("not a url")).toBe("")
    expect(getBookmarkHostname("")).toBe("")
  })

  it("lays the card out inside its own box", () => {
    for (const [w, h] of [[300, 320], [200, 120], [120, 60]] as const) {
      const l = getBookmarkLayout(w, h)
      for (const box of [l.banner, l.title, l.description, l.favicon, l.hostname]) {
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.w).toBeGreaterThanOrEqual(0)
        expect(box.h).toBeGreaterThanOrEqual(0)
        expect(box.x + box.w).toBeLessThanOrEqual(w + 1e-9)
        expect(box.y + box.h).toBeLessThanOrEqual(h + 1e-9)
      }
    }
  })
})

describe("getEmbedDefinition", () => {
  it("recognises every host on the permit list", () => {
    const permitted: [string, string][] = [
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
      ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
      ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube"],
      ["https://vimeo.com/123456789", "vimeo"],
      ["https://codesandbox.io/s/hello-world-1x2y3", "codesandbox"],
      ["https://www.figma.com/file/abc123/Design", "figma"],
      ["https://www.google.com/maps/place/Prague", "google-maps"],
      ["https://excalidraw.com/#json=abc,def", "excalidraw"],
    ]
    for (const [url, type] of permitted) {
      const match = getEmbedDefinition(url)
      expect(match, url).not.toBeNull()
      expect(match!.definition.type).toBe(type)
      expect(match!.embedUrl.startsWith("https://")).toBe(true)
    }
    // Every default definition is reachable by at least one of those urls.
    expect(new Set(permitted.map(([, type]) => type)).size).toBe(DEFAULT_EMBED_DEFINITIONS.length)
  })

  it("keeps the video id and drops the rest of a youtube url", () => {
    expect(getEmbedDefinition("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42")!.embedUrl).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    )
  })

  it("rejects anything not on the list", () => {
    const rejected = [
      // A lookalike host that merely contains a permitted one.
      "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
      "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
      "https://evil.test/?x=https://youtube.com/watch?v=dQw4w9WgXcQ",
      // Not an http(s) url at all.
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      // Not a url.
      "",
      "youtube.com/watch?v=dQw4w9WgXcQ",
      // A permitted host, but not an embeddable page on it.
      "https://www.youtube.com/channel/UCabc",
      "https://www.google.com/search?q=maps",
      "https://vimeo.com/staffpicks",
    ]
    for (const url of rejected) expect(getEmbedDefinition(url), url).toBeNull()
  })

  it("takes an app's own definitions, pushed onto the permit list", () => {
    const before = embedDefinitions.length
    embedDefinitions.push({
      type: "intranet",
      title: "Intranet",
      hostnames: ["wiki.example.test"],
      toEmbedUrl: (url) => `https://wiki.example.test${url.pathname}?embed=1`,
    })
    try {
      const match = getEmbedDefinition("https://wiki.example.test/page")
      expect(match!.definition.type).toBe("intranet")
      expect(match!.embedUrl).toBe("https://wiki.example.test/page?embed=1")
      // Still nothing for a host nobody added.
      expect(getEmbedDefinition("https://wiki.other.test/page")).toBeNull()
    } finally {
      embedDefinitions.length = before
    }
    expect(getEmbedDefinition("https://wiki.example.test/page")).toBeNull()
  })
})

describe("getEmbedInfo", () => {
  it("resolves a shared page url, keeping the url the shape should store", () => {
    const info = getEmbedInfo(DEFAULT_EMBED_DEFINITIONS, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    expect(info?.definition.type).toBe("youtube")
    // The PAGE url, verbatim — the shape stores what a person would share, and
    // the util re-derives the iframe url when it renders.
    expect(info?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    expect(info?.embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")
  })

  it("recovers the page url from an already-embeddable url", () => {
    const embed =
      "https://www.figma.com/embed?embed_host=mocanvas&url=" +
      encodeURIComponent("https://www.figma.com/file/abc/Board")
    const info = getEmbedInfo(DEFAULT_EMBED_DEFINITIONS, embed)
    expect(info?.definition.type).toBe("figma")
    expect(info?.url).toBe("https://www.figma.com/file/abc/Board")
    // Already the form the iframe wants, so it is not wrapped a second time.
    expect(info?.embedUrl).toBe(embed)
  })

  it("answers undefined rather than throwing on input that is not a url at all", () => {
    for (const bad of ["", "   ", "not a url", "javascript:alert(1)", "://///"]) {
      expect(getEmbedInfo(DEFAULT_EMBED_DEFINITIONS, bad), bad).toBeUndefined()
    }
  })

  it("answers undefined for a url outside the list it was handed", () => {
    expect(getEmbedInfo([], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeUndefined()
    expect(getEmbedInfo(DEFAULT_EMBED_DEFINITIONS, "https://example.test/video")).toBeUndefined()
  })

  it("takes the list as an argument, so a picker decides what it accepts", () => {
    const onlyVimeo = DEFAULT_EMBED_DEFINITIONS.filter((d) => d.type === "vimeo")
    expect(getEmbedInfo(onlyVimeo, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeUndefined()
    expect(getEmbedInfo(onlyVimeo, "https://vimeo.com/123456")?.definition.type).toBe("vimeo")
  })
})

describe("EmbedShapeUtil", () => {
  const util = new EmbedShapeUtil(stubEditor())

  it("has the spec defaults", () => {
    expect(util.getDefaultProps()).toEqual({ w: EMBED_WIDTH, h: EMBED_HEIGHT, url: "" })
    expect([EMBED_WIDTH, EMBED_HEIGHT]).toEqual([720, 500])
  })

  it("is a filled box with well-formed path words, drawn by the overlay", () => {
    const shape = makeShape<EmbedShape>("embed", { ...util.getDefaultProps(), w: 400, h: 300 })
    const g = util.getGeometry(shape)
    expectWellFormedPath(g.toPathWords())
    expect([g.bounds.w, g.bounds.h]).toEqual([400, 300])
    expect(util.getRenderStyle(shape)).toBeNull()
    expect(util.canEdit(shape)).toBe(false)
  })

  it("sandboxes an embed to scripts, same-origin and popups only", () => {
    expect(EMBED_SANDBOX.split(" ").sort()).toEqual(["allow-popups", "allow-same-origin", "allow-scripts"])
    expect(EMBED_SANDBOX).not.toContain("allow-top-navigation")
    expect(EMBED_SANDBOX).not.toContain("allow-forms")
  })
})

describe("VideoShapeUtil", () => {
  const editor = stubEditor({ [VIDEO_ASSET_ID]: videoAsset })
  const util = new VideoShapeUtil(editor)

  it("has the spec defaults", () => {
    expect(util.getDefaultProps()).toEqual({
      w: VIDEO_WIDTH,
      h: VIDEO_HEIGHT,
      assetId: null,
      time: 0,
      playing: true,
      url: "",
      altText: "",
    })
    expect([VIDEO_WIDTH, VIDEO_HEIGHT]).toEqual([640, 360])
  })

  it("is a filled box with well-formed path words, drawn by the overlay", () => {
    const shape = makeShape<VideoShape>("video", { ...util.getDefaultProps(), w: 320, h: 180 })
    const g = util.getGeometry(shape)
    expectWellFormedPath(g.toPathWords())
    expect([g.bounds.w, g.bounds.h]).toEqual([320, 180])
    expect(g.isFilled).toBe(true)
    expect(util.getRenderStyle(shape)).toBeNull()
  })

  it("plays the asset's src, and nothing when the asset is missing or not a video", () => {
    const withAsset = makeShape<VideoShape>("video", { ...util.getDefaultProps(), assetId: VIDEO_ASSET_ID })
    expect(getVideoSource(editor, withAsset)).toBe("https://cdn.test/clip.mp4")
    expect(getVideoSource(editor, makeShape<VideoShape>("video", util.getDefaultProps()))).toBeNull()
    expect(getVideoSource(editor, makeShape<VideoShape>("video", { ...util.getDefaultProps(), assetId: createAssetId("gone") }))).toBeNull()
    const bookmarkEditor = stubEditor({ [BOOKMARK_ASSET_ID]: bookmarkAsset })
    expect(getVideoSource(bookmarkEditor, makeShape<VideoShape>("video", { ...util.getDefaultProps(), assetId: BOOKMARK_ASSET_ID }))).toBeNull()
  })

  it("centres the play triangle inside the box", () => {
    const points = getVideoPlayTriangle(320, 180)
    expect(points).toHaveLength(3)
    for (const p of points) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(320)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(180)
    }
    // It shrinks with the box rather than spilling out of a small one.
    for (const p of getVideoPlayTriangle(20, 10)) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(20)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(10)
    }
  })
})

describe("SVG export", () => {
  const editor = stubEditor({ [BOOKMARK_ASSET_ID]: bookmarkAsset, [VIDEO_ASSET_ID]: videoAsset })

  function render(shape: UnknownShape): string {
    const renderer = shapeSvgRenderers.get(shape.type)
    expect(renderer, shape.type).toBeDefined()
    return renderer!(editor, shape, svgContext)
  }

  it("draws a bookmark card as rects and text", () => {
    const util = new BookmarkShapeUtil(editor)
    const svg = render(
      makeShape<BookmarkShape>("bookmark", { ...util.getDefaultProps(), assetId: BOOKMARK_ASSET_ID, url: "https://example.com/page" }),
    )
    expect(svg).toContain("<rect ")
    expect(svg).toContain("Example Domain")
    expect(svg).toContain("example.com")
    // No iframe, video or remote image ever reaches the export.
    expect(svg).not.toContain("<iframe")
    expect(svg).not.toContain("<image")
  })

  it("draws a bookmark with no asset as its host", () => {
    const util = new BookmarkShapeUtil(editor)
    const svg = render(makeShape<BookmarkShape>("bookmark", { ...util.getDefaultProps(), url: "https://lonely.example/x" }))
    expect(svg).toContain("lonely.example")
  })

  it("draws an embed as a placeholder carrying its url", () => {
    const util = new EmbedShapeUtil(editor)
    const known = render(makeShape<EmbedShape>("embed", { ...util.getDefaultProps(), url: "https://vimeo.com/123456789" }))
    expect(known).toContain("<rect ")
    expect(known).toContain("Vimeo")
    expect(known).not.toContain("<iframe")
    const unknown = render(makeShape<EmbedShape>("embed", { ...util.getDefaultProps(), url: "https://unknown.test/thing" }))
    expect(unknown).toContain("unknown.test")
  })

  it("draws a video as a box with a play triangle", () => {
    const util = new VideoShapeUtil(editor)
    const svg = render(makeShape<VideoShape>("video", { ...util.getDefaultProps(), assetId: VIDEO_ASSET_ID, altText: "a clip" }))
    expect(svg).toContain("<rect ")
    expect(svg).toContain("<polygon ")
    expect(svg).toContain("a clip")
    expect(svg).not.toContain("<video")
  })
})
