// @vitest-environment jsdom
import { atom } from "@mocanvas/state"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Editor } from "../editor/Editor"
import type { ShapeId } from "../records/base"
import {
  MocanvasUiProvider,
  useEditorComponents,
  useGlobalMenuIsOpen,
  useIsEditing,
  useIsToolSelected,
  useTools,
} from "./ui-context"
import type { TLUiToolItem, TLUiToolsContextType } from "./ui-types"

// React only flushes `act()` synchronously when it is told it is under test.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * A stand-in editor: only the members the UI hooks read, backed by atoms so
 * the reactive reads in the hooks behave the way they do against the real
 * store. Building a real `Editor` would drag in the wasm engine for no gain —
 * none of these hooks touch it.
 */
function makeEditor() {
  const currentTool = atom("test.currentTool", "select")
  const geoKind = atom("test.geo", "rectangle")
  const editingShapeId = atom<ShapeId | null>("test.editing", null)
  const openMenus = atom<string[]>("test.openMenus", [])
  const isReadonly = atom("test.readonly", false)

  const editor = {
    root: { children: { select: {}, hand: {}, geo: {} } },
    getCurrentToolId: () => currentTool.get(),
    setCurrentTool: (id: string) => currentTool.set(id),
    getStateDescendant: (path: string) => (path === "geo" ? { geo: geoKind.get() } : undefined),
    getEditingShapeId: () => editingShapeId.get(),
    getInstanceState: () => ({ openMenus: openMenus.get(), isReadonly: isReadonly.get() }),
    updateInstanceState: (partial: { openMenus?: string[] }) => {
      if (partial.openMenus) openMenus.set(partial.openMenus)
    },
    getContainer: () => document.body,
  } as unknown as Editor

  return { editor, currentTool, geoKind, editingShapeId, openMenus, isReadonly }
}

let root: Root | null = null
let host: HTMLElement | null = null

function render(node: React.ReactNode): HTMLElement {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(node)
  })
  return host
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
})

const selectItem: TLUiToolItem = { id: "select", label: "Select", icon: "select", onSelect: () => {} }
const ellipseItem: TLUiToolItem = { id: "ellipse", label: "Ellipse", icon: "geo-ellipse", meta: { geo: "ellipse" }, onSelect: () => {} }

describe("useTools", () => {
  it("reflects a tool an override registered", () => {
    const { editor } = makeEditor()
    const onSelect = vi.fn()
    let seen: TLUiToolsContextType = {}
    function Probe() {
      seen = useTools()
      return null
    }
    render(
      <MocanvasUiProvider
        editor={editor}
        defaultTools={() => ({ select: selectItem })}
        overrides={{
          tools: (_editor, tools) => ({ ...tools, comment: { id: "comment", label: "Comment", icon: "comment", kbd: "c", readonlyOk: true, onSelect } }),
        }}
      >
        <Probe />
      </MocanvasUiProvider>,
    )
    expect(Object.keys(seen).sort()).toEqual(["comment", "select"])
    expect(seen["comment"]?.kbd).toBe("c")
    expect(seen["comment"]?.readonlyOk).toBe(true)
    seen["comment"]?.onSelect("toolbar")
    expect(onSelect).toHaveBeenCalledWith("toolbar")
  })

  it("hands the override the editor and the list built so far", () => {
    const { editor } = makeEditor()
    const tools = vi.fn((_e: Editor, t: TLUiToolsContextType) => t)
    render(
      <MocanvasUiProvider editor={editor} defaultTools={() => ({ select: selectItem })} overrides={{ tools }}>
        <div />
      </MocanvasUiProvider>,
    )
    expect(tools).toHaveBeenCalledTimes(1)
    expect(tools.mock.calls[0]![0]).toBe(editor)
    expect(tools.mock.calls[0]![1]).toEqual({ select: selectItem })
  })

  it("is empty outside a provider rather than throwing", () => {
    let seen: TLUiToolsContextType | null = null
    function Probe() {
      seen = useTools()
      return null
    }
    render(<Probe />)
    expect(seen).toEqual({})
  })
})

