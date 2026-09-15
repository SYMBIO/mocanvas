import { useEditor, useEditorComponents, useGlobalMenuIsOpen, useValue } from "@mocanvas/editor"
import { createContext, useCallback, useContext, useRef, type ComponentType, type ReactNode } from "react"
import {
  AccessibilityMenu,
  ArrangeMenuSubmenu,
  ClipboardMenuGroup,
  ConversionsMenuGroup,
  EditMenuSubmenu,
  ExportFileContentSubMenu,
  ExtrasGroup,
  GroupOrUngroupMenuItem,
  LockGroup,
  MiscMenuGroup,
  PreferencesGroup,
  ReorderMenuSubmenu,
  SelectAllMenuItem,
  UndoRedoGroup,
  ViewSubmenu,
  ZoomTo100MenuItem,
  ZoomToFitMenuItem,
  ZoomToSelectionMenuItem,
} from "./menu-items"
import {
  TldrawUiDropdownMenuContent,
  TldrawUiDropdownMenuRoot,
  TldrawUiDropdownMenuTrigger,
} from "./ui-dropdown-menu"
import { FloatingLayer } from "./ui-floating"
import { TldrawUiIcon } from "./ui-icon"
import { TldrawUiMenuActionItem, TldrawUiMenuContextProvider, TldrawUiMenuGroup } from "./ui-menu"
import { useBreakpoint, PORTRAIT_BREAKPOINT } from "./ui-breakpoint"
import { useTldrawUiComponents } from "./ui-components"
import type {
  TLUiActionsMenuProps,
  TLUiContextMenuProps,
  TLUiDebugMenuProps,
  TLUiHelpMenuProps,
  TLUiHelperButtonsProps,
  TLUiMainMenuProps,
  TLUiQuickActionsProps,
  TLUiZoomMenuProps,
} from "./ui-components"

/**
 * The default menus.
 *
 * Every one is a pair: a `Default*` panel that owns the frame — the trigger,
 * the open state, the ARIA — and a `Default*Content` that is only the items.
 * An app that wants a different set of items replaces the content and keeps
 * the behaviour; an app that wants a different chrome replaces the panel
 * through its component slot. Neither has to reimplement the other.
 */

// ---------------------------------------------------------------------------
// Main menu
// ---------------------------------------------------------------------------

/** The main menu's items. */
export function DefaultMainMenuContent() {
  return (
    <>
      <EditMenuSubmenu />
      <ViewSubmenu />
      <ExportFileContentSubMenu />
      <ExtrasGroup />
      <PreferencesGroup />
    </>
  )
}

