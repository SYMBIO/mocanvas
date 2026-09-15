import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { Editor, TLComponents, TLUiOverrides, TLUiToolsContextType } from "@mocanvas/editor"
import { useEditorComponents, useIsToolSelected, useTools } from "@mocanvas/editor"
import { DefaultToolbar, MocanvasUiMenuItem } from "./DefaultToolbar"
import { DefaultUi } from "./DefaultUi"
import { buildDefaultToolItems } from "./tools-context"
import { toolKeyMap } from "./useToolShortcuts"

/**
 * A stand-in editor with only what the chrome reads. The real one needs the
 * wasm engine, which none of the override plumbing touches.
 */
function makeEditor(overrides: Partial<Record<string, unknown>> = {}) {
  const calls = { setCurrentTool: vi.fn(), setStyleForNextShapes: vi.fn() }
  const editor = {
    root: { children: { select: {}, hand: {}, draw: {}, eraser: {}, geo: {}, text: {}, note: {} } },
    getCurrentToolId: () => "select",
    getStateDescendant: () => undefined,
    getEditingShapeId: () => null,
    getInstanceState: () => ({ openMenus: [], isReadonly: false }),
    // The chrome mounts the selection announcer, which reads the selection on
    // every render even when this suite only cares about the toolbar.
    getSelectedShapes: () => [],
    getSelectionPageBounds: () => null,
    getShapePageBounds: () => null,
    user: { getIsEnhancedA11yMode: () => false },
    updateInstanceState: () => {},
    getContainer: () => ({ ownerDocument: undefined }),
    setCurrentTool: calls.setCurrentTool,
    setStyleForNextShapes: calls.setStyleForNextShapes,
    ...overrides,
  } as unknown as Editor
  return { editor, calls }
}

/** Render the chrome with everything but the toolbar switched off. */
function renderChrome(opts: { components?: TLComponents; overrides?: TLUiOverrides } = {}): string {
  const { editor } = makeEditor()
  const components: TLComponents = {
    NavigationPanel: null,
    StylePanel: null,
    DebugPanel: null,
    Tooltip: null,
    ...opts.components,
  }
  return renderToStaticMarkup(
    <DefaultUi editor={editor} components={components} {...(opts.overrides ? { overrides: opts.overrides } : {})} showStats={false} />,
  )
}

describe("the default chrome", () => {
  it("renders the registered tools as toolbar buttons", () => {
    const html = renderChrome()
    expect(html).toContain('role="toolbar"')
    expect(html).toContain('data-tool="select"')
    expect(html).toContain('data-tool="note"')
    // `arrow` is optional and this editor does not have it.
    expect(html).not.toContain('data-tool="arrow"')
  })

  it("marks the current tool pressed", () => {
    const html = renderChrome()
    expect(html).toMatch(/data-tool="select"[^>]*aria-pressed="true"/)
    expect(html).toMatch(/data-tool="note"[^>]*aria-pressed="false"/)
  })
})

describe("components overrides", () => {
  it("replaces the default toolbar rather than adding a second one", () => {
    function MyToolbar() {
      return <div data-testid="my-toolbar">mine</div>
    }
    const html = renderChrome({ components: { Toolbar: MyToolbar } })
    expect(html).toContain('data-testid="my-toolbar"')
    expect(html).not.toContain('data-tool="select"')
    expect(html).not.toContain('aria-label="Tools"')
  })

  it("removes a slot set to null and keeps one left alone", () => {
    expect(renderChrome({ components: { Toolbar: null } })).not.toContain('aria-label="Tools"')
    expect(renderChrome()).toContain('aria-label="Tools"')
  })

  it("gives a replacement toolbar the same tool list the default one used", () => {
    const seen: TLUiToolsContextType[] = []
    function MyToolbar() {
      seen.push(useTools())
      return null
    }
    renderChrome({ components: { Toolbar: MyToolbar } })
    expect(Object.keys(seen[0] ?? {})).toContain("select")
    expect(Object.keys(seen[0] ?? {})).toContain("rectangle")
  })
})

