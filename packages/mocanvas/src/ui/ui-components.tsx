import type { TLUiComponentSlot } from "@mocanvas/editor"
import { createContext, useContext, useMemo, type ReactNode } from "react"

/**
 * The UI half of the chrome override map.
 *
 * `TLComponents` (in the editor package) covers everything, including the
 * canvas layers. This is the strictly-UI subset: the panels and menus that
 * only exist once there is chrome at all. An app hands one object; the two
 * maps are separated so the editor package can define its own slots without
 * depending on the UI package's.
 *
 * Every slot is optional. `undefined` keeps the default, `null` removes it.
 */
export interface TLUiComponents {
  /** The live region the canvas announces through. */
  A11y?: TLUiComponentSlot
  /** The selection actions menu. */
  ActionsMenu?: TLUiComponentSlot<TLUiActionsMenuProps>
  /** The right-click menu. Wraps the canvas, since it owns the trigger. */
  ContextMenu?: TLUiComponentSlot<TLUiContextMenuProps>
  /** The follow-me chat bubble on the local cursor. */
  CursorChatBubble?: TLUiComponentSlot
  /** The debug menu. */
  DebugMenu?: TLUiComponentSlot<TLUiDebugMenuProps>
  /** The frame-statistics chip. */
  DebugPanel?: TLUiComponentSlot
  /** The dialog stack. */
  Dialogs?: TLUiComponentSlot
  /** The banner shown while following another user's camera. */
  FollowingIndicator?: TLUiComponentSlot
  /** The small buttons above the toolbar. */
  HelperButtons?: TLUiComponentSlot<TLUiHelperButtonsProps>
  /** The help menu. */
  HelpMenu?: TLUiComponentSlot<TLUiHelpMenuProps>
  /** The contextual bar over a selected image. */
  ImageToolbar?: TLUiComponentSlot<TLUiImageToolbarProps>
  /** The shortcuts dialog. */
  KeyboardShortcutsDialog?: TLUiComponentSlot<TLUiKeyboardShortcutsDialogProps>
  /** The top-left menu. */
  MainMenu?: TLUiComponentSlot<TLUiMainMenuProps>
  /** The plate the main menu and page menu sit on. */
  MenuPanel?: TLUiComponentSlot
  /** The minimap inside the navigation panel. */
  Minimap?: TLUiComponentSlot
  /** The zoom / minimap cluster. */
  NavigationPanel?: TLUiComponentSlot
  /** The page picker. */
  PageMenu?: TLUiComponentSlot
  /** The collaborator list. */
  PeopleMenu?: TLUiComponentSlot<DefaultPeopleMenuProps>
  /** One collaborator's avatar. */
  PeopleMenuAvatar?: TLUiComponentSlot<TLUiPeopleMenuAvatarProps>
  /** The stacked avatars on the people menu's trigger. */
  PeopleMenuFacePile?: TLUiComponentSlot<TLUiPeopleMenuFacePileProps>
  /** One row in the collaborator list. */
  PeopleMenuItem?: TLUiComponentSlot<TLUiPeopleMenuItemProps>
  /** The undo/redo/duplicate row. */
  QuickActions?: TLUiComponentSlot<TLUiQuickActionsProps>
  /** The formatting bar over a text shape being edited. */
  RichTextToolbar?: TLUiComponentSlot<TLUiRichTextToolbarProps>
  /** The top-right panel. */
  SharePanel?: TLUiComponentSlot
  /** The style panel. */
  StylePanel?: TLUiComponentSlot<TLUiStylePanelProps>
  /** The toast stack. */
  Toasts?: TLUiComponentSlot
  /** The tool bar. */
  Toolbar?: TLUiComponentSlot
  /** The strip above the menu panel. */
  TopPanel?: TLUiComponentSlot
  /** The local person's name and colour editor. */
  UserPresenceEditor?: TLUiComponentSlot
  /** The contextual bar over a selected video. */
  VideoToolbar?: TLUiComponentSlot<TLUiVideoToolbarProps>
  /** The zoom menu. */
  ZoomMenu?: TLUiComponentSlot<TLUiZoomMenuProps>
}

