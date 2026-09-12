// @vitest-environment jsdom
import { atom } from "@mocanvas/state"
import type { Editor } from "@mocanvas/editor"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { KEYBOARD_SHORTCUTS, buildShortcutIndex, normalizeKbd, useKeyboardShortcuts } from "./useKeyboardShortcuts"
import { toolKeyMap, ToolShortcuts } from "./useToolShortcuts"
import { ActionShortcuts, actionKeyMap } from "./useActionShortcuts"
import { buildDefaultActionItems } from "./tools-context"
import { MocanvasUiProvider, useActions, type TLUiActionsContextType } from "@mocanvas/editor"

/**
 * The shortcut table has to be *true*.
 *
 * The keyboard-shortcuts dialog is rendered straight from this table, and a
 * row it prints is a promise that the key does something. So the test is not
 * "the table has entries" — it is "press every key in the table and watch it
 * fire". A binding that is deleted from the handler but left in the table
 * fails here rather than shipping as a lie in the sheet.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Just enough editor for the handler's guards. */
function makeEditor() {
  const editing = atom<string | null>("test.editing", null)
  return {
    getEditingShapeId: () => editing.get(),
    getSelectedShapeIds: () => [],
    getInstanceState: () => ({ isGridMode: false, isFocusMode: false, isToolLocked: false }),
    updateInstanceState: vi.fn(),
    root: { children: { select: {}, hand: {}, draw: {} } },
    setCurrentTool: vi.fn(),
  } as unknown as Editor
}

/** The action list reaches for more of the editor than the table's guards do. */
function makeActionEditor(): Editor {
  const base = makeEditor() as unknown as Record<string, unknown>
  return {
    ...base,
    getSelectedShapeIds: () => ["shape:a", "shape:b"],
    getSelectedShapes: () => [{ id: "shape:a" }, { id: "shape:b" }],
    getInstanceState: () => ({ isGridMode: false, isFocusMode: false, isToolLocked: false, isReadonly: false }),
    alignShapes: vi.fn(),
    distributeShapes: vi.fn(),
    stackShapes: vi.fn(),
    stretchShapes: vi.fn(),
    flipShapes: vi.fn(),
    packShapes: vi.fn(),
    bringToFront: vi.fn(),
    bringForward: vi.fn(),
    sendBackward: vi.fn(),
    sendToBack: vi.fn(),
    toggleLock: vi.fn(),
    groupShapes: vi.fn(),
    ungroupShapes: vi.fn(),
    duplicateShapes: vi.fn(() => []),
    deleteShapes: vi.fn(),
    setSelectedShapes: vi.fn(),
    selectAll: vi.fn(),
    selectNone: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    zoomToFit: vi.fn(),
    zoomToSelection: vi.fn(),
    markHistoryStoppingPoint: vi.fn(),
    getCurrentPageShapeIds: () => new Set(["shape:a"]),
    user: { getLocale: () => "en" },
  } as unknown as Editor
}

let root: Root | null = null
let host: HTMLElement | null = null

/** Mount the bindings the way a component does. */
function bind(editor: Editor, options: { tools?: boolean } = {}): void {
  function Probe() {
    useKeyboardShortcuts(editor, options)
    return null
  }
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(<Probe />)
  })
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
  vi.restoreAllMocks()
})

/** Turn `"mod+shift+z"` into the keydown a browser would send. */
function keyEventFor(kbd: string): KeyboardEvent {
  const parts = kbd.split("+").map((p) => p.trim().toLowerCase())
  const key = kbd.trim().endsWith("+") ? "+" : (parts.pop() ?? "")
  const set = new Set(parts)
  const code = /^[a-z]$/.test(key)
    ? `Key${key.toUpperCase()}`
    : /^[0-9]$/.test(key)
      ? `Digit${key}`
      : ({ "=": "Equal", "-": "Minus", "[": "BracketLeft", "]": "BracketRight", "'": "Quote", ".": "Period" })[key] ?? ""
  return new KeyboardEvent("keydown", {
    key,
    code,
    // jsdom reports no platform, so the hook treats ctrl as the accelerator.
    ctrlKey: set.has("mod"),
    altKey: set.has("alt"),
    shiftKey: set.has("shift"),
    bubbles: true,
    cancelable: true,
  })
}

