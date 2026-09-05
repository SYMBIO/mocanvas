import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { loadEngineSync, type StyleWords } from "@mocanvas/wasm"
import { Editor } from "../Editor"
import { createStore } from "../createStore"
import { Rectangle2d } from "../../geometry"
import type { BaseShape } from "../../records/base"
import { BaseBoxShapeUtil } from "../../shapes/ShapeUtil"
import { StateNode } from "../../tools/StateNode"
import { createCurrentUser, getFreshUserPreferences } from "../../user"
import type { AssetStore } from "../../assets"
import { DEFAULT_THEME } from "../../theme"

/**
 * The options an app configures an editor with: where assets live, who is
 * using it, which theme, and the rich-text stack.
 */

const wasmPath = fileURLToPath(new URL("../../../../wasm/pkg/mocanvas_bg.wasm", import.meta.url))

type BoxShape = BaseShape<"box", { w: number; h: number }>

class BoxUtil extends BaseBoxShapeUtil<BoxShape> {
  static override type = "box" as const
  override getDefaultProps() {
    return { w: 100, h: 100 }
  }
  override getGeometry(shape: BoxShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
  override component() {
    return null
  }
  override indicator() {
    return null
  }
  override getRenderStyle(): StyleWords {
    return { fill: 0, stroke: 0, strokeWidth: 0, dash: 0, opacity: 1 }
  }
}

class TestTool extends StateNode {
  static override id = "test"
}

function makeEditor(opts: Partial<ConstructorParameters<typeof Editor>[0]> = {}): Editor {
  const engine = loadEngineSync(readFileSync(wasmPath))
  return new Editor({
    store: createStore(),
    shapeUtils: [BoxUtil],
    tools: [TestTool],
    engine,
    getContainer: () => ({}) as HTMLElement,
    ...opts,
  })
}

const assetStore = (): AssetStore => ({ upload: vi.fn(async () => ({ src: "/uploaded" })), resolve: vi.fn(() => null), remove: vi.fn(async () => undefined) })

describe("createStore assets", () => {
  it("keeps the supplied store by identity, so a caller can compare against what it passed", () => {
    const assets = assetStore()
    const store = createStore({ assets })
    expect(store.props.assets).toBe(assets)
    expect(store.props.assets.upload).toBe(assets.upload)
  })

  it("always has one, so `store.props.assets.upload` is never a null check", () => {
    expect(typeof createStore().props.assets.upload).toBe("function")
  })
})

describe("Editor assets", () => {
  it("takes the store's asset store by default", () => {
    const assets = assetStore()
    const editor = makeEditor({ store: createStore({ assets }) })
    expect(editor.assets).toBe(assets)
    editor.dispose()
  })

  it("lets an explicit option win over the store's", () => {
    const own = assetStore()
    const editor = makeEditor({ store: createStore({ assets: assetStore() }), assets: own })
    expect(editor.assets).toBe(own)
    editor.dispose()
  })
})

describe("Editor user", () => {
  it("reads and writes preferences through a controlled user", () => {
    const user = createCurrentUser({ ...getFreshUserPreferences(), name: "Ada", locale: "cs" })
    const editor = makeEditor({ user })
    expect(editor.user.getLocale()).toBe("cs")

    editor.user.updateUserPreferences({ name: "Grace" })
    // The write went to the app's holder, not to a copy the app cannot see.
    expect(user.userPreferences.get().name).toBe("Grace")
    editor.dispose()
  })

  it("uses the editor-level colorScheme only as a fallback the user can override", () => {
    const dark = makeEditor({ colorScheme: "dark" })
    expect(dark.user.getColorScheme()).toBe("dark")

    const controlled = makeEditor({
      colorScheme: "dark",
      user: createCurrentUser({ ...getFreshUserPreferences(), colorScheme: "light" }),
    })
    expect(controlled.user.getColorScheme()).toBe("light")
    dark.dispose()
    controlled.dispose()
  })
})

describe("Editor theme options", () => {
  it("starts in the theme and colour scheme it was configured with", () => {
    const brand = { ...DEFAULT_THEME, id: "brand", lineHeight: 2 }
    const editor = makeEditor({ themes: { brand }, initialTheme: "brand", colorScheme: "dark" })
    expect(editor.theme.getCurrentThemeId()).toBe("brand")
    expect(editor.theme.getCurrentTheme().lineHeight).toBe(2)
    expect(editor.theme.getColorMode()).toBe("dark")
    editor.dispose()
  })
})

describe("Editor textOptions", () => {
  const config = { tipTapConfig: { extensions: [{ name: "custom" }] } }

  it("accepts the top-level spelling", () => {
    const editor = makeEditor({ textOptions: config })
    expect(editor.textOptions).toBe(config)
    editor.dispose()
  })

  it("accepts the consolidated `options.text` spelling", () => {
    const editor = makeEditor({ options: { text: config } })
    expect(editor.textOptions).toBe(config)
    editor.dispose()
  })

  it("is undefined when neither was given", () => {
    const editor = makeEditor()
    expect(editor.textOptions).toBeUndefined()
    editor.dispose()
  })
})

describe("Editor focus", () => {
  it("focuses and blurs the container without scrolling the page under it", () => {
    // `ownerDocument` is what marks it as a real DOM node — the editor refuses to touch anything else.
    const container = { focus: vi.fn(), blur: vi.fn(), ownerDocument: {} } as unknown as HTMLElement
    const editor = makeEditor({ getContainer: () => container })
    editor.focus()
    expect(container.focus).toHaveBeenCalledWith({ preventScroll: true })
    editor.blur()
    expect(container.blur).toHaveBeenCalled()
    editor.dispose()
  })

  it("is a no-op on a headless editor rather than a crash", () => {
    const editor = makeEditor({
      getContainer: () => {
        throw new Error("torn down")
      },
    })
    expect(() => editor.focus().blur()).not.toThrow()
    editor.dispose()
  })
})
