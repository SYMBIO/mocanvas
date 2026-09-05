import { describe, expect, it } from "vitest"
import { createAssetId, createShapeId, type Editor, type PageId, type UnknownShape, type VideoAsset } from "@mocanvas/editor"
import type { IndexKey } from "@mocanvas/store"
import type { ReactElement } from "react"
import {
  DEFAULT_EMBED_DEFINITIONS,
  EmbedShapeUtil,
  getEmbedDefinition,
  getEmbedInfo,
  isVideoAutoplayAllowed,
  VideoShapeUtil,
  type EmbedDefinition,
  type EmbedShape,
  type VideoShape,
} from "./index"

const VIDEO_ASSET_ID = createAssetId("vid-opt")

const videoAsset: VideoAsset = {
  id: VIDEO_ASSET_ID,
  typeName: "asset",
  type: "video",
  props: { w: 640, h: 360, name: "clip.mp4", isAnimated: true, mimeType: "video/mp4", src: "https://cdn.test/clip.mp4" },
  meta: {},
}

function stubEditor(options?: Record<string, unknown>): Editor {
  return {
    getEditingShapeId: () => null,
    getAsset: (id: string) => (id === VIDEO_ASSET_ID ? videoAsset : undefined),
    ...(options ? { options } : {}),
  } as unknown as Editor
}