describe("tools overrides", () => {
  const commentTool: TLUiOverrides = {
    tools(editor, tools) {
      tools["comment"] = {
        id: "comment",
        label: "Comment",
        icon: "custom-comment-glyph",
        kbd: "c",
        readonlyOk: true,
        onSelect: () => editor.setCurrentTool("comment"),
      }
      return tools
    },
  }

  it("puts a registered custom tool on the default toolbar", () => {
    const html = renderChrome({ overrides: commentTool })
    expect(html).toContain('data-tool="comment"')
    expect(html).toContain('aria-label="Comment"')
    // The override names artwork mocanvas does not ship — the button falls back
    // to the label's initial rather than rendering an empty box.
    expect(html).toContain(">C</span>")
  })

  it("is what `useTools()` reports to a custom toolbar", () => {
    const seen: TLUiToolsContextType[] = []
    function MyToolbar() {
      const tools = useTools()
      seen.push(tools)
      return (
        <DefaultToolbar>
          {["select", "comment", "nope"].map((id) => (
            <ToolItem key={id} id={id} />
          ))}
        </DefaultToolbar>
      )
    }
    function ToolItem({ id }: { id: string }) {
      const tools = useTools()
      const tool = tools[id]
      const isSelected = useIsToolSelected(tool)
      if (!tool) return null
      return <MocanvasUiMenuItem {...tool} isSelected={isSelected} />
    }
    const html = renderChrome({ components: { Toolbar: MyToolbar }, overrides: commentTool })
    expect(seen[0]?.["comment"]?.kbd).toBe("c")
    expect(html).toContain('data-tool="select"')
    expect(html).toContain('data-tool="comment"')
    expect(html).not.toContain('data-tool="nope"')
  })

  it("can rebind a tool's key without dropping its native ones", () => {
    const { editor } = makeEditor()
    const base = buildDefaultToolItems(editor)
    expect(base["note"]?.kbd).toBe("n")
    const chained: TLUiOverrides = {
      tools(_editor, tools) {
        const note = tools["note"]
        if (note) tools["note"] = { ...note, kbd: `${note.kbd},s` }
        return tools
      },
    }
    const after = chained.tools!(editor, base, { msg: (id) => id, insertMedia: () => {} })
    expect(after["note"]?.kbd).toBe("n,s")
  })
})

describe("buildDefaultToolItems", () => {
  it("lists only tools the editor has", () => {
    const { editor } = makeEditor({ root: { children: { select: {}, hand: {} } } })
    expect(Object.keys(buildDefaultToolItems(editor)).sort()).toEqual(["hand", "select"])
  })

  it("selects both the geo tool and the kind for a geo item", () => {
    const { editor, calls } = makeEditor()
    buildDefaultToolItems(editor)["ellipse"]!.onSelect()
    expect(calls.setStyleForNextShapes).toHaveBeenCalled()
    expect(calls.setCurrentTool).toHaveBeenCalledWith("geo", { geo: "ellipse", force: true })
  })

  it("marks select and hand safe on a read-only editor", () => {
    const { editor } = makeEditor()
    const tools = buildDefaultToolItems(editor)
    expect(tools["select"]?.readonlyOk).toBe(true)
    expect(tools["note"]?.readonlyOk).toBeUndefined()
  })
})

describe("toolKeyMap", () => {
  const tools: TLUiToolsContextType = {
    select: { id: "select", label: "Select", icon: "select", kbd: "v", readonlyOk: true, onSelect: () => {} },
    draw: { id: "draw", label: "Draw", icon: "draw", kbd: "d,p,b", onSelect: () => {} },
    undoish: { id: "undoish", label: "Undo", icon: "undo", kbd: "mod+z", onSelect: () => {} },
  }

  it("expands a comma-separated binding into one entry per key", () => {
    const map = toolKeyMap(tools, false)
    expect(map.get("d")).toBe("draw")
    expect(map.get("p")).toBe("draw")
    expect(map.get("b")).toBe("draw")
  })

  it("leaves modifier bindings to the action shortcuts", () => {
    expect(toolKeyMap(tools, false).has("mod+z")).toBe(false)
  })

  it("keeps only readonly-safe tools on a read-only editor", () => {
    const map = toolKeyMap(tools, true)
    expect(map.get("v")).toBe("select")
    expect(map.has("d")).toBe(false)
  })
})

