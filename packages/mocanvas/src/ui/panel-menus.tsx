import { useEditor, useGlobalMenuIsOpen, useValue } from "@mocanvas/editor"
import { useCallback, useRef, type ReactNode } from "react"
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

/** The selection-actions menu: a grid of icon buttons. */
export function DefaultActionsMenu({ children }: TLUiActionsMenuProps) {
  const [isOpen, setIsOpen] = useGlobalMenuIsOpen("actions-menu")
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

/** The always-visible row of common actions. */
export function DefaultQuickActions({ children }: TLUiQuickActionsProps) {
  return (
    <div className="mocanvas-quick-actions" role="toolbar" aria-label="Quick actions">
      <TldrawUiMenuContextProvider type="icons" sourceId="menu">
        {children ?? <DefaultQuickActionsContent />}
      </TldrawUiMenuContextProvider>
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

/** The help menu. */
export function DefaultHelpMenu({ children }: TLUiHelpMenuProps) {
  const [isOpen, setIsOpen] = useGlobalMenuIsOpen("help-menu")
  return (
    <TldrawUiDropdownMenuRoot id="help-menu" open={isOpen} onOpenChange={setIsOpen}>
      <TldrawUiDropdownMenuTrigger label="Help">?</TldrawUiDropdownMenuTrigger>
      <TldrawUiDropdownMenuContent label="Help" side="above">
        <TldrawUiMenuContextProvider type="menu" sourceId="menu">
          {children ?? <DefaultHelpMenuContent />}
        </TldrawUiMenuContextProvider>
      </TldrawUiDropdownMenuContent>
    </TldrawUiDropdownMenuRoot>
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