/** The top-left menu. */
export function DefaultMainMenu({ children }: TLUiMainMenuProps) {
  const [isOpen, setIsOpen] = useGlobalMenuIsOpen("main-menu")
  return (
    <TldrawUiDropdownMenuRoot id="main-menu" open={isOpen} onOpenChange={setIsOpen}>
      <TldrawUiDropdownMenuTrigger label="Menu">
        <TldrawUiIcon icon="chevron-down" />
      </TldrawUiDropdownMenuTrigger>
      <TldrawUiDropdownMenuContent label="Menu" side="below">
        <TldrawUiMenuContextProvider type="menu" sourceId="menu">
          {children ?? <DefaultMainMenuContent />}
        </TldrawUiMenuContextProvider>
      </TldrawUiDropdownMenuContent>
    </TldrawUiDropdownMenuRoot>
  )
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

/** The right-click menu's items. */
export function DefaultContextMenuContent() {
  return (
    <>
      <UndoRedoGroup />
      <ClipboardMenuGroup />
      <ConversionsMenuGroup />
      <TldrawUiMenuGroup id="selection">
        <SelectAllMenuItem />
        <GroupOrUngroupMenuItem />
      </TldrawUiMenuGroup>
      <ArrangeMenuSubmenu />
      <ReorderMenuSubmenu />
      <LockGroup />
      <MiscMenuGroup />
    </>
  )
}

/**
 * The right-click menu.
 *
 * Wraps the canvas rather than sitting beside it: the browser fires
 * `contextmenu` at whatever element is under the pointer, so the menu has to
 * own that element. This is why `ContextMenu` and `Canvas` are alternatives in
 * the chrome map — filling this slot takes over rendering the canvas.
 */
export function DefaultContextMenu({ children, disabled }: TLUiContextMenuProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useGlobalMenuIsOpen("context-menu")
  const close = useCallback(() => setIsOpen(false), [setIsOpen])

  return (
    <div
      ref={anchorRef}
      className="mocanvas-context-menu-target"
      style={{ position: "absolute", inset: 0 }}
      onContextMenu={(event) => {
        if (disabled) return
        event.preventDefault()
        setIsOpen(true)
      }}
    >
      {children}
      <FloatingLayer anchorRef={anchorRef} open={isOpen && !disabled} onClose={close} role="menu" label="Actions" className="mocanvas-menu">
        <TldrawUiMenuContextProvider type="context-menu" sourceId="context-menu">
          <DefaultContextMenuContent />
        </TldrawUiMenuContextProvider>
      </FloatingLayer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Actions menu
// ---------------------------------------------------------------------------

/** The actions menu's items: alignment, distribution, reordering. */
export function DefaultActionsMenuContent() {
  return (
    <>
      <TldrawUiMenuGroup id="align" label="Align">
        <TldrawUiMenuActionItem actionId="align-left" />
        <TldrawUiMenuActionItem actionId="align-center-horizontal" />
        <TldrawUiMenuActionItem actionId="align-right" />
        <TldrawUiMenuActionItem actionId="align-top" />
        <TldrawUiMenuActionItem actionId="align-center-vertical" />
        <TldrawUiMenuActionItem actionId="align-bottom" />
      </TldrawUiMenuGroup>
      <TldrawUiMenuGroup id="reorder" label="Reorder">
        <TldrawUiMenuActionItem actionId="bring-forward" />
        <TldrawUiMenuActionItem actionId="send-backward" />
      </TldrawUiMenuGroup>
      <TldrawUiMenuGroup id="edit" label="Edit">
        <TldrawUiMenuActionItem actionId="group" />
        <TldrawUiMenuActionItem actionId="ungroup" />
        <TldrawUiMenuActionItem actionId="duplicate" />
        <TldrawUiMenuActionItem actionId="toggle-lock" />
        <TldrawUiMenuActionItem actionId="delete" />
      </TldrawUiMenuGroup>
    </>
  )
}

/**
 * Where the row of common actions is drawn, which depends on how much room the
 * chrome has.
 *
 * Wide, it belongs in the top-left plate beside the page picker: undo and
 * delete are editing controls, and a bar of them floating over the middle of
 * the canvas is chrome with nowhere to live. Narrow, that plate has no room,
 * so the row docks above the toolbar with the other things a thumb reaches.
 *
 * A host — the menu plate, or the row's own standalone plate — provides this
 * as `true` around what it contains. `DefaultQuickActions` then renders in
 * exactly one place (`hosted === wide`), and the actions menu renders only
 * when something is hosting it, which is what keeps its trigger from landing
 * in the container's top-left corner with no placement at all.
 */
const ActionRowIsHosted = createContext(false)

/** Provides {@link ActionRowIsHosted}. */
export function HostedActionRow({ children }: { children: ReactNode }) {
  return <ActionRowIsHosted.Provider value={true}>{children}</ActionRowIsHosted.Provider>
}

/**
 * Resolve a chrome slot the way the surrounding chrome resolves it.
 *
 * There are two component maps — `TldrawUi` carries its own, `DefaultUi` uses
 * the editor's — and the panels below are rendered by both. Reading only one
 * of them is how the hosted row first rendered nothing at all: the slot was
 * set, in the other map. `null` stays `null`, so `components={{ … : null }}`
 * still means "remove it" even though it is a panel that draws it.
 */
export function useHostedSlot(name: "QuickActions" | "ActionsMenu", fallback: ComponentType): ComponentType | null {
  const fromUi = useTldrawUiComponents()[name] as ComponentType | null | undefined
  const fromEditor = useEditorComponents()[name] as ComponentType | null | undefined
  const set = fromUi !== undefined ? fromUi : fromEditor
  if (set === null) return null
  return set ?? fallback
}

/** The selection-actions menu: a grid of icon buttons. */
export function DefaultActionsMenu({ children }: TLUiActionsMenuProps) {
  const [isOpen, setIsOpen] = useGlobalMenuIsOpen("actions-menu")
  // Only ever at the end of an action row. Rendered on its own — which is how
  // the chrome renders it — it has no placement, and a dropdown trigger with
  // no placement sits in the container's corner.
  const hosted = useContext(ActionRowIsHosted)
  if (!hosted) return null
  return (
    <TldrawUiDropdownMenuRoot id="actions-menu" open={isOpen} onOpenChange={setIsOpen}>
      <TldrawUiDropdownMenuTrigger label="Actions">
        <TldrawUiIcon icon="duplicate" />
      </TldrawUiDropdownMenuTrigger>
      <TldrawUiDropdownMenuContent label="Actions" side="above" className="mocanvas-menu--icons">
        <TldrawUiMenuContextProvider type="small-icons" sourceId="menu">
          {children ?? <DefaultActionsMenuContent />}
        </TldrawUiMenuContextProvider>
      </TldrawUiDropdownMenuContent>
    </TldrawUiDropdownMenuRoot>
  )
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

/** The quick-actions row's items. */
export function DefaultQuickActionsContent() {
  return (
    <>
      <TldrawUiMenuActionItem actionId="undo" />
      <TldrawUiMenuActionItem actionId="redo" />
      <TldrawUiMenuActionItem actionId="delete" />
      <TldrawUiMenuActionItem actionId="duplicate" />
    </>
  )
}

/**
 * The always-visible row of common actions, and the row the actions menu rides
 * at the end of.
 *
 * It used to carry no `mocanvas-panel` class, which is the selector its own
 * rule declares its variables on — so `gap` and `bottom` were both invalid and
 * the row rendered unstyled and cramped at the top of the canvas instead of
 * anywhere it was meant to be.
 *
 * Removing this slot removes the row, and with it the actions menu it carries;
 * an app that wants one without the other replaces this with its own row.
 */
export function DefaultQuickActions({ children }: TLUiQuickActionsProps) {
  const hosted = useContext(ActionRowIsHosted)
  // Where it goes: into the menu plate beside the page picker when the two fit
  // side by side, and onto a row of its own above the toolbar when they do not.
  //
  // The threshold was `TABLET` — 840px — which is about twice what the pair
  // actually needs: a page picker is around 150px and five actions about 220,
  // so 580px is where they stop crowding each other. Everything between the
  // two was spending a whole row of the canvas on five buttons that had room
  // in a plate already on screen.
  const wide = useBreakpoint() >= PORTRAIT_BREAKPOINT.MOBILE
  const ActionsMenu = useHostedSlot("ActionsMenu", DefaultActionsMenu)
  if (hosted !== wide) return null
  const className = hosted ? "mocanvas-action-row" : "mocanvas-panel mocanvas-action-row mocanvas-quick-actions"
  return (
    <div className={className} role="toolbar" aria-label="Quick actions">
      <TldrawUiMenuContextProvider type="icons" sourceId="menu">
        {children ?? <DefaultQuickActionsContent />}
      </TldrawUiMenuContextProvider>
      <HostedActionRow>{ActionsMenu ? <ActionsMenu /> : null}</HostedActionRow>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Zoom menu
// ---------------------------------------------------------------------------

/** The zoom menu's items. */
export function DefaultZoomMenuContent() {
  return (
    <TldrawUiMenuGroup id="zoom">
      <TldrawUiMenuActionItem actionId="zoom-in" />
      <TldrawUiMenuActionItem actionId="zoom-out" />
      <ZoomTo100MenuItem />
      <ZoomToFitMenuItem />
      <ZoomToSelectionMenuItem />
    </TldrawUiMenuGroup>
  )
}

/** The zoom menu; its trigger shows the current zoom level. */
export function DefaultZoomMenu({ children }: TLUiZoomMenuProps) {
  const editor = useEditor()
  const zoom = useValue("zoom", () => Math.round(editor.getZoomLevel() * 100), [editor])
  const [isOpen, setIsOpen] = useGlobalMenuIsOpen("zoom-menu")
  return (
    <TldrawUiDropdownMenuRoot id="zoom-menu" open={isOpen} onOpenChange={setIsOpen}>
      <TldrawUiDropdownMenuTrigger label={`Zoom, currently ${zoom}%`} className="mocanvas-btn--wide">
        {zoom}%
      </TldrawUiDropdownMenuTrigger>
      <TldrawUiDropdownMenuContent label="Zoom" side="above">
        <TldrawUiMenuContextProvider type="menu" sourceId="menu">
          {children ?? <DefaultZoomMenuContent />}
        </TldrawUiMenuContextProvider>
      </TldrawUiDropdownMenuContent>
    </TldrawUiDropdownMenuRoot>
  )
}

// ---------------------------------------------------------------------------
// Help menu
// ---------------------------------------------------------------------------

/** The help menu's items. */
export function DefaultHelpMenuContent() {
  return (
    <TldrawUiMenuGroup id="help">
      <AccessibilityMenu />
      <ExtrasGroup />
    </TldrawUiMenuGroup>
  )
}

/**
 * The help menu.
 *
 * Not in the default chrome, and its trigger is why: it rendered a bare `?`
 * with no plate and no placement, so it sat in the container's top-left
 * corner, under the menu plate. Everything in it — the accessibility
 * preferences, print, the shortcuts dialog — is reachable from the main menu,
 * so there was nothing behind the `?` that was not already one row away.
 *
 * It stays exported and slot-fillable: `components={{ HelpMenu }}` puts it
 * back, now docked at the bottom-right rather than stranded.
 */
export function DefaultHelpMenu({ children }: TLUiHelpMenuProps) {
  const [isOpen, setIsOpen] = useGlobalMenuIsOpen("help-menu")
  return (
    <div className="mocanvas-panel mocanvas-help-dock">
    <TldrawUiDropdownMenuRoot id="help-menu" open={isOpen} onOpenChange={setIsOpen}>
      <TldrawUiDropdownMenuTrigger label="Help">?</TldrawUiDropdownMenuTrigger>
      <TldrawUiDropdownMenuContent label="Help" side="above">
        <TldrawUiMenuContextProvider type="menu" sourceId="menu">
          {children ?? <DefaultHelpMenuContent />}
        </TldrawUiMenuContextProvider>
      </TldrawUiDropdownMenuContent>
    </TldrawUiDropdownMenuRoot>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helper buttons
// ---------------------------------------------------------------------------

/**
 * The helper buttons' items: "back to content", shown only when there is
 * content and none of it is on screen.
 *
 * The condition is the whole feature. A button that is always there is
 * clutter; one that appears exactly when the user has panned into empty space
 * is the difference between a lost document and a recovered one.
 */
export function DefaultHelperButtonsContent() {
  const editor = useEditor()
  const isLost = useValue(
    "is off screen",
    () => {
      const ids = editor.getCurrentPageShapeIds()
      if (ids.size === 0) return false
      const bounds = editor.getCurrentPageBounds()
      if (!bounds) return false
      const viewport = editor.getViewportPageBounds()
      return !viewport.collides(bounds)
    },
    [editor],
  )
  if (!isLost) return null
  return (
    <button type="button" className="mocanvas-btn mocanvas-btn--wide" onClick={() => editor.zoomToFit()}>
      Back to content
    </button>
  )
}

/** The strip of contextual helper buttons above the toolbar. */
export function DefaultHelperButtons({ children }: TLUiHelperButtonsProps) {
  return <div className="mocanvas-helper-buttons">{children ?? <DefaultHelperButtonsContent />}</div>
}

// ---------------------------------------------------------------------------
// Debug menu
// ---------------------------------------------------------------------------

/** The debug menu's items. */
export function DefaultDebugMenuContent() {
  const editor = useEditor()
  return (
    <TldrawUiMenuGroup id="debug">
      <TldrawUiMenuActionItem actionId="toggle-debug-mode" />
      <TldrawUiMenuActionItem actionId="toggle-grid" />
      <TldrawUiMenuActionItem actionId="toggle-transparent" />
      <TldrawUiMenuActionItem actionId="toggle-edge-scrolling" />
      <TldrawUiMenuContextProvider type="menu">
        <button type="button" role="menuitem" className="mocanvas-menu-item" onClick={() => editor.clearHistory()}>
          Clear history
        </button>
      </TldrawUiMenuContextProvider>
    </TldrawUiMenuGroup>
  )
}

/** The debug menu. Rendered only in debug mode by the chrome that hosts it. */
export function DefaultDebugMenu({ children }: TLUiDebugMenuProps) {
  const [isOpen, setIsOpen] = useGlobalMenuIsOpen("debug-menu")
  return (
    <TldrawUiDropdownMenuRoot id="debug-menu" open={isOpen} onOpenChange={setIsOpen}>
      <TldrawUiDropdownMenuTrigger label="Debug">
        <TldrawUiIcon icon="chevron-up" />
      </TldrawUiDropdownMenuTrigger>
      <TldrawUiDropdownMenuContent label="Debug" side="above">
        <TldrawUiMenuContextProvider type="menu" sourceId="menu">
          {children ?? <DefaultDebugMenuContent />}
        </TldrawUiMenuContextProvider>
      </TldrawUiDropdownMenuContent>
    </TldrawUiDropdownMenuRoot>
  )
}

/** Read for its side effect on the type checker only. */
export type TLUiMenuPanelChildren = ReactNode
