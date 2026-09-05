/**
 * Which menus are open, process-wide.
 *
 * A menu is not part of the document, but the canvas has to know one is open:
 * a pointer-down that lands while a dropdown is up should dismiss the dropdown
 * rather than start a selection, and keyboard shortcuts must not fire behind
 * an open dialog. `Editor.menus` answers the same question per editor; this
 * registry answers it for UI that renders in a portal, outside any editor's
 * React tree, and for a page with more than one editor on it.
 *
 * Menus are namespaced by *context* — an {@link ../editor/Editor.Editor.contextId} —
 * so two editors on one page do not see each other's menus.
 */
import { atom, type Atom } from "@mocanvas/state"

/** The context used by callers that do not name one. */
export const DEFAULT_MENU_CONTEXT = "default"

/** The open-menu registry. */
export interface TLMenus {
  /** Open menu ids for a context, in the order they were opened. */
  getOpenMenus(contextId?: string): string[]
  isMenuOpen(id: string, contextId?: string): boolean
  /** Mark a menu open. Opening an already-open menu changes nothing. */
  addOpenMenu(id: string, contextId?: string): void
  /** Mark a menu closed. Closing a menu that is not open changes nothing. */
  deleteOpenMenu(id: string, contextId?: string): void
  /** Close every menu in a context. */
  clearOpenMenus(contextId?: string): void
  /** Whether any menu is open in a context. */
  getIsMenuOpen(contextId?: string): boolean
}

/**
 * One atom for the whole registry rather than one per context: the number of
 * open menus is tiny, and a single atom means a reader that asks "is anything
 * open?" subscribes to exactly one signal.
 */
const $menus: Atom<Readonly<Record<string, readonly string[]>>> = atom("tlmenus", {})

function read(contextId: string): readonly string[] {
  return $menus.get()[contextId] ?? []
}

/** The process-wide open-menu registry. */
export const tlmenus: TLMenus = {
  getOpenMenus(contextId: string = DEFAULT_MENU_CONTEXT): string[] {
    return [...read(contextId)]
  },

  isMenuOpen(id: string, contextId: string = DEFAULT_MENU_CONTEXT): boolean {
    return read(contextId).includes(id)
  },

  addOpenMenu(id: string, contextId: string = DEFAULT_MENU_CONTEXT): void {
    if (read(contextId).includes(id)) return
    $menus.update((menus) => ({ ...menus, [contextId]: [...(menus[contextId] ?? []), id] }))
  },

  deleteOpenMenu(id: string, contextId: string = DEFAULT_MENU_CONTEXT): void {
    if (!read(contextId).includes(id)) return
    $menus.update((menus) => ({ ...menus, [contextId]: (menus[contextId] ?? []).filter((menu) => menu !== id) }))
  },

  clearOpenMenus(contextId: string = DEFAULT_MENU_CONTEXT): void {
    if (read(contextId).length === 0) return
    $menus.update((menus) => ({ ...menus, [contextId]: [] }))
  },

  getIsMenuOpen(contextId: string = DEFAULT_MENU_CONTEXT): boolean {
    return read(contextId).length > 0
  },
}
