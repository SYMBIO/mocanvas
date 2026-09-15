// @vitest-environment jsdom
import { atom } from "@mocanvas/state"
import { EditorProvider, type Editor, type TLUiOverrides } from "@mocanvas/editor"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TldrawUi, type TldrawUiProps } from "./TldrawUi"
import type { TLUiComponents } from "./ui-components"
import { defaultTools } from "../tools"
// The menu reaches the dialog through a dynamic import; loading the module up
// front means the press only has to wait for the module cache, not for a
// transform, so the test can await it in a tick.
import "./panel-shortcuts"

/**
 * The default menu, mounted the way an app mounts it.
 *
 * These are behaviour tests on purpose. A test that asserts a row exists is
 * worth nothing here: every bug reported against this menu was a row that
 * existed and did nothing — an empty View submenu, a Theme that moved a tick
 * and changed no pixel, a Rename that closed the menu it needed to stay in.
 * So every test below presses the thing and then asks the editor whether
 * anything happened.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The navigation panel's minimap paints into a 2d context jsdom does not have.
HTMLCanvasElement.prototype.getContext = () => null

const DEFAULT_TOOL_IDS = defaultTools.map((tool) => tool.id)

/**
 * A stand-in editor holding exactly what the chrome reads, with the mutable
 * parts backed by atoms so a press is observable the way it is against the
 * real store.
 */
