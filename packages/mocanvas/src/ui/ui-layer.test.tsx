// @vitest-environment jsdom
import { atom } from "@mocanvas/state"
import { EditorProvider, type Editor } from "@mocanvas/editor"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TldrawUiToastsProvider, useToasts, DefaultToasts } from "./ui-toasts"
import { TldrawUiDialogsProvider, useDialogs, DefaultDialogs, type TLUiDialogProps } from "./ui-dialogs"
import { TldrawUiComponentsProvider, useTldrawUiComponents } from "./ui-components"
import { TldrawUiEventsProvider, useUiEvents } from "./ui-events"
import { TldrawUiTranslationProvider, useTranslation, getDefaultTranslationLocale, isRtlLanguage } from "./ui-translation"
import { TldrawUiMenuContextProvider, TldrawUiMenuItem, TldrawUiMenuCheckboxItem, TldrawUiMenuGroup } from "./ui-menu"
import { TldrawUiDropdownMenuContent, TldrawUiDropdownMenuRoot, TldrawUiDropdownMenuTrigger } from "./ui-dropdown-menu"

// React only flushes `act()` synchronously when it is told it is under test.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * A stand-in editor: only what the UI layer reads, backed by atoms so the
 * reactive reads behave as they do against the real store. A real `Editor`
 * would drag in the wasm engine, which none of this touches.
 */
