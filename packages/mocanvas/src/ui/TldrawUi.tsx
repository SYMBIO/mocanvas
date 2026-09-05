import { track, useEditor, type TLUiOverrides } from "@mocanvas/editor"
import type { ReactNode } from "react"
import { DefaultActionsMenu, DefaultContextMenu, DefaultHelpMenu, DefaultHelperButtons, DefaultQuickActions } from "./panel-menus"
import { DefaultMenuPanel, DefaultNavigationPanel, OfflineIndicator } from "./panel-navigation"
import { DefaultFollowingIndicator, DefaultSharePanel } from "./panel-people"
import { DefaultRichTextToolbar } from "./panel-richtext"
import { ResponsiveStylePanel } from "./panel-style"
import { DefaultImageToolbar, DefaultVideoToolbar } from "./asset-toolbars"
import { DefaultToolbarWithOverflow } from "./toolbar-items"
import { DefaultA11yAnnouncer } from "./ui-a11y"
import { TldrawUiContextProvider } from "./ui-context-provider"
import { useTldrawUiComponents, type TLUiComponents } from "./ui-components"
import { DefaultDialogs } from "./ui-dialogs"
import type { TLUiEventHandler } from "./ui-events"
import { DefaultToasts } from "./ui-toasts"
import { DefaultDebugPanel } from "./panel-debug"

/**
 * The whole chrome, laid out.
 *
 * Every panel here is read out of the components map first, so the layout is
 * the only thing this component owns: which slots exist, what order they sit
 * in, and which of them are suppressed in focus mode. Replacing a panel never
 * requires replacing this, and replacing this never requires reimplementing a
 * panel.
 */

export interface TldrawUiProps {
  /** Replace or remove a UI panel. */
  components?: TLUiComponents
  /** Rewrite the tool and action lists the panels render from. */
  overrides?: TLUiOverrides
  /** Reported UI events. */
  onUiEvent?: TLUiEventHandler
  /** Render the canvas and the app's own slots, but none of mocanvas's panels. */
  hideUi?: boolean
  /** Pin the layout to its narrowest form. */
  forceMobile?: boolean
  /** The canvas, and anything else that belongs under the chrome. */
  children?: ReactNode
}

/**
 * A slot for whatever an app wants drawn over the canvas but under the panels.
 *
 * `pointer-events: none` on the layer and `auto` on its children, so a badge
 * pinned to a shape is clickable while the empty space around it still pans
 * the canvas.
 */
export function TldrawUiInFrontOfTheCanvas({ children }: { children?: ReactNode }) {
  return (
    <div className="mocanvas-in-front-of-canvas" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {children}
    </div>
  )
}

