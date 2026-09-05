// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createStore, Editor, loadEngineSync, StateNode, type Asset } from "@mocanvas/editor"
import { defaultShapeUtils } from "../shapes"
import { defaultBindingUtils } from "../bindings"
import { defaultAssetUtils } from "../assets"
import {
  defaultHandleExternalEmbedContent,
  defaultHandleExternalSvgTextContent,
  defaultHandleExternalTextContent,
  defaultHandleExternalTldrawContent,
  defaultHandleExternalUrlAsset,
} from "./defaultHandlers"
import { createBookmarkFromUrl } from "./bookmarks"
import type { TLDefaultExternalContentHandlerOpts } from "./handler-options"

// Resolved from the working directory rather than from `import.meta.url`:
// under the jsdom environment the module url is not a `file:` url, so
// `fileURLToPath` cannot be used here.
const wasmPath = ["packages/wasm/pkg/mocanvas_bg.wasm", "../wasm/pkg/mocanvas_bg.wasm"]
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate))!

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor(): Editor {
  const editor = new Editor({
    store: createStore(),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [TestTool],
    engine: loadEngineSync(readFileSync(wasmPath)),
    getContainer: () => ({}) as HTMLElement,
    assetUtils: defaultAssetUtils,
  })
  editor.updateViewportScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
  return editor
}

const opts: TLDefaultExternalContentHandlerOpts = {
  toasts: { addToast: vi.fn(() => "id"), removeToast: vi.fn(), clearToasts: vi.fn(), toasts: [] },
  msg: (id: string) => id,
}

describe("defaultHandleExternalTextContent", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("creates one text shape", async () => {
    await defaultHandleExternalTextContent(editor, { text: "hello", point: { x: 0, y: 0 } })
    expect(editor.getCurrentPageShapes().filter((s) => s.type === "text")).toHaveLength(1)
  })

  it("ignores whitespace", async () => {
    await defaultHandleExternalTextContent(editor, { text: "   \n  " })
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
  })
})

describe("defaultHandleExternalSvgTextContent", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("creates an image shape from svg markup", async () => {
    await defaultHandleExternalSvgTextContent(editor, {
      text: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>',
      point: { x: 0, y: 0 },
    })
    expect(editor.getCurrentPageShapes().filter((s) => s.type === "image")).toHaveLength(1)
  })

  it("drops markup the sanitizer rejects entirely", async () => {
    await defaultHandleExternalSvgTextContent(editor, { text: "<html><body>not svg</body></html>" })
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
  })

  it("strips a script before storing the asset", async () => {
    await defaultHandleExternalSvgTextContent(editor, {
      text: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
    })
    const asset = editor.getAssets()[0]!
    expect(decodeURIComponent((asset.props as { src: string }).src)).not.toContain("script")
  })
})

describe("defaultHandleExternalEmbedContent", () => {
  it("creates an embed shape for a permitted url", async () => {
    const editor = makeEditor()
    await defaultHandleExternalEmbedContent(editor, { url: "https://www.youtube.com/watch?v=abc", point: { x: 0, y: 0 } })
    expect(editor.getCurrentPageShapes().filter((s) => s.type === "embed")).toHaveLength(1)
  })
})

describe("defaultHandleExternalTldrawContent", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("puts our own clipboard content back onto the page", async () => {
    const source = makeEditor()
    source.createShape({ type: "geo", x: 0, y: 0, props: { w: 10, h: 10 } } as never)
    const content = source.getContentFromCurrentPage([...source.getCurrentPageShapeIds()])

    await defaultHandleExternalTldrawContent(editor, { content, point: { x: 100, y: 100 } })
    expect(editor.getCurrentPageShapes()).toHaveLength(1)
  })

  it("ignores content with no shapes", async () => {
    await defaultHandleExternalTldrawContent(editor, { content: { nope: true } })
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
  })
})

describe("defaultHandleExternalUrlAsset", () => {
  it("prefers whatever asset handler the app registered", async () => {
    const editor = makeEditor()
    const own: Asset = {
      id: "asset:custom" as Asset["id"],
      typeName: "asset",
      type: "bookmark",
      props: { title: "T", description: "D", image: "", favicon: "", src: "https://example.com" },
      meta: {},
    }
    editor.registerExternalAssetHandler("url", () => own)
    expect(await defaultHandleExternalUrlAsset(editor, { type: "url", url: "https://example.com" }, opts)).toBe(own)
  })

  it("falls back to a bare bookmark asset, making no request of its own", async () => {
    const editor = makeEditor()
    const asset = await defaultHandleExternalUrlAsset(editor, { type: "url", url: "https://example.com" }, opts)
    expect(asset?.type).toBe("bookmark")
    expect((asset?.props as { src: string }).src).toBe("https://example.com")
    expect((asset?.props as { title: string }).title).toBe("")
  })
})

describe("createBookmarkFromUrl", () => {
  let editor: Editor
  beforeEach(() => {
    editor = makeEditor()
  })

  it("creates the card and returns the shape", async () => {
    const result = await createBookmarkFromUrl(editor, { url: "https://example.com", center: { x: 0, y: 0 } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.type).toBe("bookmark")
    expect(result.value.props.url).toBe("https://example.com")
  })

  it("refuses an unparseable url", async () => {
    const result = await createBookmarkFromUrl(editor, { url: "not a url" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/Could not parse/)
  })

  it("refuses a scheme that is not http(s)", async () => {
    const result = await createBookmarkFromUrl(editor, { url: "javascript:alert(1)" })
    expect(result.ok).toBe(false)
  })

  it("refuses an empty url", async () => {
    expect((await createBookmarkFromUrl(editor, { url: "  " })).ok).toBe(false)
  })

  it("still creates the card when the unfurl throws", async () => {
    editor.registerExternalAssetHandler("url", () => {
      throw new Error("no network")
    })
    const result = await createBookmarkFromUrl(editor, { url: "https://example.com" })
    expect(result.ok).toBe(true)
  })

  it("stores the asset when an unfurl succeeds", async () => {
    editor.registerExternalAssetHandler("url", () => ({
      id: "asset:unfurled" as Asset["id"],
      typeName: "asset",
      type: "bookmark",
      props: { title: "Example", description: "", image: "", favicon: "", src: "https://example.com" },
      meta: {},
    }))
    const result = await createBookmarkFromUrl(editor, { url: "https://example.com" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.props.assetId).toBe("asset:unfurled")
  })
})