describe("the keyboard shortcut table", () => {
  it("binds every shortcut it declares", () => {
    bind(makeEditor(), { tools: false })
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      const spy = vi.spyOn(shortcut, "run").mockImplementation(() => undefined)
      window.dispatchEvent(keyEventFor(shortcut.kbd))
      expect(spy, `pressing "${shortcut.kbd}" did not run "${shortcut.id}"`).toHaveBeenCalledTimes(1)
      spy.mockRestore()
    }
  })

  it("binds the alternative spellings too", () => {
    bind(makeEditor(), { tools: false })
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      for (const alias of shortcut.also ?? []) {
        const spy = vi.spyOn(shortcut, "run").mockImplementation(() => undefined)
        window.dispatchEvent(keyEventFor(alias))
        expect(spy, `pressing "${alias}" did not run "${shortcut.id}"`).toHaveBeenCalledTimes(1)
        spy.mockRestore()
      }
    }
  })

  it("really changes the editor, not just the table", () => {
    const editor = makeEditor()
    bind(editor, { tools: false })
    window.dispatchEvent(keyEventFor("mod+'"))
    expect(editor.updateInstanceState).toHaveBeenCalledWith({ isGridMode: true })
    window.dispatchEvent(keyEventFor("mod+."))
    expect(editor.updateInstanceState).toHaveBeenCalledWith({ isFocusMode: true })
  })

  it("does not fire while the user is typing", () => {
    bind(makeEditor(), { tools: false })
    const field = document.createElement("input")
    document.body.appendChild(field)
    const undo = KEYBOARD_SHORTCUTS.find((s) => s.id === "undo")!
    const spy = vi.spyOn(undo, "run").mockImplementation(() => undefined)
    field.dispatchEvent(keyEventFor("mod+z"))
    expect(spy).not.toHaveBeenCalled()
    field.remove()
  })

  it("gives no two shortcuts the same binding", () => {
    const seen = new Map<string, string>()
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      for (const binding of [shortcut.kbd, ...(shortcut.also ?? [])]) {
        const normalized = normalizeKbd(binding)
        const owner = seen.get(normalized)
        expect(owner, `"${binding}" is claimed by both "${owner}" and "${shortcut.id}"`).toBeUndefined()
        seen.set(normalized, shortcut.id)
      }
    }
    expect(buildShortcutIndex().size).toBe(seen.size)
  })

  it("leaves the plain keys the tool list uses alone", () => {
    // Both sets are installed at once — this table by `useKeyboardShortcuts`
    // and the tools by `useToolShortcuts` — so an overlap would fire twice.
    const tools = toolKeyMap(
      {
        select: { id: "select", label: "Select", icon: "select", kbd: "v", onSelect: () => {} },
        hand: { id: "hand", label: "Hand", icon: "hand", kbd: "h", onSelect: () => {} },
        draw: { id: "draw", label: "Draw", icon: "draw", kbd: "d,p,b", onSelect: () => {} },
        eraser: { id: "eraser", label: "Eraser", icon: "eraser", kbd: "e", onSelect: () => {} },
        text: { id: "text", label: "Text", icon: "text", kbd: "t", onSelect: () => {} },
      },
      false,
    )
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      const normalized = normalizeKbd(shortcut.kbd)
      if (normalized.includes("+")) continue
      expect(tools.has(normalized), `"${shortcut.kbd}" is claimed by a tool as well`).toBe(false)
    }
  })

  it("switches tools only when asked to bind them", () => {
    const withTools = makeEditor()
    bind(withTools, { tools: true })
    window.dispatchEvent(keyEventFor("h"))
    expect(withTools.setCurrentTool).toHaveBeenCalledWith("hand", undefined)
  })
})

/**
 * The same promise, for the action list.
 *
 * The Arrange and Actions menus print each action's `kbd` beside its label.
 * Thirteen of those printed a key nothing listened for — ⇧L, the ⌥ align set,
 * ⌥⇧H/V, ⇧H/V, and bare ] and [ — so this presses every binding the list
 * declares and watches the action run.
 */
