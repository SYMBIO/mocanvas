// @vitest-environment jsdom
import { atom } from "@mocanvas/state"
import { EditorProvider, type Editor } from "@mocanvas/editor"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TldrawUi } from "./TldrawUi"
import { TldrawUiContextProvider } from "./ui-context-provider"
import { DEFAULT_TOOLBAR_ITEMS, OverflowingToolbar } from "./toolbar-items"
import { TOOLBAR_GROUPS } from "./toolbar-config"
import { defaultTools } from "../tools"

/**
 * The default toolbar, mounted the way an app mounts it.
 *
 * `<Mocanvas>` renders `TldrawUi`, and `TldrawUi` is what has to publish the
 * tool list the buttons read. Testing `DefaultUi` — which publishes its own —
 * passed while this path shipped a toolbar holding nothing but an overflow
 * chevron, so these tests go through the same component the library does and
 * assert on the buttons a user can actually press.
 */

// React only flushes `act()` synchronously when it is told it is under test.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The navigation panel's minimap paints into a 2d context, which jsdom does not
// implement. It already handles not getting one, so hand it nothing rather than
// let jsdom log a "not implemented" trace per mount.
HTMLCanvasElement.prototype.getContext = () => null

/** Every tool `<Mocanvas>` registers when the app passes no `tools` of its own. */
const DEFAULT_TOOL_IDS = defaultTools.map((tool) => tool.id)

/**
 * A stand-in editor holding exactly what the chrome reads, with the reactive
 * parts backed by atoms so a button press is observable the way it is against
 * the real store. A real `Editor` would need the wasm engine, which none of
 * this touches.
 */
function makeEditor() {
  const currentTool = atom("test.currentTool", "select")
  const geo = atom("test.geo", "rectangle")
  const openMenus = atom<string[]>("test.openMenus", [])
  const setCurrentTool = vi.fn((id: string, info?: { geo?: string }) => {
    currentTool.set(id)
    if (info?.geo) geo.set(info.geo)
  })
  const editor = {
    // What `registeredToolIds` reads: the editor's state chart.
    root: { children: Object.fromEntries(DEFAULT_TOOL_IDS.map((id) => [id, {}])) },
    getCurrentToolId: () => currentTool.get(),
    getStateDescendant: (id: string) => (id === "geo" ? { geo: geo.get() } : undefined),
    setCurrentTool,
    setStyleForNextShapes: vi.fn(),
    getEditingShapeId: () => null,
    getIsReadonly: () => false,
    getIsDisposed: () => false,
    getSelectedShapes: () => [],
    getOnlySelectedShape: () => null,
    getShapePageBounds: () => null,
    getSelectedShapeIds: () => [],
    getCurrentPageShapes: () => [],
    getCurrentPageShapeIds: () => new Set(),
    getPages: () => [{ id: "page:a", name: "Page 1" }],
    getCurrentPageId: () => "page:a",
    getCurrentPage: () => ({ id: "page:a", name: "Page 1" }),
    getCanUndo: () => false,
    getCanRedo: () => false,
    getColorMode: () => "light",
    getZoomLevel: () => 1,
    getCurrentPageBounds: () => null,
    getViewportPageBounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
    getCollaborators: () => [],
    getVisibleCollaboratorsOnCurrentPage: () => [],
    getFollowingUserId: () => null,
    getInstanceState: () => ({
      openMenus: openMenus.get(),
      isReadonly: false,
      isGridMode: false,
      isFocusMode: false,
      isDebugMode: false,
      isToolLocked: false,
      exportBackground: true,
    }),
    updateInstanceState: (partial: { openMenus?: string[] }) => {
      if (partial.openMenus) openMenus.set(partial.openMenus)
    },
    getContainer: () => document.body,
    getContainerDocument: () => document,
    getDocumentSettings: () => ({ gridSize: 20 }),
    getSharedStyles: () => new Map(),
    user: {
      getLocale: () => "en",
      getUserPreferences: () => ({ id: "user:test", locale: "en", animationSpeed: 1, edgeScrollSpeed: 1 }),
      getIsSnapMode: () => false,
      getIsWrapMode: () => false,
      getIsDynamicSizeMode: () => false,
      getIsPasteAtCursorMode: () => false,
      getEdgeScrollSpeed: () => 1,
      getAnimationSpeed: () => 1,
      getAreKeyboardShortcutsEnabled: () => true,
      updateUserPreferences: () => {},
    },
    menus: {
      isMenuOpen: (id: string) => openMenus.get().includes(id),
      getOpenMenus: () => openMenus.get(),
      addOpenMenu: (id: string) => openMenus.set([...openMenus.get(), id]),
      removeOpenMenu: (id: string) => openMenus.set(openMenus.get().filter((menu) => menu !== id)),
    },
    on: () => () => {},
    off: () => {},
  } as unknown as Editor
  return { editor, setCurrentTool, currentTool }
}

let root: Root | null = null
let host: HTMLElement | null = null

/** Mount the default chrome, the way `<Mocanvas>` does. */
function renderChrome(): { el: HTMLElement; editor: ReturnType<typeof makeEditor> } {
  const parts = makeEditor()
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <EditorProvider editor={parts.editor}>
        <TldrawUi />
      </EditorProvider>,
    )
  })
  return { el: host, editor: parts }
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
})