/**
 * The props each panel slot is rendered with.
 *
 * All of them take `children` and nothing else required: a panel reads the
 * editor and the UI lists from context, so a replacement can be written
 * without accepting a wiring prop it would only pass on. `children` is how the
 * `*Content` half is swapped without replacing the panel's frame — the pattern
 * every default panel below is built on.
 */
export interface TLUiMainMenuProps {
  children?: ReactNode
}
export interface TLUiActionsMenuProps {
  children?: ReactNode
}
export interface TLUiContextMenuProps {
  /** The canvas, which the menu has to wrap in order to own the trigger. */
  children?: ReactNode
  /** Disable the menu without removing the canvas it wraps. */
  disabled?: boolean
}
export interface TLUiDebugMenuProps {
  children?: ReactNode
}
export interface TLUiHelpMenuProps {
  children?: ReactNode
}
export interface TLUiHelperButtonsProps {
  children?: ReactNode
}
export interface TLUiKeyboardShortcutsDialogProps {
  children?: ReactNode
}
export interface TLUiQuickActionsProps {
  children?: ReactNode
}
export interface TLUiStylePanelProps {
  /** Render the panel in its compact, popover form. */
  isMobile?: boolean
  children?: ReactNode
}
export interface TLUiZoomMenuProps {
  children?: ReactNode
}
export interface TLUiImageToolbarProps {
  children?: ReactNode
}
export interface TLUiVideoToolbarProps {
  children?: ReactNode
}
export interface TLUiRichTextToolbarProps {
  children?: ReactNode
}
export interface DefaultPeopleMenuProps {
  children?: ReactNode
}
export interface DefaultPeopleMenuContentProps {
  children?: ReactNode
}
export interface TLUiPeopleMenuAvatarProps {
  color: string
  name: string
  /** Diameter in px. */
  size?: number
}
export interface TLUiPeopleMenuItemProps {
  userId: string
  color: string
  name: string
  /** Whether the local user's camera is following this person. */
  isFollowing?: boolean
  onFollow?(): void
}
export interface TLUiPeopleMenuFacePileProps {
  users: readonly { userId: string; color: string; name: string }[]
  /** How many avatars to draw before collapsing the rest into a count. */
  max?: number
}

/** The UI chrome map after defaults and overrides: every slot present. */
export type TLUiComponentsResolved = { [K in keyof TLUiComponents]-?: NonNullable<TLUiComponents[K]> | null }

const ComponentsContext = createContext<TLUiComponents>({})

export interface TLUiComponentsProviderProps {
  /** The app's overrides. */
  overrides?: TLUiComponents
  children?: ReactNode
}

/**
 * Publishes the UI chrome map.
 *
 * Nested providers merge rather than replace, so a host can wrap a subtree —
 * a read-only preview inside an editing app — and override two slots without
 * restating the other twenty-nine.
 */
export function TldrawUiComponentsProvider({ overrides, children }: TLUiComponentsProviderProps) {
  const outer = useContext(ComponentsContext)
  const value = useMemo<TLUiComponents>(() => {
    if (!overrides) return outer
    const merged: Record<string, unknown> = { ...outer }
    for (const [key, slot] of Object.entries(overrides)) {
      if (slot === undefined) continue
      merged[key] = slot
    }
    return merged as TLUiComponents
  }, [outer, overrides])
  return <ComponentsContext.Provider value={value}>{children}</ComponentsContext.Provider>
}

/**
 * The UI chrome map.
 *
 * A slot is `undefined` when nothing has filled it and `null` when it has been
 * removed; both mean "render nothing", which is why callers write
 * `{Comp ? <Comp /> : null}` rather than branching on the two separately.
 */
export function useTldrawUiComponents(): TLUiComponents {
  return useContext(ComponentsContext)
}