/** The panels, read from the components map, in layout order. */
const Layout = track(function Layout({ children }: { children?: ReactNode }) {
  const editor = useEditor()
  const c = useTldrawUiComponents()
  const instance = editor.getInstanceState()

  // Focus mode hides the panels and nothing else: the canvas, the dialogs and
  // the announcer stay, because losing them would lose the document rather
  // than tidy the screen.
  const focus = instance.isFocusMode

  const Canvas = c.ContextMenu === null ? null : (c.ContextMenu ?? DefaultContextMenu)
  const canvas = Canvas ? <Canvas>{children}</Canvas> : children

  const slot = <P,>(value: TLUiComponents[keyof TLUiComponents], fallback: React.ComponentType<P> | null) =>
    value === null ? null : ((value as React.ComponentType<P> | undefined) ?? fallback)

  const Toolbar = slot<object>(c.Toolbar, DefaultToolbarWithOverflow)
  const StylePanel = slot<object>(c.StylePanel, ResponsiveStylePanel)
  const NavigationPanel = slot<object>(c.NavigationPanel, DefaultNavigationPanel)
  const MenuPanel = slot<object>(c.MenuPanel, DefaultMenuPanel)
  const ActionsMenu = slot<object>(c.ActionsMenu, DefaultActionsMenu)
  const QuickActions = slot<object>(c.QuickActions, DefaultQuickActions)
  const HelperButtons = slot<object>(c.HelperButtons, DefaultHelperButtons)
  const HelpMenu = slot<object>(c.HelpMenu, DefaultHelpMenu)
  const SharePanel = slot<object>(c.SharePanel, DefaultSharePanel)
  const ImageToolbar = slot<object>(c.ImageToolbar, DefaultImageToolbar)
  const VideoToolbar = slot<object>(c.VideoToolbar, DefaultVideoToolbar)
  const RichTextToolbar = slot<object>(c.RichTextToolbar, DefaultRichTextToolbar)
  const FollowingIndicator = slot<object>(c.FollowingIndicator, DefaultFollowingIndicator)
  const Toasts = slot<object>(c.Toasts, DefaultToasts)
  const Dialogs = slot<object>(c.Dialogs, DefaultDialogs)
  const A11y = slot<object>(c.A11y, DefaultA11yAnnouncer)
  const DebugPanel = slot<object>(c.DebugPanel, DefaultDebugPanel)
  const TopPanel = slot<object>(c.TopPanel, null)
  const PageMenu = slot<object>(c.PageMenu, null)
  const Minimap = slot<object>(c.Minimap, null)
  const CursorChatBubble = slot<object>(c.CursorChatBubble, null)
  const UserPresenceEditor = slot<object>(c.UserPresenceEditor, null)
  const PeopleMenu = slot<object>(c.PeopleMenu, null)
  const KeyboardShortcutsDialog = slot<object>(c.KeyboardShortcutsDialog, null)
  const DebugMenu = slot<object>(c.DebugMenu, null)

  return (
    <>
      {canvas}
      {focus ? null : (
        <>
          {MenuPanel ? <MenuPanel /> : null}
          {PageMenu ? <PageMenu /> : null}
          {TopPanel ? <TopPanel /> : null}
          {QuickActions ? <QuickActions /> : null}
          {ActionsMenu ? <ActionsMenu /> : null}
          {HelperButtons ? <HelperButtons /> : null}
          {Toolbar ? <Toolbar /> : null}
          {StylePanel ? <StylePanel /> : null}
          {NavigationPanel ? <NavigationPanel /> : null}
          {Minimap ? <Minimap /> : null}
          {HelpMenu ? <HelpMenu /> : null}
          {SharePanel ? <SharePanel /> : null}
          {PeopleMenu ? <PeopleMenu /> : null}
          {UserPresenceEditor ? <UserPresenceEditor /> : null}
          {ImageToolbar ? <ImageToolbar /> : null}
          {VideoToolbar ? <VideoToolbar /> : null}
          {RichTextToolbar ? <RichTextToolbar /> : null}
          {CursorChatBubble ? <CursorChatBubble /> : null}
          {FollowingIndicator ? <FollowingIndicator /> : null}
          {KeyboardShortcutsDialog ? <KeyboardShortcutsDialog /> : null}
          {instance.isDebugMode && DebugMenu ? <DebugMenu /> : null}
          {instance.isDebugMode && DebugPanel ? <DebugPanel /> : null}
          <OfflineIndicator />
        </>
      )}
      {Toasts ? <Toasts /> : null}
      {Dialogs ? <Dialogs /> : null}
      {A11y ? <A11y /> : null}
    </>
  )
})

/**
 * mocanvas's chrome, and every context it reads.
 *
 * Wrap the canvas in it. Everything inside — mocanvas's panels and an app's
 * own — sees the same tool list, action list, translations, toasts and dialog
 * stack, which is what makes a replacement panel a drop-in rather than a fork.
 */
export function TldrawUi({ components, overrides, onUiEvent, hideUi, forceMobile, children }: TldrawUiProps) {
  return (
    <TldrawUiContextProvider
      {...(components ? { components } : {})}
      {...(overrides ? { overrides } : {})}
      {...(onUiEvent ? { onUiEvent } : {})}
      {...(forceMobile ? { forceMobile } : {})}
    >
      {hideUi ? children : <Layout>{children}</Layout>}
    </TldrawUiContextProvider>
  )
}