describe("DefaultToolbar overflow", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => (
    <MocanvasUiMenuItem key={id} id={id} label={id.toUpperCase()} icon="select" onSelect={() => {}} />
  ))

  it("keeps minItems + 1 children inline when the budget is pinned", () => {
    // Pinning min === max collapses the width range, so the split is fixed.
    const html = renderToStaticMarkup(
      <DefaultToolbar minItems={2} maxItems={2}>
        {items}
      </DefaultToolbar>,
    )
    for (const id of ["a", "b", "c"]) expect(html, id).toContain(`data-tool="${id}"`)
    // The rest are behind the "more" button, which is closed on first render.
    expect(html).toContain('aria-label="More tools"')
    expect(html).not.toContain('data-tool="d"')
  })

  it("shows no overflow control when everything fits", () => {
    const html = renderToStaticMarkup(
      <DefaultToolbar minItems={20} maxItems={20}>
        {items}
      </DefaultToolbar>,
    )
    expect(html).not.toContain('aria-label="More tools"')
    for (const id of ["a", "b", "c", "d", "e"]) expect(html, id).toContain(`data-tool="${id}"`)
  })
})

/**
 * The canvas is a chrome slot, so that chrome which has to WRAP it — a
 * right-click menu owning the DOM node the browser fires `contextmenu` at —
 * can render it from inside its own trigger.
 */
describe("the Canvas slot", () => {
  const CANVAS = <div data-testid="the-canvas" />

  /** Render the chrome with only the slots under test alive. */
  function renderWithCanvas(opts: { components?: TLComponents; hidePanels?: boolean } = {}): string {
    const { editor } = makeEditor()
    const components: TLComponents = { Toolbar: null, NavigationPanel: null, StylePanel: null, DebugPanel: null, Tooltip: null, ...opts.components }
    return renderToStaticMarkup(
      <DefaultUi editor={editor} canvas={CANVAS} components={components} showStats={false} {...(opts.hidePanels ? { hidePanels: true } : {})} />,
    )
  }

  it("renders the canvas through the slot", () => {
    expect(renderWithCanvas()).toContain('data-testid="the-canvas"')
  })

  it("publishes it on the map, so a slot can render it with `useEditorComponents()`", () => {
    function Menu() {
      const { Canvas } = useEditorComponents()
      return <div data-testid="trigger">{Canvas ? <Canvas /> : null}</div>
    }
    const html = renderWithCanvas({ components: { ContextMenu: Menu } })
    // Inside the trigger, and exactly once — rendering it twice would mount two canvases.
    expect(html).toContain('<div data-testid="trigger"><div data-testid="the-canvas"></div></div>')
    expect(html.match(/the-canvas/g)).toHaveLength(1)
  })

  it("still renders the canvas when the panels are hidden", () => {
    const html = renderWithCanvas({ hidePanels: true })
    expect(html).toContain('data-testid="the-canvas"')
    expect(html).not.toContain('role="toolbar"')
  })

  it("renders nothing for the slot when no canvas was supplied", () => {
    const { editor } = makeEditor()
    const html = renderToStaticMarkup(<DefaultUi editor={editor} components={{ Toolbar: null, NavigationPanel: null, StylePanel: null, DebugPanel: null, Tooltip: null }} showStats={false} />)
    expect(html).not.toContain("the-canvas")
  })
})

describe("the Grid slot", () => {
  const Grid = ({ x, y, z, size }: { x: number; y: number; z: number; size: number }) => (
    <div data-testid="grid" data-camera={`${x},${y},${z}`} data-size={size} />
  )
  const OFF = { Toolbar: null, NavigationPanel: null, StylePanel: null, DebugPanel: null, Tooltip: null }

  function renderGrid(isGridMode: boolean): string {
    const { editor } = makeEditor({
      getInstanceState: () => ({ openMenus: [], isReadonly: false, isGridMode }),
      getCamera: () => ({ x: 12, y: -3, z: 2 }),
      getDocumentSettings: () => ({ gridSize: 40 }),
    })
    return renderToStaticMarkup(<DefaultUi editor={editor} components={{ ...OFF, Grid }} showStats={false} />)
  }

  it("hands the slot the camera and the document's grid step", () => {
    expect(renderGrid(true)).toContain('data-camera="12,-3,2" data-size="40"')
  })

  it("does not mount it while grid mode is off", () => {
    expect(renderGrid(false)).not.toContain('data-testid="grid"')
  })
})