function makeEditor() {
  const locale = atom("test.locale", "en")
  const openMenus = atom<string[]>("test.openMenus", [])
  const editor = {
    root: { children: { select: {} } },
    getCurrentToolId: () => "select",
    getStateDescendant: () => undefined,
    getEditingShapeId: () => null,
    getIsReadonly: () => false,
    getSelectedShapes: () => [],
    getSelectedShapeIds: () => [],
    getCurrentPageShapes: () => [],
    getPages: () => [{ id: "page:a", name: "Page 1" }],
    getCanUndo: () => false,
    getCanRedo: () => false,
    getColorMode: () => "light",
    getInstanceState: () => ({ openMenus: openMenus.get(), isReadonly: false, isGridMode: false, isFocusMode: false, isDebugMode: false, isToolLocked: false, exportBackground: true }),
    updateInstanceState: (partial: { openMenus?: string[] }) => {
      if (partial.openMenus) openMenus.set(partial.openMenus)
    },
    getContainer: () => document.body,
    getContainerDocument: () => document,
    user: {
      getLocale: () => locale.get(),
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
  } as unknown as Editor
  return { editor, locale }
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

describe("toasts", () => {
  it("adds, renders and removes", () => {
    let api: ReturnType<typeof useToasts> | null = null
    function Probe() {
      api = useToasts()
      return null
    }
    const el = render(
      <TldrawUiToastsProvider>
        <Probe />
        <DefaultToasts />
      </TldrawUiToastsProvider>,
    )
    expect(el.querySelector(".mocanvas-toast")).toBeNull()

    let id = ""
    act(() => {
      id = api!.addToast({ title: "Copied", keepOpen: true })
    })
    expect(el.textContent).toContain("Copied")
    // Each toast is its own alert; the stack is a log, not a second live region.
    expect(el.querySelector('[role="log"]')).not.toBeNull()

    act(() => {
      api!.removeToast(id)
    })
    expect(el.querySelector(".mocanvas-toast")).toBeNull()
  })

  it("is inert rather than throwing outside a provider", () => {
    let api: ReturnType<typeof useToasts> | null = null
    function Probe() {
      api = useToasts()
      return null
    }
    render(<Probe />)
    expect(() => api!.addToast({ title: "x" })).not.toThrow()
  })
})

describe("dialogs", () => {
  it("renders a dialog as a modal and calls onClose when it is removed", () => {
    const onClose = vi.fn()
    let api: ReturnType<typeof useDialogs> | null = null
    function Probe() {
      api = useDialogs()
      return null
    }
    function Body({ onClose: close }: TLUiDialogProps) {
      return (
        <button type="button" onClick={close}>
          Done
        </button>
      )
    }
    const el = render(
      <TldrawUiDialogsProvider>
        <Probe />
        <DefaultDialogs />
      </TldrawUiDialogsProvider>,
    )
    act(() => {
      api!.addDialog({ component: Body, onClose })
    })
    const dialog = el.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.getAttribute("aria-modal")).toBe("true")

    act(() => {
      ;(el.querySelector("button") as HTMLButtonElement).click()
    })
    expect(el.querySelector('[role="dialog"]')).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("moves focus into the dialog when it opens", () => {
    function Body() {
      return (
        <button type="button" id="first">
          First
        </button>
      )
    }
    let api: ReturnType<typeof useDialogs> | null = null
    function Probe() {
      api = useDialogs()
      return null
    }
    render(
      <TldrawUiDialogsProvider>
        <Probe />
        <DefaultDialogs />
      </TldrawUiDialogsProvider>,
    )
    act(() => {
      api!.addDialog({ component: Body })
    })
    expect(document.activeElement?.id).toBe("first")
  })
})

describe("the components map", () => {
  it("merges nested providers rather than replacing them", () => {
    const Outer = () => <span>outer</span>
    const Inner = () => <span>inner</span>
    let seen: ReturnType<typeof useTldrawUiComponents> | null = null
    function Probe() {
      seen = useTldrawUiComponents()
      return null
    }
    render(
      <TldrawUiComponentsProvider overrides={{ Toolbar: Outer, StylePanel: Outer }}>
        <TldrawUiComponentsProvider overrides={{ StylePanel: Inner }}>
          <Probe />
        </TldrawUiComponentsProvider>
      </TldrawUiComponentsProvider>,
    )
    expect(seen!.Toolbar).toBe(Outer)
    expect(seen!.StylePanel).toBe(Inner)
  })

  it("keeps a slot the caller explicitly nulled", () => {
    let seen: ReturnType<typeof useTldrawUiComponents> | null = null
    function Probe() {
      seen = useTldrawUiComponents()
      return null
    }
    render(
      <TldrawUiComponentsProvider overrides={{ Toolbar: null }}>
        <Probe />
      </TldrawUiComponentsProvider>,
    )
    expect(seen!.Toolbar).toBeNull()
  })
})

describe("ui events", () => {
  it("reports through the host's handler, and no-ops without one", () => {
    const onEvent = vi.fn()
    function Probe() {
      const track = useUiEvents()
      track("select-tool", { source: "toolbar", id: "draw" })
      return null
    }
    render(
      <TldrawUiEventsProvider onEvent={onEvent}>
        <Probe />
      </TldrawUiEventsProvider>,
    )
    expect(onEvent).toHaveBeenCalledWith("select-tool", { source: "toolbar", id: "draw" })
    expect(() => render(<Probe />)).not.toThrow()
  })
})

describe("translations", () => {
  it("passes an unknown id through unchanged", () => {
    const { editor } = makeEditor()
    let msg: ((id: string) => string) | null = null
    function Probe() {
      msg = useTranslation()
      return null
    }
    render(
      <EditorProvider editor={editor}>
        <TldrawUiTranslationProvider overrides={{ en: { "tool.comment": "Comment" } }}>
          <Probe />
        </TldrawUiTranslationProvider>
      </EditorProvider>,
    )
    expect(msg!("tool.comment")).toBe("Comment")
    expect(msg!("Already display text")).toBe("Already display text")
  })

  it("picks the best available locale for a browser's list", () => {
    expect(getDefaultTranslationLocale(["cs-CZ", "en"])).toBe("cs")
    expect(getDefaultTranslationLocale(["xx-YY"])).toBe("en")
    expect(getDefaultTranslationLocale([])).toBe("en")
  })

  it("knows which languages read right to left", () => {
    expect(isRtlLanguage("ar")).toBe(true)
    expect(isRtlLanguage("he-IL")).toBe(true)
    expect(isRtlLanguage("cs")).toBe(false)
  })
})

describe("the menu system", () => {
  function inMenu(node: React.ReactNode, type: Parameters<typeof TldrawUiMenuContextProvider>[0]["type"]) {
    const { editor } = makeEditor()
    return render(
      <EditorProvider editor={editor}>
        <TldrawUiMenuContextProvider type={type}>{node}</TldrawUiMenuContextProvider>
      </EditorProvider>,
    )
  }

  it("renders an item as a row in a menu and a button in an icon grid", () => {
    const row = inMenu(<TldrawUiMenuItem id="cut" label="Cut" icon="trash" kbd="mod+x" />, "menu")
    expect(row.querySelector('[role="menuitem"]')).not.toBeNull()
    act(() => root?.unmount())
    host?.remove()

    const icon = inMenu(<TldrawUiMenuItem id="cut" label="Cut" icon="trash" />, "small-icons")
    expect(icon.querySelector('[role="menuitem"]')).toBeNull()
    expect(icon.querySelector("button")?.getAttribute("aria-label")).toBe("Cut")
  })

  it("renders an item as a read-only row in the shortcuts sheet", () => {
    const el = inMenu(<TldrawUiMenuItem id="cut" label="Cut" kbd="mod+x" />, "keyboard-shortcuts")
    expect(el.querySelector("button")).toBeNull()
    expect(el.textContent).toContain("Cut")
  })

  it("gives a checkbox item the checkbox role and state", () => {
    const el = inMenu(<TldrawUiMenuCheckboxItem id="grid" label="Grid" checked />, "menu")
    const item = el.querySelector('[role="menuitemcheckbox"]')
    expect(item).not.toBeNull()
    expect(item!.getAttribute("aria-checked")).toBe("true")
  })

  it("labels a group so a screen reader can say which section it is in", () => {
    const el = inMenu(
      <TldrawUiMenuGroup id="edit" label="Edit">
        <TldrawUiMenuItem id="cut" label="Cut" />
      </TldrawUiMenuGroup>,
      "menu",
    )
    const group = el.querySelector('[role="group"]')
    expect(group?.getAttribute("aria-label")).toBe("Edit")
  })

  it("calls onSelect with the source its context implies", () => {
    const onSelect = vi.fn()
    const el = inMenu(<TldrawUiMenuItem id="cut" label="Cut" onSelect={onSelect} />, "context-menu")
    act(() => {
      ;(el.querySelector("button") as HTMLButtonElement).click()
    })
    expect(onSelect).toHaveBeenCalledWith("context-menu")
  })
})

describe("the dropdown menu", () => {
  it("wires the trigger to the content and reports its open state", () => {
    const { editor } = makeEditor()
    const el = render(
      <EditorProvider editor={editor}>
        <TldrawUiDropdownMenuRoot id="test-menu">
          <TldrawUiDropdownMenuTrigger label="Menu">M</TldrawUiDropdownMenuTrigger>
          <TldrawUiDropdownMenuContent label="Menu">
            <button type="button">Item</button>
          </TldrawUiDropdownMenuContent>
        </TldrawUiDropdownMenuRoot>
      </EditorProvider>,
    )
    const trigger = el.querySelector("button") as HTMLButtonElement
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(document.querySelector('[role="menu"]')).toBeNull()

    act(() => {
      trigger.click()
    })
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    // Portalled out of the trigger, so it escapes any panel's overflow.
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  })
})