function makeEditor(options: { pages?: { id: string; name: string }[]; shapes?: number } = {}) {
  const openMenus = atom<string[]>("test.openMenus", [])
  const pages = atom("test.pages", options.pages ?? [{ id: "page:a", name: "Page 1" }])
  const currentPageId = atom("test.currentPageId", "page:a")
  const colorScheme = atom<"light" | "dark" | "system">("test.colorScheme", "light")
  const prefs = atom<Record<string, unknown>>("test.prefs", { id: "user:test", locale: "en" })
  const gridMode = atom("test.gridMode", false)
  const shapeIds = new Set(Array.from({ length: options.shapes ?? 3 }, (_, i) => `shape:${i}`))

  const zoomToFit = vi.fn()
  const setColorMode = vi.fn((scheme: "light" | "dark" | "system") => colorScheme.set(scheme))
  const updateUserPreferences = vi.fn((patch: Record<string, unknown>) => prefs.set({ ...prefs.get(), ...patch }))
  const renamePage = vi.fn((id: string, name: string) => pages.set(pages.get().map((p) => (p.id === id ? { ...p, name } : p))))
  const duplicatePage = vi.fn()
  const deletePage = vi.fn()
  const createPage = vi.fn(({ name }: { name?: string } = {}) => {
    pages.set([...pages.get(), { id: `page:${pages.get().length + 1}`, name: name ?? "Page" }])
  })

  const editor = {
    root: { children: Object.fromEntries(DEFAULT_TOOL_IDS.map((id) => [id, {}])) },
    getCurrentToolId: () => "select",
    getStateDescendant: () => undefined,
    setCurrentTool: vi.fn(),
    setStyleForNextShapes: vi.fn(),
    getEditingShapeId: () => null,
    getIsReadonly: () => false,
    getIsDisposed: () => false,
    getSelectedShapes: () => [],
    getOnlySelectedShape: () => null,
    getShapePageBounds: () => null,
    getSelectedShapeIds: () => [],
    getCurrentPageShapes: () => [],
    getCurrentPageShapeIds: () => shapeIds,
    getPages: () => pages.get(),
    getCurrentPageId: () => currentPageId.get(),
    getCurrentPage: () => pages.get().find((p) => p.id === currentPageId.get()),
    setCurrentPage: (id: string) => currentPageId.set(id),
    createPage,
    renamePage,
    duplicatePage,
    deletePage,
    markHistoryStoppingPoint: vi.fn(),
    getCanUndo: () => false,
    getCanRedo: () => false,
    getColorMode: () => (colorScheme.get() === "dark" ? "dark" : "light"),
    setColorMode,
    theme: { getColorScheme: () => colorScheme.get() },
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    zoomToFit,
    zoomToSelection: vi.fn(),
    getZoomLevel: () => 1,
    getCurrentPageBounds: () => null,
    getViewportPageBounds: () => ({ x: 0, y: 0, w: 100, h: 100, collides: () => true }),
    getCollaborators: () => [],
    getVisibleCollaboratorsOnCurrentPage: () => [],
    getFollowingUserId: () => null,
    getInstanceState: () => ({
      openMenus: openMenus.get(),
      isReadonly: false,
      isGridMode: gridMode.get(),
      isFocusMode: false,
      isDebugMode: false,
      isToolLocked: false,
      exportBackground: true,
    }),
    updateInstanceState: (partial: { openMenus?: string[]; isGridMode?: boolean }) => {
      if (partial.openMenus) openMenus.set(partial.openMenus)
      if (partial.isGridMode !== undefined) gridMode.set(partial.isGridMode)
    },
    getContainer: () => document.body,
    getContainerDocument: () => document,
    getContainerWindow: () => window,
    getDocumentSettings: () => ({ gridSize: 20 }),
    getSharedStyles: () => new Map(),
    user: {
      getLocale: () => (prefs.get()["locale"] as string) ?? "en",
      getUserPreferences: () => prefs.get(),
      getIsSnapMode: () => false,
      getIsWrapMode: () => false,
      getIsDynamicSizeMode: () => false,
      getIsPasteAtCursorMode: () => false,
      getEdgeScrollSpeed: () => 1,
      getAnimationSpeed: () => (prefs.get()["animationSpeed"] as number) ?? 1,
      getAreKeyboardShortcutsEnabled: () => true,
      getIsEnhancedA11yMode: () => (prefs.get()["isEnhancedA11yMode"] as boolean) ?? false,
      updateUserPreferences,
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

  return { editor, zoomToFit, setColorMode, updateUserPreferences, renamePage, duplicatePage, deletePage, createPage, pages, prefs, colorScheme }
}

let root: Root | null = null
let host: HTMLElement | null = null

function renderChrome(parts = makeEditor(), overrides?: TLUiOverrides, ui: { forceMobile?: boolean; components?: TLUiComponents } = {}) {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  const props: TldrawUiProps = {}
  if (overrides) props.overrides = overrides
  if (ui.forceMobile) props.forceMobile = true
  if (ui.components) props.components = ui.components
  act(() => {
    root!.render(
      <EditorProvider editor={parts.editor}>
        <TldrawUi {...props} />
      </EditorProvider>,
    )
  })
  return parts
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

/** Every menu row currently on screen, by its visible text. */
function rows(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".mocanvas-menu-item"))
}

function row(text: string): HTMLButtonElement {
  const found = rows().find((el) => el.textContent?.trim().startsWith(text))
  expect(found, `no menu row starting with "${text}" — rows are: ${rows().map((r) => r.textContent?.trim())}`).toBeDefined()
  return found!
}

/** jsdom has no `PointerEvent`; the dismiss listener only cares about the type. */
function pointerDown(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
}

function click(el: HTMLElement) {
  act(() => {
    pointerDown(el)
    el.click()
  })
}

function openMainMenu() {
  click(document.querySelector<HTMLButtonElement>('button[aria-label="Menu"]')!)
}

function openPageMenu() {
  click(document.querySelector<HTMLButtonElement>('button[aria-label^="Page:"]')!)
}

describe("the main menu's View submenu", () => {
  it("is not empty", () => {
    renderChrome()
    openMainMenu()
    click(row("View"))
    const sub = document.querySelector(".mocanvas-menu--sub")
    expect(sub, "the View submenu did not open").not.toBeNull()
    const labels = Array.from(sub!.querySelectorAll(".mocanvas-menu-item")).map((el) => el.textContent?.trim())
    expect(labels.length, `View offered nothing: ${JSON.stringify(labels)}`).toBeGreaterThan(0)
  })

  it("moves the camera when one of its items is chosen", () => {
    const parts = renderChrome()
    openMainMenu()
    click(row("View"))
    const sub = document.querySelector(".mocanvas-menu--sub")!
    const fit = Array.from(sub.querySelectorAll<HTMLButtonElement>(".mocanvas-menu-item")).find((el) =>
      el.textContent?.trim().startsWith("Zoom to fit"),
    )!
    click(fit)
    expect(parts.zoomToFit).toHaveBeenCalledTimes(1)
  })

  it("stays open when the pointer goes down inside it", () => {
    // Submenus are portalled beside the menu that opened them, not inside it.
    // A dismiss check that only asked "is this inside me?" closed the whole
    // menu on pointer-down and swallowed the click — which made every submenu
    // item in the chrome unusable.
    renderChrome()
    openMainMenu()
    click(row("View"))
    const sub = document.querySelector(".mocanvas-menu--sub")!
    const first = sub.querySelector<HTMLButtonElement>(".mocanvas-menu-item")!
    act(() => {
      pointerDown(first)
    })
    expect(document.querySelector(".mocanvas-menu--sub"), "the submenu was dismissed by its own press").not.toBeNull()
  })
})

/** The main menu, then the Preferences row that now holds the toggles. */
function openPreferences() {
  openMainMenu()
  click(row("Preferences"))
}

describe("the preferences", () => {
  it("are behind one row rather than listed in the main menu", () => {
    renderChrome()
    openMainMenu()
    const top = rows().map((el) => el.textContent?.trim())
    expect(top, "the toggles are still listed at the top level").not.toContain("Always snap")
    expect(top).toContain("Preferences")
  })

  it("open onto every toggle that used to be in the main menu", () => {
    renderChrome()
    openPreferences()
    // A row's text carries its shortcut ("Tool lockQ"), so match the start.
    const labels = rows().map((el) => el.textContent?.trim() ?? "")
    for (const label of ["Always snap", "Tool lock", "Show grid", "Wrap text", "Focus mode", "Edge scrolling", "Dynamic size", "Paste at cursor", "Debug mode"]) {
      expect(labels.some((l) => l.startsWith(label)), `"${label}" is not reachable any more — rows are: ${labels.join(", ")}`).toBe(true)
    }
  })

  it("gather the ones with a subject of their own into submenus", () => {
    renderChrome()
    openPreferences()
    const labels = rows().map((el) => el.textContent?.trim())
    // Both components existed and were exported; neither was rendered anywhere.
    expect(labels).toContain("Accessibility")
    expect(labels).toContain("Input")
    expect(labels).toContain("Theme")
  })

  it("still toggle the editor from in there", () => {
    const parts = renderChrome()
    openPreferences()
    expect(parts.editor.getInstanceState().isGridMode).toBe(false)
    click(row("Show grid"))
    expect(parts.editor.getInstanceState().isGridMode, "the row moved but changed nothing").toBe(true)
  })

  it("repaints the editor when the theme is changed", () => {
    const parts = renderChrome()
    openPreferences()
    click(row("Theme"))
    const sub = document.querySelector(".mocanvas-menu--sub")!
    const dark = Array.from(sub.querySelectorAll<HTMLButtonElement>(".mocanvas-menu-item")).find((el) => el.textContent?.trim() === "Dark")!
    click(dark)
    // The theme manager is what the canvas paints from; writing only the user
    // preference moved the tick and changed nothing on screen.
    expect(parts.setColorMode).toHaveBeenCalledWith("dark")
    expect(parts.editor.getColorMode()).toBe("dark")
  })

  it("shows the theme that is actually in force", () => {
    const parts = renderChrome()
    openPreferences()
    click(row("Theme"))
    const sub = () => document.querySelector(".mocanvas-menu--sub")!
    const item = (label: string) =>
      Array.from(sub().querySelectorAll<HTMLButtonElement>(".mocanvas-menu-item")).find((el) => el.textContent?.trim() === label)!
    expect(item("Light").getAttribute("aria-checked")).toBe("true")
    click(item("Dark"))
    expect(item("Dark").getAttribute("aria-checked")).toBe("true")
    expect(item("Light").getAttribute("aria-checked")).toBe("false")
    expect(parts.colorScheme.get()).toBe("dark")
  })

  it("answers every press of Reduce motion, and marks the container", () => {
    const parts = renderChrome()
    openPreferences()
    click(row("Accessibility"))
    const reduce = row("Reduce motion")
    expect(reduce.getAttribute("aria-checked")).toBe("false")
    click(reduce)
    expect(parts.updateUserPreferences).toHaveBeenCalledWith({ animationSpeed: 0 })
    expect(row("Reduce motion").getAttribute("aria-checked")).toBe("true")
    // The chrome's transitions are switched off through the container.
    expect(document.body.getAttribute("data-reduce-motion")).toBe("true")
    click(row("Reduce motion"))
    expect(parts.updateUserPreferences).toHaveBeenLastCalledWith({ animationSpeed: 1 })
    expect(document.body.getAttribute("data-reduce-motion")).toBeNull()
  })

  it("offers no language menu when the host shipped no translations", () => {
    // mocanvas has no message catalogues of its own, so a list of twenty-five
    // languages that all render the same English is a promise it cannot keep.
    renderChrome()
    openMainMenu()
    expect(rows().map((el) => el.textContent?.trim())).not.toContain("Language")
  })

  it("offers exactly the languages the host shipped strings for", () => {
    renderChrome(makeEditor(), {
      translations: {
        cs: { Print: "Tisk" },
        de: { Print: "Drucken" },
        // No strings: a placeholder is not a translation.
        fr: {},
      },
    })
    openMainMenu()
    click(row("Language"))
    const sub = document.querySelector(".mocanvas-menu--sub")!
    const labels = Array.from(sub.querySelectorAll(".mocanvas-menu-item")).map((el) => el.textContent?.trim())
    expect(labels).toEqual(["Čeština", "Deutsch"])
  })

  it("translates the menu when one of those languages is chosen", () => {
    const parts = renderChrome(makeEditor(), { translations: { cs: { Print: "Tisk" }, de: { Print: "Drucken" } } })
    openMainMenu()
    expect(row("Print").textContent).toContain("Print")
    click(row("Language"))
    const sub = document.querySelector(".mocanvas-menu--sub")!
    const czech = Array.from(sub.querySelectorAll<HTMLButtonElement>(".mocanvas-menu-item")).find((el) => el.textContent?.trim() === "Čeština")!
    click(czech)
    expect(parts.updateUserPreferences).toHaveBeenCalledWith({ locale: "cs" })
    // And the label really changes — which is what the user expected of the
    // switcher and never got.
    expect(rows().some((el) => el.textContent?.trim().startsWith("Tisk"))).toBe(true)
  })

  it("makes Enhanced accessibility answer, and writes the preference the announcer reads", () => {
    // This row used to set a module-level boolean nothing read. The test is
    // therefore not "the row exists" but "pressing it moves the state that
    // `useSelectedShapesAnnouncer` consults" — see ui-a11y.test.tsx for the
    // other half, where that state changes what is actually announced.
    const parts = renderChrome()
    openPreferences()
    click(row("Accessibility"))
    expect(row("Enhanced accessibility").getAttribute("aria-checked")).toBe("false")
    click(row("Enhanced accessibility"))
    expect(parts.updateUserPreferences).toHaveBeenCalledWith({ isEnhancedA11yMode: true })
    expect(row("Enhanced accessibility").getAttribute("aria-checked")).toBe("true")
    click(row("Enhanced accessibility"))
    expect(parts.updateUserPreferences).toHaveBeenLastCalledWith({ isEnhancedA11yMode: false })
    expect(row("Enhanced accessibility").getAttribute("aria-checked")).toBe("false")
  })

  it("disables Print when there is nothing to print", () => {
    renderChrome(makeEditor({ shapes: 0 }))
    openMainMenu()
    expect(row("Print").disabled).toBe(true)
  })
})

describe("the page menu", () => {
  it("gives each page one actions trigger rather than a column of rows", () => {
    renderChrome(makeEditor({ pages: [{ id: "page:a", name: "Page 1" }] }))
    openPageMenu()
    const pageRows = document.querySelectorAll(".mocanvas-page-row")
    expect(pageRows.length).toBe(1)
    expect(pageRows[0]!.querySelectorAll(".mocanvas-page-row-actions").length).toBe(1)
    // The three actions are behind that trigger, not printed beside the name.
    expect(pageRows[0]!.textContent).not.toContain("Duplicate")
  })

  it("opens the rename field and keeps the menu open", () => {
    renderChrome()
    openPageMenu()
    click(document.querySelector<HTMLButtonElement>(".mocanvas-page-row-actions")!)
    click(row("Rename"))
    const field = document.querySelector<HTMLInputElement>(".mocanvas-page-rename input")
    expect(field, "Rename did not reveal a field").not.toBeNull()
    expect(document.querySelector(".mocanvas-page-list"), "Rename closed the menu it needed to stay in").not.toBeNull()
  })

  it("renames the page from that field", () => {
    const parts = renderChrome()
    openPageMenu()
    click(document.querySelector<HTMLButtonElement>(".mocanvas-page-row-actions")!)
    click(row("Rename"))
    const field = document.querySelector<HTMLInputElement>(".mocanvas-page-rename input")!
    act(() => {
      // React tracks the last value it wrote, so assigning `.value` directly
      // is invisible to it; go through the prototype setter it patched.
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!
      setValue.call(field, "Sketches")
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    expect(parts.renamePage).toHaveBeenCalledWith("page:a", "Sketches")
    expect(parts.pages.get()[0]!.name).toBe("Sketches")
  })

  it("duplicates from the same trigger", () => {
    const parts = renderChrome()
    openPageMenu()
    click(document.querySelector<HTMLButtonElement>(".mocanvas-page-row-actions")!)
    click(row("Duplicate"))
    expect(parts.duplicatePage).toHaveBeenCalledWith("page:a")
  })

  it("will not delete the only page", () => {
    renderChrome(makeEditor({ pages: [{ id: "page:a", name: "Page 1" }] }))
    openPageMenu()
    click(document.querySelector<HTMLButtonElement>(".mocanvas-page-row-actions")!)
    expect(row("Delete").disabled).toBe(true)
  })

  it("puts a new page straight into its rename field", () => {
    const parts = renderChrome()
    openPageMenu()
    click(row("New page"))
    expect(parts.createPage).toHaveBeenCalled()
    expect(document.querySelector(".mocanvas-page-rename input"), "a new page was created with no way to name it").not.toBeNull()
  })
})

describe("the keyboard shortcuts dialog", () => {
  it("lists tools and actions rather than empty headings", async () => {
    renderChrome()
    openMainMenu()
    click(row("Keyboard shortcuts"))
    // The dialog body is code-split, so it arrives a tick later.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog, "the shortcuts dialog did not open").not.toBeNull()
    const sections = Array.from(dialog!.querySelectorAll(".mocanvas-shortcut-section"))
    expect(sections.length).toBeGreaterThan(0)
    for (const section of sections) {
      const shortcutRows = section.querySelectorAll(".mocanvas-shortcut-row")
      expect(shortcutRows.length, `the "${section.querySelector("h3")?.textContent}" section is empty`).toBeGreaterThan(0)
      for (const shortcutRow of Array.from(shortcutRows)) {
        expect(shortcutRow.querySelector("kbd"), `"${shortcutRow.textContent}" is listed with no key`).not.toBeNull()
      }
    }
    // The tools are there, from the same list the toolbar and the key
    // bindings read.
    const text = dialog!.textContent ?? ""
    expect(text).toContain("Select")
    expect(text).toContain("Undo")
  })
})


/**
 * Where the common actions are drawn.
 *
 * They were drawn nowhere in particular: the row carried no `mocanvas-panel`
 * class, and that is the selector its own rule declares its variables on, so
 * `gap` and `bottom` were invalid and the buttons landed unstyled and cramped
 * at the top of the canvas. The actions menu's trigger had no placement at all
 * and sat in the container's top-left corner, under the menu plate.
 *
 * These assert the arrangement rather than the pixels: which plate the row is
 * in, and that it is in exactly one of them.
 */
/**
 * Give the chrome a container width to branch on.
 *
 * jsdom lays nothing out, so the breakpoint provider measures zero and every
 * test would be the narrow one. The width is the point of these tests, so it
 * is stated rather than inherited.
 */
function withContainerWidth(width: number) {
  document.body.getBoundingClientRect = () =>
    ({ left: 0, top: 0, x: 0, y: 0, width, height: 800, right: width, bottom: 800, toJSON: () => ({}) }) as DOMRect
}

const quickActions = () => document.querySelectorAll(".mocanvas-action-row[aria-label='Quick actions']")
const menuPanel = () => document.querySelector(".mocanvas-menu-panel")!

describe("the common actions", () => {
  it("ride in the menu plate when there is room for them", () => {
    withContainerWidth(1200)
    renderChrome()
    expect(quickActions()).toHaveLength(1)
    expect(menuPanel().contains(quickActions()[0]!), "the row is not in the menu plate").toBe(true)
  })

  it("dock above the toolbar instead when the chrome is narrow", () => {
    renderChrome(makeEditor(), undefined, { forceMobile: true })
    expect(quickActions()).toHaveLength(1)
    expect(menuPanel().contains(quickActions()[0]!)).toBe(false)
    // Standalone it is a plate of its own — which is also where its variables
    // come from, so the class is what makes the rest of the rule apply.
    expect(quickActions()[0]!.classList.contains("mocanvas-panel")).toBe(true)
  })

  it("are drawn once, never in both places", () => {
    withContainerWidth(1200)
    renderChrome()
    expect(quickActions()).toHaveLength(1)
    expect(document.querySelectorAll(".mocanvas-action-row button[aria-label='Undo']")).toHaveLength(1)
  })

  it("take the actions menu with them", () => {
    withContainerWidth(1200)
    renderChrome()
    const trigger = document.querySelector("[aria-label='Actions']")!
    expect(menuPanel().contains(trigger), "the trigger was left in the corner").toBe(true)
  })

  it("take the actions menu into the dock too, not the corner", () => {
    renderChrome(makeEditor(), undefined, { forceMobile: true })
    const trigger = document.querySelector("[aria-label='Actions']")
    expect(trigger, "the actions menu vanished on a narrow layout").not.toBeNull()
    expect(quickActions()[0]!.contains(trigger!), "the trigger was left unplaced").toBe(true)
  })

  it("never leave an unplaced trigger behind at either width", () => {
    withContainerWidth(1200)
    renderChrome()
    // The menu plate and the dock are the only two places either may appear.
    for (const el of document.querySelectorAll("[aria-label='Actions']")) {
      expect(menuPanel().contains(el) || [...quickActions()].some((row) => row.contains(el))).toBe(true)
    }
  })

  it("still answer to the slot that owns them", () => {
    renderChrome(makeEditor(), undefined, { components: { QuickActions: null } })
    expect(quickActions(), "hosting them in the plate stopped `QuickActions: null` removing them").toHaveLength(0)
  })

  it("let an app put its own row in the plate", () => {
    withContainerWidth(1200)
    renderChrome(makeEditor(), undefined, { components: { QuickActions: () => <div data-testid="mine" /> } })
    expect(menuPanel().querySelector('[data-testid="mine"]')).not.toBeNull()
  })
})


/**
 * The same failure as the actions row, in the other narrow-layout control: a
 * button rendered outside `.mocanvas-panel` gets none of the variables that
 * selector declares, so its `width` is dropped along with its placement and it
 * lands in the container's corner at the size of its icon.
 */
describe("the style trigger on a narrow layout", () => {
  it("is docked in a plate rather than left in the corner", () => {
    const parts = makeEditor()
    // The trigger only exists when a style applies AND the current tool is one
    // that makes shapes — with the select tool and nothing selected there is
    // nothing to style. Both are deliberate and neither is what this test is
    // about, so the stand-in is given a creating tool and a style.
    ;(parts.editor as unknown as { getSharedStyles: () => Map<string, unknown> }).getSharedStyles = () => new Map([["color", { type: "shared", value: "black" }]])
    ;(parts.editor as unknown as { getCurrentToolId: () => string }).getCurrentToolId = () => "geo"
    renderChrome(parts, undefined, { forceMobile: true })
    const trigger = document.querySelector("[aria-label='Style']")
    expect(trigger, "no style trigger on a narrow layout").not.toBeNull()
    expect(trigger!.closest(".mocanvas-panel"), "the trigger is outside every plate — no variables, no placement").not.toBeNull()
  })

  /*
   * The two panels answer the same question and have to answer it the same
   * way. A shape that declares no styles of its own — every custom shape that
   * has not asked for colour or dash — still has an opacity, so selecting one
   * gives the docked panel something to show. The narrow layout dropped out on
   * a second, stricter rule and showed nothing, which made opacity a thing you
   * could only reach on a wide screen.
   */
  it.each([
    ["wide", false],
    ["narrow", true],
  ])("appears on the %s layout for a selection with no styles in common", (_layout, forceMobile) => {
    const parts = makeEditor()
    ;(parts.editor as unknown as { getSharedStyles: () => Map<string, unknown> }).getSharedStyles = () => new Map()
    ;(parts.editor as unknown as { getSelectedShapeIds: () => string[] }).getSelectedShapeIds = () => ["shape:a"]
    renderChrome(parts, undefined, { forceMobile })
    expect(document.querySelector("[aria-label='Style']"), "nothing to style a selected shape with").not.toBeNull()
  })
})


/**
 * The share panel is a plate with one thing in it, and that thing renders
 * nothing when nobody else is on the page. The plate did not follow, so a
 * single-player editor — every demo on the site, every first look at the
 * library — had a 10px rounded blob in its top-right corner that nobody could
 * name. Same failure as the style panel that was on permanently, one step
 * further out: there the frame had contents nobody wanted, here it had none.
 */
describe("the share panel", () => {
  it("is not there at all when nobody else is", () => {
    renderChrome()
    expect(document.querySelector(".mocanvas-share-panel"), "an empty plate in the corner").toBeNull()
  })

  it("is there when somebody is", () => {
    const parts = makeEditor()
    ;(parts.editor as unknown as { getVisibleCollaboratorsOnCurrentPage: () => unknown[] }).getVisibleCollaboratorsOnCurrentPage =
      () => [{ userId: "user:b", userName: "Someone", color: "#f00" }]
    renderChrome(parts)
    expect(document.querySelector(".mocanvas-share-panel"), "nowhere to see who is here").not.toBeNull()
  })
})


/**
 * The help menu's trigger was a bare `?` with no plate and no placement, so it
 * sat in the container's top-left corner under the menu plate — the same
 * failure as the actions row and the style swatch, in the last control that
 * still had it. Nothing was behind it that the main menu does not already
 * carry, so it is off by default rather than docked for its own sake.
 */
describe("the help menu", () => {
  it("is not in the default chrome", () => {
    renderChrome()
    expect(document.querySelector("[aria-label='Help']"), "the stray ? is back").toBeNull()
  })

  it("is docked, not stranded, for an app that asks for it", async () => {
    const { DefaultHelpMenu } = await import("./panel-menus")
    renderChrome(makeEditor(), undefined, { components: { HelpMenu: DefaultHelpMenu } })
    const trigger = document.querySelector("[aria-label='Help']")
    expect(trigger).not.toBeNull()
    expect(trigger!.closest(".mocanvas-panel"), "filling the slot brings back an unplaced trigger").not.toBeNull()
  })

  it("still reaches everything it used to, from the main menu", () => {
    renderChrome()
    openMainMenu()
    expect(rows().map((el) => el.textContent?.trim())).toContain("Keyboard shortcuts")
    // Same open menu, one row deeper — a second `openMainMenu()` would toggle
    // it shut.
    click(row("Preferences"))
    click(row("Accessibility"))
    expect(rows().map((el) => el.textContent?.trim())).toContain("Enhanced accessibility")
  })
})

/**
 * When the style panel is on screen at all.
 *
 * It used to be always: the styles a tool *would* apply exist whether or not
 * that tool is the pointer, so picking the arrow and looking at an empty board
 * still put a full panel of colours and fills over the canvas. The rule now is
 * that the panel needs a subject — something selected, or a tool about to make
 * something.
 */
function withTool(toolId: string, selected: string[] = []) {
  const parts = makeEditor()
  const editor = parts.editor as unknown as {
    getCurrentToolId: () => string
    getSelectedShapeIds: () => string[]
    getSharedStyles: () => Map<string, unknown>
  }
  editor.getCurrentToolId = () => toolId
  editor.getSelectedShapeIds = () => selected
  editor.getSharedStyles = () => new Map([["color", { type: "shared", value: "black" }]])
  return parts
}

const stylePanel = () => document.querySelector('[aria-label="Style"]')

describe("when the style panel appears", () => {
  it("stays away for the select tool with nothing selected", () => {
    withContainerWidth(1200)
    renderChrome(withTool("select"))
    expect(stylePanel(), "a panel about nothing, over the canvas").toBeNull()
  })

  it("stays away for the hand tool", () => {
    withContainerWidth(1200)
    renderChrome(withTool("hand"))
    expect(stylePanel()).toBeNull()
  })

  it("appears once something is selected", () => {
    withContainerWidth(1200)
    renderChrome(withTool("select", ["shape:a"]))
    expect(stylePanel(), "there is a selection to style and no panel").not.toBeNull()
  })

  it("appears for a tool that is about to make a shape", () => {
    withContainerWidth(1200)
    renderChrome(withTool("geo"))
    expect(stylePanel(), "the next shape's styles are exactly what this is for").not.toBeNull()
  })
})

/**
 * The legacy alignments are in the style because an older tldraw file carries
 * them; they are not choices. Offered, they rendered as three text buttons
 * wider than the row they sat in.
 */
describe("the alignment picker", () => {
  it("offers no legacy alignment", () => {
    withContainerWidth(1200)
    renderChrome(withTool("geo", ["shape:a"]))
    const labels = [...document.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label") ?? "")
    expect(labels.some((label) => /legacy/i.test(label)), `found: ${labels.filter((l) => /legacy/i.test(l)).join(", ")}`).toBe(false)
  })
})
