import {
  GeoShapeGeoStyle,
  MocanvasUiProvider,
  track,
  useEditor,
  useEditorComponents,
  useIsToolSelected,
  useTools,
  useValue,
  type Editor,
  type GeoShapeKind,
  type TLComponents,
  type TLComponentsResolved,
  type TLUiOverrides,
} from "@mocanvas/editor"
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react"
import { MocanvasUiMenuItem } from "./DefaultToolbar"
import { Icon, type IconName } from "./icons"
import { Popover, UiTooltip } from "./overlays"
import { StylePanel } from "./StylePanel"
import { MORE_GEO_KINDS, PRIMARY_GEO_KINDS, TOOLBAR_GROUPS, type ToolbarItem } from "./toolbar-config"
import { buildDefaultActionItems, buildDefaultToolItems, registeredToolIds } from "./tools-context"
import { ToolShortcuts } from "./useToolShortcuts"
import { ActionShortcuts } from "./useActionShortcuts"
import { SelectionAnnouncer } from "./ui-a11y"
import { debugStatsOpen } from "./useKeyboardShortcuts"
import "./ui.css"

// The toolbar's contents moved to `toolbar-config` (data, no React) so the UI
// tool list can be built without importing the components. Re-exported here so
// the module that has always published them still does.
export { MORE_GEO_KINDS, PRIMARY_GEO_KINDS, TOOLBAR_GROUPS }
export type { ToolbarItem }

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "")
/** Accelerator prefix for tooltips: `⌘` on Apple platforms, `Ctrl+` elsewhere. */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl+"

const stopPointer = (e: { stopPropagation: () => void }) => e.stopPropagation()

function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// ---------------------------------------------------------------------------
// Shared button
// ---------------------------------------------------------------------------

interface UiButtonProps {
  icon: IconName
  label: string
  shortcut?: string
  pressed?: boolean
  expanded?: boolean
  disabled?: boolean
  className?: string
  ref?: Ref<HTMLButtonElement>
  onClick: () => void
}