describe("the action list's shortcuts", () => {
  /**
   * Mount the bindings against the real default action list.
   *
   * The list is read back out of the context rather than built a second time,
   * so the objects the test spies on are the very ones the handler dispatches
   * to — a separate `buildDefaultActionItems` call would produce a parallel
   * set of items and every spy would sit on the wrong object.
   */
  function bindActions(editor: Editor): TLUiActionsContextType {
    let captured: TLUiActionsContextType = {}
    function Capture() {
      captured = useActions()
      return <ActionShortcuts />
    }
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(
        <MocanvasUiProvider editor={editor} defaultActions={buildDefaultActionItems}>
          <Capture />
        </MocanvasUiProvider>,
      )
    })
    return captured
  }

  it("fires every shortcut the default actions advertise", () => {
    const editor = makeActionEditor()
    const actions = bindActions(editor)
    const owned = buildShortcutIndex()
    const unbound: string[] = []
    for (const action of Object.values(actions)) {
      if (!action.kbd) continue
      for (const raw of action.kbd.split(",")) {
        const binding = raw.trim()
        if (binding === "") continue
        // Bindings the main table already owns are answered there instead, and
        // `delete`/`backspace` belong to the select tool's own key handling.
        if (owned.has(normalizeKbd(binding))) continue
        if (binding === "backspace" || binding === "delete") continue
        const spy = vi.spyOn(action, "onSelect")
        window.dispatchEvent(keyEventFor(binding))
        if (spy.mock.calls.length === 0) unbound.push(`${action.id} (${binding})`)
        spy.mockRestore()
      }
    }
    expect(unbound, `advertised but nothing listens: ${unbound.join(", ")}`).toEqual([])
  })

  it("does not answer a binding the main table already owns, so nothing runs twice", () => {
    const editor = makeActionEditor()
    const actions = bindActions(editor)
    // Undo is declared on both lists; the table's entry is the one with the
    // history semantics, so the action must stay out of the way.
    const undo = actions["undo"]!
    expect(undo.kbd).toBe("mod+z")
    expect(actionKeyMap(actions, false).has(normalizeKbd("mod+z"))).toBe(false)
  })
})

/**
 * The three lists must not contradict each other.
 *
 * A binding can appear on the action list and the shortcut table both — the
 * table wins, deliberately — but only when they mean the same thing. ⌥D once
 * printed "Align right" in the Arrange menu and opened the frame-statistics
 * overlay, which is a menu telling the user something untrue.
 */
describe("the lists against each other", () => {
  it("never lets the table answer a binding the menu attributes to something else", () => {
    const editor = makeActionEditor()
    const actions = buildDefaultActionItems(editor)
    const table = buildShortcutIndex()
    const contradictions: string[] = []
    for (const action of Object.values(actions)) {
      if (!action.kbd) continue
      for (const raw of action.kbd.split(",")) {
        const binding = raw.trim()
        if (binding === "") continue
        const owner = table.get(normalizeKbd(binding))
        if (owner && owner.id !== action.id) {
          contradictions.push(`${binding}: menu says "${action.label}" (${action.id}), table runs "${owner.id}"`)
        }
      }
    }
    expect(contradictions, contradictions.join("; ")).toEqual([])
  })

  it("does not let a shifted press fall through to a plain tool key", () => {
    // ⇧H is Flip horizontally. The tool handler lowercased the key without
    // looking at Shift, so it read a plain "h" and switched to the hand tool
    // underneath the flip — the action fired and the tool changed with it.
    const editor = makeEditor()
    const tools = { hand: { id: "hand", label: "Hand", icon: "hand", kbd: "h", onSelect: vi.fn() } }
    function Probe() {
      return (
        <MocanvasUiProvider editor={editor} defaultTools={() => tools}>
          <ToolShortcuts />
        </MocanvasUiProvider>
      )
    }
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(<Probe />)
    })

    window.dispatchEvent(keyEventFor("shift+h"))
    expect(tools.hand.onSelect).not.toHaveBeenCalled()
    // The unshifted key still works, so the guard did not simply kill it.
    window.dispatchEvent(keyEventFor("h"))
    expect(tools.hand.onSelect).toHaveBeenCalledTimes(1)
  })
})