/** The toolbar's buttons, keyed by the tool each one selects. */
function toolButtons(el: HTMLElement): Map<string, HTMLButtonElement> {
  const bar = el.querySelector('[role="toolbar"][aria-label="Tools"]')
  expect(bar, "the default chrome renders no toolbar at all").not.toBeNull()
  const found = new Map<string, HTMLButtonElement>()
  for (const button of Array.from(bar!.querySelectorAll<HTMLButtonElement>("button[data-tool]"))) {
    found.set(button.dataset["tool"]!, button)
  }
  return found
}

describe("the default toolbar", () => {
  it("renders a button for every tool the library registers by default", () => {
    const { el } = renderChrome()
    const buttons = toolButtons(el)

    // Toolbar entries name the *editor* tool they drive; the five geo kinds on
    // the bar all drive `geo`. Map the buttons back through the config so the
    // assertion is "every default tool is reachable", not "these ids exist".
    const entryToTool = new Map(TOOLBAR_GROUPS.flat().map((item) => [item.id, item.tool]))
    const reachable = new Set([...buttons.keys()].map((id) => entryToTool.get(id) ?? id))

    for (const id of DEFAULT_TOOL_IDS) {
      expect(reachable, `no toolbar button selects the "${id}" tool`).toContain(id)
    }
    // And they are all really there, not one button and a chevron.
    expect(buttons.size).toBeGreaterThanOrEqual(DEFAULT_TOOL_IDS.length)
  })

  it("gives every button an accessible name", () => {
    const { el } = renderChrome()
    const bar = el.querySelector('[role="toolbar"][aria-label="Tools"]')!
    for (const button of Array.from(bar.querySelectorAll("button"))) {
      expect(button.getAttribute("aria-label"), button.outerHTML).toBeTruthy()
    }
  })

  it("switches the editor's current tool when a button is pressed", () => {
    const { el, editor } = renderChrome()
    const draw = toolButtons(el).get("draw")!
    act(() => {
      draw.click()
    })
    expect(editor.setCurrentTool).toHaveBeenCalledWith("draw")
    expect(editor.currentTool.get()).toBe("draw")
    // The press is reflected back out of the editor, not held in the button.
    expect(toolButtons(el).get("draw")!.getAttribute("aria-pressed")).toBe("true")
    expect(toolButtons(el).get("select")!.getAttribute("aria-pressed")).toBe("false")
  })

  it("selects the kind as well as the tool for a geo button", () => {
    const { el, editor } = renderChrome()
    act(() => {
      toolButtons(el).get("ellipse")!.click()
    })
    expect(editor.setCurrentTool).toHaveBeenCalledWith("geo", { geo: "ellipse", force: true })
    expect(toolButtons(el).get("ellipse")!.getAttribute("aria-pressed")).toBe("true")
    expect(toolButtons(el).get("rectangle")!.getAttribute("aria-pressed")).toBe("false")
  })
})

/**
 * The overflow popover only earns its place once the bar has more than it can
 * show. It shipped as the *only* thing in the toolbar: an unnamed chevron
 * opening an empty strip, because every child it was hiding rendered nothing.
 */
describe("the toolbar's overflow", () => {
  /** Render a bar with a forced split, and return its plate. */
  function renderSplit(inline: number): HTMLElement {
    const parts = makeEditor()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(
        <EditorProvider editor={parts.editor}>
          <TldrawUiContextProvider>
            <OverflowingToolbar maxInline={inline}>{DEFAULT_TOOLBAR_ITEMS}</OverflowingToolbar>
          </TldrawUiContextProvider>
        </EditorProvider>,
      )
    })
    return host
  }

  it("shows no overflow control while everything fits", () => {
    const el = renderSplit(DEFAULT_TOOLBAR_ITEMS.length)
    expect(el.querySelector('button[aria-label="More tools"]')).toBeNull()
  })

  it("names the overflow control and hands it the buttons that did not fit", () => {
    const el = renderSplit(3)
    const inline = [...toolButtons(el).keys()]
    expect(inline).toEqual(["select", "hand", "draw"])

    const more = el.querySelector<HTMLButtonElement>('button[aria-label="More tools"]')
    expect(more, "a bar that hides buttons must offer a way to reach them").not.toBeNull()
    expect(more!.getAttribute("aria-expanded")).toBe("false")

    // The panel is portalled out of the bar, so look for it in the document.
    act(() => {
      more!.click()
    })
    expect(more!.getAttribute("aria-expanded")).toBe("true")
    const panel = document.querySelector(".mocanvas-toolbar-overflow")
    expect(panel, "the overflow panel is empty").not.toBeNull()
    const hidden = Array.from(panel!.querySelectorAll<HTMLButtonElement>("button[data-tool]")).map((b) => b.dataset["tool"])
    expect(hidden).toContain("rectangle")
    expect(hidden).toContain("eraser")
    for (const id of inline) expect(hidden).not.toContain(id)

    act(() => {
      more!.click()
    })
    expect(more!.getAttribute("aria-expanded")).toBe("false")
    expect(document.querySelector(".mocanvas-toolbar-overflow")).toBeNull()
  })

  it("closes itself once a tool in it is picked", () => {
    const el = renderSplit(3)
    const more = el.querySelector<HTMLButtonElement>('button[aria-label="More tools"]')!
    act(() => {
      more.click()
    })
    const star = document.querySelector<HTMLButtonElement>('.mocanvas-toolbar-overflow button[data-tool="star"]')!
    act(() => {
      star.click()
    })
    expect(document.querySelector(".mocanvas-toolbar-overflow"), "the overflow stayed open over the canvas").toBeNull()
    expect(more.getAttribute("aria-expanded")).toBe("false")
  })
})