function UiButton({ icon, label, shortcut, pressed, expanded, disabled, className, ref, onClick }: UiButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      className={className ? `mocanvas-btn ${className}` : "mocanvas-btn"}
      aria-label={label}
      data-tooltip={label}
      {...(shortcut ? { "data-shortcut": shortcut } : {})}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
      {...(disabled ? { disabled: true } : {})}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

/**
 * One toolbar button driven by the UI tool list. Renders nothing when the
 * item is not registered — the normal state for an optional tool on an editor
 * that was built without it.
 */
function ToolItem({ id }: { id: string }) {
  const tools = useTools()
  const tool = tools[id]
  const isSelected = useIsToolSelected(tool)
  if (!tool) return null
  return <MocanvasUiMenuItem {...tool} isSelected={isSelected} />
}

/**
 * The default tool bar: the grouped tools, plus a popover holding the geo
 * kinds that have no button of their own.
 *
 * Built from the UI tool list, so an app's `TLUiOverrides.tools` — relabelling
 * a tool, rebinding its key, adding one of its own — shows up here without
 * replacing the component.
 */
export const Toolbar = track(function Toolbar() {
  const editor = useEditor()
  const tools = useTools()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)

  const toolId = editor.getCurrentToolId()
  const geo = toolId === "geo" ? ((editor.getStateDescendant("geo") as { geo?: GeoShapeKind } | undefined)?.geo ?? "rectangle") : null

  // Groups whose entries the tool list actually has; an app that trimmed the
  // tool set, or an override that removed an item, empties a group away.
  const groups = TOOLBAR_GROUPS.map((group) => group.filter((item) => tools[item.id] !== undefined)).filter((group) => group.length > 0)
  const hasGeo = registeredToolIds(editor).has("geo") && MORE_GEO_KINDS.length > 0
  const moreActive = toolId === "geo" && geo !== null && !PRIMARY_GEO_KINDS.includes(geo)

  // Any item an override added that is not part of the default layout. It gets
  // a place rather than being silently dropped, which is what a custom tool
  // registered through `overrides.tools` needs to be usable at all.
  const known = new Set(TOOLBAR_GROUPS.flat().map((item) => item.id))
  const extras = Object.keys(tools).filter((id) => !known.has(id) && !MORE_GEO_KINDS.includes(id as GeoShapeKind))

  return (
    <div className="mocanvas-panel mocanvas-toolbar" role="toolbar" aria-label="Tools" onPointerDown={stopPointer}>
      {groups.map((group, i) => (
        <Fragment key={group[0]!.id}>
          {i > 0 ? <span className="mocanvas-divider" aria-hidden="true" /> : null}
          {group.map((item) => (
            <ToolItem key={item.id} id={item.id} />
          ))}
          {hasGeo && group.some((item) => item.geo) ? (
            <span className="mocanvas-more">
              <UiButton
                ref={moreRef}
                icon="chevron-down"
                label="More shapes"
                pressed={moreActive}
                expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
              />
              <Popover anchorRef={moreRef} open={moreOpen} onClose={() => setMoreOpen(false)} label="More shapes" prefer="above">
                {MORE_GEO_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitemradio"
                    className="mocanvas-btn"
                    aria-label={titleCase(kind)}
                    aria-checked={geo === kind}
                    data-tooltip={titleCase(kind)}
                    onClick={() => {
                      editor.setStyleForNextShapes(GeoShapeGeoStyle, kind)
                      editor.setCurrentTool("geo", { geo: kind, force: true })
                      setMoreOpen(false)
                    }}
                  >
                    <Icon name={`geo-${kind}`} />
                  </button>
                ))}
              </Popover>
            </span>
          ) : null}
        </Fragment>
      ))}
      {extras.length > 0 ? (
        <>
          <span className="mocanvas-divider" aria-hidden="true" />
          {extras.map((id) => (
            <ToolItem key={id} id={id} />
          ))}
        </>
      ) : null}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Zoom bar
// ---------------------------------------------------------------------------

/** Zoom controls and undo/redo. */
export const ZoomBar = track(function ZoomBar() {
  const editor = useEditor()
  const zoom = Math.round(editor.getZoomLevel() * 100)
  return (
    <div className="mocanvas-panel mocanvas-zoombar" role="toolbar" aria-label="View" onPointerDown={stopPointer}>
      <UiButton icon="zoom-out" label="Zoom out" shortcut={`${MOD_KEY}−`} onClick={() => editor.zoomOut()} />
      <button
        type="button"
        className="mocanvas-btn mocanvas-btn--wide"
        aria-label={`Reset zoom, currently ${zoom}%`}
        data-tooltip="Reset zoom"
        data-shortcut={`${MOD_KEY}0`}
        onClick={() => editor.resetZoom()}
      >
        {zoom}%
      </button>
      <UiButton icon="zoom-in" label="Zoom in" shortcut={`${MOD_KEY}+`} onClick={() => editor.zoomIn()} />
      <UiButton icon="zoom-fit" label="Zoom to fit" shortcut={`${MOD_KEY}1`} onClick={() => editor.zoomToFit()} />
      <span className="mocanvas-divider" aria-hidden="true" />
      <UiButton icon="undo" label="Undo" shortcut={`${MOD_KEY}Z`} disabled={!editor.getCanUndo()} onClick={() => editor.undo()} />
      <UiButton icon="redo" label="Redo" shortcut={`${MOD_KEY}⇧Z`} disabled={!editor.getCanRedo()} onClick={() => editor.redo()} />
    </div>
  )
})

// ---------------------------------------------------------------------------
// Debug stats
// ---------------------------------------------------------------------------

/** Compact frame-statistics chip. Toggled with ⌥D. */
export const DebugStats = track(function DebugStats() {
  const editor = useEditor()
  const stats = editor.getLastFrameStats()
  const count = editor.getCurrentPageShapeIds().size
  return (
    <div className="mocanvas-panel mocanvas-stats" role="status" aria-label="Frame statistics" onPointerDown={stopPointer}>
      <span>
        <b>{count}</b> shapes · <b>{editor.engine.shapeCount}</b> engine
      </span>
      <span>
        <b>{stats.drawn}</b> drawn · <b>{stats.culled}</b> culled
      </span>
      <span>
        <b>{stats.ms.toFixed(2)}</b> ms/frame
      </span>
    </div>
  )
})

// ---------------------------------------------------------------------------
// The chrome
// ---------------------------------------------------------------------------

/**
 * The chrome mocanvas renders when an app overrides nothing. Every entry is a
 * slot an app can replace or remove through `components`.
 */
export const defaultComponents: TLComponents = {
  Toolbar,
  NavigationPanel: ZoomBar,
  StylePanel,
  DebugPanel: DebugStats,
  Tooltip: UiTooltip,
}

/**
 * Feeds the `Grid` slot the camera it draws from, and mounts it only while the
 * editor is in grid mode.
 *
 * The subscription lives here rather than in the slot so the camera is read
 * once per frame no matter how many layers want it — and so a grid component
 * can be a pure function of its props, which is what makes it testable.
 */
const GridLayer = track(function GridLayer({ Grid }: { Grid: NonNullable<TLComponentsResolved["Grid"]> }) {
  const editor = useEditor()
  if (!editor.getInstanceState().isGridMode) return null
  const camera = editor.getCamera()
  return <Grid x={camera.x} y={camera.y} z={camera.z} size={editor.getDocumentSettings().gridSize} />
})

/**
 * Reads the merged chrome map and lays the panels out.
 *
 * ## Why the canvas is rendered from here
 * The canvas is a slot like everything else, and it is rendered FIRST, because
 * some chrome has to *wrap* it: a right-click menu owns the DOM node the
 * browser fires `contextmenu` at, so it renders `useEditorComponents().Canvas`
 * inside its own trigger. When a `ContextMenu` slot is filled it therefore
 * takes over rendering the canvas and the bare `Canvas` slot is skipped —
 * rendering both would mount two canvases.
 *
 * `hidePanels` (mocanvas's `hideUi`) suppresses the panels below and nothing
 * else: an editor with no chrome still has a canvas, and an app that supplied
 * its own context menu still gets it.
 */
function Chrome({ showStats, hidePanels }: { showStats: boolean; hidePanels: boolean }) {
  const c = useEditorComponents()
  const statsOpen = useValue(debugStatsOpen)
  useEffect(() => {
    debugStatsOpen.set(showStats)
  }, [showStats])
  const canvas = c.ContextMenu ? <c.ContextMenu /> : c.Canvas ? <c.Canvas /> : null
  if (hidePanels) return canvas
  return (
    <>
      {canvas}
      {c.Background ? <c.Background /> : null}
      {c.Grid ? <GridLayer Grid={c.Grid} /> : null}
      {c.OnTheCanvas ? <c.OnTheCanvas /> : null}
      {c.Toolbar ? <c.Toolbar /> : null}
      {c.NavigationPanel ? <c.NavigationPanel /> : null}
      {c.StylePanel ? <c.StylePanel /> : null}
      {c.MenuPanel ? <c.MenuPanel /> : null}
      {c.PageMenu ? <c.PageMenu /> : null}
      {c.ActionsMenu ? <c.ActionsMenu /> : null}
      {c.QuickActions ? <c.QuickActions /> : null}
      {c.HelperButtons ? <c.HelperButtons /> : null}
      {c.ImageToolbar ? <c.ImageToolbar /> : null}
      {c.VideoToolbar ? <c.VideoToolbar /> : null}
      {c.RichTextToolbar ? <c.RichTextToolbar /> : null}
      {c.SharePanel ? <c.SharePanel /> : null}
      {c.TopPanel ? <c.TopPanel /> : null}
      {/* Slots mocanvas ships no default for. They are rendered here so that
          filling one through `components` puts it on screen, rather than
          requiring the app to replace the whole chrome to place it. */}
      {c.MainMenu ? <c.MainMenu /> : null}
      {c.HelpMenu ? <c.HelpMenu /> : null}
      {c.Minimap ? <c.Minimap /> : null}
      {c.PeopleMenu ? <c.PeopleMenu /> : null}
      {c.UserPresenceEditor ? <c.UserPresenceEditor /> : null}
      {c.FollowingIndicator ? <c.FollowingIndicator /> : null}
      {c.CursorChatBubble ? <c.CursorChatBubble /> : null}
      {c.DebugMenu ? <c.DebugMenu /> : null}
      {statsOpen && c.DebugPanel ? <c.DebugPanel /> : null}
      {c.InFrontOfTheCanvas ? <c.InFrontOfTheCanvas /> : null}
      {c.Toasts ? <c.Toasts /> : null}
      {c.Dialogs ? <c.Dialogs /> : null}
      {c.A11y ? <c.A11y /> : null}
      {c.Tooltip ? <c.Tooltip /> : null}
      <ToolShortcuts />
      <ActionShortcuts />
      <SelectionAnnouncer />
    </>
  )
}

export interface DefaultUiProps {
  editor: Editor
  /** Replace (`ComponentType`) or remove (`null`) a chrome slot. */
  components?: TLComponents
  /** Rewrite the tool and action lists the chrome renders from. */
  overrides?: TLUiOverrides
  showStats?: boolean
  /**
   * The canvas, which is published as the `Canvas` chrome slot and rendered
   * through it. Omit it (as tests of the chrome alone do) and the slot stays
   * empty; an app can still fill it itself.
   */
  canvas?: ReactNode
  /**
   * Render the canvas and the app's own slots, but none of mocanvas's panels.
   * `Mocanvas`'s `hideUi`.
   */
  hidePanels?: boolean
  /** Rendered inside the UI context, so it can use `useTools()` and friends. */
  children?: ReactNode
}

/**
 * mocanvas's chrome, and the context every part of it reads.
 *
 * Customisation goes through the two override maps rather than around them:
 * `components` swaps a panel out, `overrides` rewrites the tool and action
 * lists that the panels — mocanvas's own or the app's — render from. Both are
 * live for anything rendered inside, including a `components.Toolbar` of the
 * app's own, which is why a custom toolbar can call `useTools()` and get the
 * same list the default one would have used.
 */
export function DefaultUi({ editor, components, overrides, showStats = true, canvas, hidePanels = false, children }: DefaultUiProps) {
  // The canvas node becomes a component so it can live in the slot map, which
  // is what lets an app's context menu render it from inside its own trigger.
  // Memoised on the node: a fresh component identity every render would
  // remount the whole canvas, engine and all.
  const defaults = useMemo<TLComponents>(() => {
    if (canvas === undefined) return defaultComponents
    const CanvasSlot = () => <>{canvas}</>
    CanvasSlot.displayName = "MocanvasCanvasSlot"
    return { ...defaultComponents, Canvas: CanvasSlot }
  }, [canvas])

  return (
    <MocanvasUiProvider
      editor={editor}
      defaultComponents={defaults}
      defaultTools={buildDefaultToolItems}
      defaultActions={buildDefaultActionItems}
      {...(components ? { components } : {})}
      {...(overrides ? { overrides } : {})}
    >
      <Chrome showStats={showStats} hidePanels={hidePanels} />
      {children}
    </MocanvasUiProvider>
  )
}