describe("useIsToolSelected", () => {
  it("tracks tool changes", () => {
    const h = makeEditor()
    const states: boolean[] = []
    function Probe() {
      states.push(useIsToolSelected(selectItem))
      return null
    }
    render(
      <MocanvasUiProvider editor={h.editor}>
        <Probe />
      </MocanvasUiProvider>,
    )
    expect(states.at(-1)).toBe(true)
    act(() => {
      h.currentTool.set("hand")
    })
    expect(states.at(-1)).toBe(false)
    act(() => {
      h.currentTool.set("select")
    })
    expect(states.at(-1)).toBe(true)
  })

  it("needs both the geo tool and the right kind for a geo item", () => {
    const h = makeEditor()
    const states: boolean[] = []
    function Probe() {
      states.push(useIsToolSelected(ellipseItem))
      return null
    }
    render(
      <MocanvasUiProvider editor={h.editor}>
        <Probe />
      </MocanvasUiProvider>,
    )
    expect(states.at(-1)).toBe(false)
    act(() => {
      h.currentTool.set("geo")
    })
    // The geo tool is live, but still set to rectangle.
    expect(states.at(-1)).toBe(false)
    act(() => {
      h.geoKind.set("ellipse")
    })
    expect(states.at(-1)).toBe(true)
  })

  it("accepts an unregistered item, so a button can call it before deciding to render", () => {
    const h = makeEditor()
    let seen: boolean | null = null
    function Probe() {
      seen = useIsToolSelected(undefined)
      return null
    }
    render(
      <MocanvasUiProvider editor={h.editor}>
        <Probe />
      </MocanvasUiProvider>,
    )
    expect(seen).toBe(false)
  })
})

describe("useIsEditing", () => {
  it("tracks the editing shape, by id and in general", () => {
    const h = makeEditor()
    const id = "shape:a" as ShapeId
    const mine: boolean[] = []
    const any: boolean[] = []
    function Probe() {
      mine.push(useIsEditing(id))
      any.push(useIsEditing())
      return null
    }
    render(
      <MocanvasUiProvider editor={h.editor}>
        <Probe />
      </MocanvasUiProvider>,
    )
    expect(mine.at(-1)).toBe(false)
    expect(any.at(-1)).toBe(false)
    act(() => {
      h.editingShapeId.set("shape:b" as ShapeId)
    })
    expect(mine.at(-1)).toBe(false)
    expect(any.at(-1)).toBe(true)
    act(() => {
      h.editingShapeId.set(id)
    })
    expect(mine.at(-1)).toBe(true)
  })
})

describe("useEditorComponents", () => {
  const Default = () => <span>default</span>
  const Custom = () => <span>custom</span>

  it("keeps a default the app did not mention, replaces one it did, and drops a null", () => {
    const { editor } = makeEditor()
    let seen: Record<string, unknown> = {}
    function Probe() {
      seen = useEditorComponents() as unknown as Record<string, unknown>
      return null
    }
    render(
      <MocanvasUiProvider
        editor={editor}
        defaultComponents={{ Toolbar: Default, StylePanel: Default, NavigationPanel: Default }}
        components={{ Toolbar: Custom, StylePanel: null }}
      >
        <Probe />
      </MocanvasUiProvider>,
    )
    expect(seen["Toolbar"]).toBe(Custom)
    expect(seen["StylePanel"]).toBe(null)
    expect(seen["NavigationPanel"]).toBe(Default)
  })
})

describe("useGlobalMenuIsOpen", () => {
  it("registers the menu on the editor and reports it back", () => {
    const h = makeEditor()
    const onChange = vi.fn()
    let api: readonly [boolean, (next: boolean) => void] | null = null
    function Probe() {
      api = useGlobalMenuIsOpen("card-menu", onChange)
      return null
    }
    render(
      <MocanvasUiProvider editor={h.editor}>
        <Probe />
      </MocanvasUiProvider>,
    )
    expect(api![0]).toBe(false)
    act(() => {
      api![1](true)
    })
    expect(h.openMenus.get()).toEqual(["card-menu"])
    expect(api![0]).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith(true)
    act(() => {
      api![1](false)
    })
    expect(h.openMenus.get()).toEqual([])
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it("deregisters the menu when the component unmounts while open", () => {
    const h = makeEditor()
    let api: readonly [boolean, (next: boolean) => void] | null = null
    function Probe() {
      api = useGlobalMenuIsOpen("card-menu")
      return null
    }
    render(
      <MocanvasUiProvider editor={h.editor}>
        <Probe />
      </MocanvasUiProvider>,
    )
    act(() => {
      api![1](true)
    })
    expect(h.openMenus.get()).toEqual(["card-menu"])
    act(() => {
      root!.unmount()
    })
    root = null
    expect(h.openMenus.get()).toEqual([])
  })
})