function makeShape<T extends UnknownShape>(type: T["type"], props: T["props"]): T {
  return {
    id: createShapeId(`opt-${type}`),
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

/** A private service whose embed url is only buildable with a configured key. */
const intranet: EmbedDefinition = {
  type: "intranet",
  title: "Intranet",
  hostnames: ["wiki.example.test"],
  toEmbedUrl(url, settings) {
    const key = settings?.["apiKey"]
    if (typeof key !== "string" || key === "") return null
    return `https://wiki.example.test${url.pathname}?key=${encodeURIComponent(key)}`
  },
}

/** A service whose player has a fixed shape. */
const widescreen: EmbedDefinition = {
  type: "widescreen",
  title: "Widescreen",
  hostnames: ["clips.example.test"],
  toEmbedUrl: (url) => `https://clips.example.test${url.pathname}?embed=1`,
  sizeToContentAspectRatio: 16 / 9,
}

describe("embedConfig", () => {
  it("hands a definition its own settings, and nothing else's", () => {
    const config = { intranet: { apiKey: "s3cret" }, other: { apiKey: "wrong" } }
    const match = getEmbedDefinition("https://wiki.example.test/page", [intranet], config)
    expect(match?.embedUrl).toBe("https://wiki.example.test/page?key=s3cret")
  })

  it("leaves a definition unconfigured when the app configured nothing for it", () => {
    expect(getEmbedDefinition("https://wiki.example.test/page", [intranet])).toBeNull()
    expect(getEmbedDefinition("https://wiki.example.test/page", [intranet], { elsewhere: { apiKey: "x" } })).toBeNull()
  })

  it("reaches the two-way resolver as well", () => {
    const info = getEmbedInfo([intranet], "https://wiki.example.test/page", { intranet: { apiKey: "k" } })
    expect(info?.embedUrl).toBe("https://wiki.example.test/page?key=k")
    expect(getEmbedInfo([intranet], "https://wiki.example.test/page")).toBeUndefined()
  })

  it("is empty rather than undefined on an unconfigured util, so a definition can index it", () => {
    expect(new EmbedShapeUtil(stubEditor()).embedConfig).toEqual({})
  })

  it("is what `configure` sets, without touching the original util", () => {
    const Configured = EmbedShapeUtil.configure({
      embedDefinitions: [intranet],
      embedConfig: { intranet: { apiKey: "from-config" } },
    })
    const util = new Configured(stubEditor())
    expect(util.embedConfig).toEqual({ intranet: { apiKey: "from-config" } })
    expect(util.getEmbedDefinitions()).toEqual([intranet])
    const shape = makeShape<EmbedShape>("embed", { w: 720, h: 500, url: "https://wiki.example.test/page" })
    expect(util.getEmbedMatch(shape)?.embedUrl).toBe("https://wiki.example.test/page?key=from-config")

    // The unconfigured util still uses the module-level permit list.
    expect(new EmbedShapeUtil(stubEditor()).embedConfig).toEqual({})
    expect(new EmbedShapeUtil(stubEditor()).getEmbedMatch(shape)).toBeNull()
  })
})

describe("EmbedShapeUtil.resolveAspectRatio", () => {
  const Configured = EmbedShapeUtil.configure({ embedDefinitions: [widescreen, intranet] })
  const util = new Configured(stubEditor())

  it("reports the ratio the matching service declared", () => {
    const shape = makeShape<EmbedShape>("embed", { w: 720, h: 500, url: "https://clips.example.test/abc" })
    expect(util.resolveAspectRatio(shape)).toBeCloseTo(16 / 9, 10)
  })

  it("has no opinion about a service that declared none, or a url off the list", () => {
    expect(util.resolveAspectRatio(makeShape<EmbedShape>("embed", { w: 1, h: 1, url: "https://wiki.example.test/p" }))).toBeUndefined()
    expect(util.resolveAspectRatio(makeShape<EmbedShape>("embed", { w: 1, h: 1, url: "https://nope.test/x" }))).toBeUndefined()
    expect(util.resolveAspectRatio(makeShape<EmbedShape>("embed", { w: 1, h: 1, url: "" }))).toBeUndefined()
  })

  it("no built-in service declares one, so nothing is resized behind an app's back", () => {
    for (const definition of DEFAULT_EMBED_DEFINITIONS) {
      expect(definition.sizeToContentAspectRatio, definition.type).toBeUndefined()
    }
  })

  it("sizes a new shape to the declared ratio, keeping the width it was given", () => {
    const shape = makeShape<EmbedShape>("embed", { w: 640, h: 500, url: "https://clips.example.test/abc" })
    const next = util.onBeforeCreate(shape)
    expect(next?.props.h).toBeCloseTo(360, 6)
    expect(next?.props.w).toBe(640)
  })

  it("leaves a shape alone when no ratio is declared", () => {
    expect(util.onBeforeCreate(makeShape<EmbedShape>("embed", { w: 640, h: 500, url: "https://nope.test/x" }))).toBeUndefined()
  })

  it("locks the aspect ratio exactly where one was declared", () => {
    expect(util.isAspectRatioLocked(makeShape<EmbedShape>("embed", { w: 1, h: 1, url: "https://clips.example.test/a" }))).toBe(true)
    expect(util.isAspectRatioLocked(makeShape<EmbedShape>("embed", { w: 1, h: 1, url: "https://nope.test/a" }))).toBe(false)
  })
})

describe("allowVideoAutoplay", () => {
  it("defaults to allowed, including for an editor carrying no options at all", () => {
    expect(isVideoAutoplayAllowed(stubEditor())).toBe(true)
    expect(isVideoAutoplayAllowed(stubEditor({}))).toBe(true)
    expect(isVideoAutoplayAllowed(stubEditor({ allowVideoAutoplay: true }))).toBe(true)
    expect(isVideoAutoplayAllowed(null)).toBe(true)
  })

  it("is off only when the editor asked for it to be off", () => {
    expect(isVideoAutoplayAllowed(stubEditor({ allowVideoAutoplay: false }))).toBe(false)
  })

  /** The `<VideoPlayer>` element the util rendered, whatever it wrapped it in. */
  function player(node: React.ReactNode): ReactElement<{ playing: boolean }> {
    return (node as ReactElement<{ children: ReactElement<{ playing: boolean }> }>).props.children
  }

  it("does not start a video when autoplay is off, however the shape is marked", () => {
    const util = new VideoShapeUtil(stubEditor({ allowVideoAutoplay: false }))
    const shape = makeShape<VideoShape>("video", { ...util.getDefaultProps(), assetId: VIDEO_ASSET_ID, playing: true })
    expect(player(util.component(shape)).props.playing).toBe(false)
  })

  it("still honours a paused shape when autoplay is on", () => {
    const util = new VideoShapeUtil(stubEditor())
    const base = { ...util.getDefaultProps(), assetId: VIDEO_ASSET_ID }
    expect(player(util.component(makeShape<VideoShape>("video", { ...base, playing: true }))).props.playing).toBe(true)
    expect(player(util.component(makeShape<VideoShape>("video", { ...base, playing: false }))).props.playing).toBe(false)
  })
})
