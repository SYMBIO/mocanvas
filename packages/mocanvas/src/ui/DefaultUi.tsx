import { GeoShapeGeoStyle, GEO_SHAPE_KINDS, track, useEditor, useValue, type Editor, type GeoShapeKind } from "@mocanvas/editor"
import { Fragment, useEffect, useRef, useState, type Ref } from "react"
import { Icon, type IconName } from "./icons"
import { Popover, UiTooltip } from "./overlays"
import { StylePanel } from "./StylePanel"
import { debugStatsOpen } from "./useKeyboardShortcuts"
import "./ui.css"

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "")
/** Accelerator prefix for tooltips: `⌘` on Apple platforms, `Ctrl+` elsewhere. */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl+"

const stopPointer = (e: { stopPropagation: () => void }) => e.stopPropagation()

function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// ---------------------------------------------------------------------------
// Toolbar configuration
// ---------------------------------------------------------------------------

export interface ToolbarItem {
  /** Unique key; also the geo kind for geo entries. */
  id: string
  /** Tool id that must be registered for this entry to appear. */
  tool: string
  icon: IconName
  label: string
  /** Displayed in the tooltip, next to the label. */
  shortcut?: string
  /** Geo kind the entry selects, for entries driving the `geo` tool. */
  geo?: GeoShapeKind
  /** Tools outside the default set: shown only when the app registers them. */
  optional?: boolean
}

/** Toolbar entries, grouped; groups are separated by a divider. */
export const TOOLBAR_GROUPS: readonly (readonly ToolbarItem[])[] = [
  [
    { id: "select", tool: "select", icon: "select", label: "Select", shortcut: "V" },
    { id: "hand", tool: "hand", icon: "hand", label: "Hand", shortcut: "H" },
  ],
  [
    { id: "draw", tool: "draw", icon: "draw", label: "Draw", shortcut: "D" },
    { id: "eraser", tool: "eraser", icon: "eraser", label: "Eraser", shortcut: "E" },
  ],
  [
    { id: "rectangle", tool: "geo", icon: "geo-rectangle", label: "Rectangle", shortcut: "R", geo: "rectangle" },
    { id: "ellipse", tool: "geo", icon: "geo-ellipse", label: "Ellipse", shortcut: "O", geo: "ellipse" },
    { id: "triangle", tool: "geo", icon: "geo-triangle", label: "Triangle", geo: "triangle" },
    { id: "diamond", tool: "geo", icon: "geo-diamond", label: "Diamond", geo: "diamond" },
    { id: "star", tool: "geo", icon: "geo-star", label: "Star", geo: "star" },
  ],
  [
    { id: "text", tool: "text", icon: "text", label: "Text", shortcut: "T" },
    { id: "note", tool: "note", icon: "note", label: "Note", shortcut: "N" },
    { id: "arrow", tool: "arrow", icon: "arrow", label: "Arrow", shortcut: "A", optional: true },
    { id: "line", tool: "line", icon: "line", label: "Line", shortcut: "L", optional: true },
    { id: "frame", tool: "frame", icon: "frame", label: "Frame", shortcut: "F", optional: true },
  ],
]

/** Geo kinds that live behind the "more shapes" popover. */
export const PRIMARY_GEO_KINDS: readonly GeoShapeKind[] = TOOLBAR_GROUPS.flat()
  .map((t) => t.geo)
  .filter((g): g is GeoShapeKind => g !== undefined)

export const MORE_GEO_KINDS: readonly GeoShapeKind[] = GEO_SHAPE_KINDS.filter((k) => !PRIMARY_GEO_KINDS.includes(k))

/** Tool ids the editor currently has registered. */
function registeredTools(editor: Editor): Set<string> {
  return new Set(Object.keys(editor.root.children ?? {}))
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

/** Bottom toolbar: tools, grouped, plus a popover with the rest of the shapes. */
export const Toolbar = track(function Toolbar() {
  const editor = useEditor()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)

  const available = registeredTools(editor)
  const toolId = editor.getCurrentToolId()
  const geo = toolId === "geo" ? ((editor.getStateDescendant("geo") as { geo?: GeoShapeKind } | undefined)?.geo ?? "rectangle") : null

  const pickGeo = (kind: GeoShapeKind) => {
    editor.setStyleForNextShapes(GeoShapeGeoStyle, kind)
    editor.setCurrentTool("geo", { geo: kind, force: true })
  }

  const groups = TOOLBAR_GROUPS.map((group) => group.filter((item) => available.has(item.tool))).filter((group) => group.length > 0)
  const hasGeo = available.has("geo") && MORE_GEO_KINDS.length > 0
  const moreActive = toolId === "geo" && geo !== null && !PRIMARY_GEO_KINDS.includes(geo)

  return (
    <div className="mocanvas-panel mocanvas-toolbar" role="toolbar" aria-label="Tools" onPointerDown={stopPointer}>
      {groups.map((group, i) => (
        <Fragment key={group[0]!.id}>
          {i > 0 ? <span className="mocanvas-divider" aria-hidden="true" /> : null}
          {group.map((item) => (
            <UiButton
              key={item.id}
              icon={item.icon}
              label={item.label}
              {...(item.shortcut ? { shortcut: item.shortcut } : {})}
              pressed={item.tool === toolId && (item.geo === undefined || item.geo === geo)}
              onClick={() => (item.geo ? pickGeo(item.geo) : editor.setCurrentTool(item.tool))}
            />
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
                      pickGeo(kind)
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
export const DebugStats = track(function DebugStats({ editor }: { editor: Editor }) {
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

export function DefaultUi({ editor, showStats = true }: { editor: Editor; showStats?: boolean }) {
  const statsOpen = useValue(debugStatsOpen)
  useEffect(() => {
    debugStatsOpen.set(showStats)
  }, [showStats])
  return (
    <>
      <Toolbar />
      <ZoomBar />
      <StylePanel />
      {statsOpen ? <DebugStats editor={editor} /> : null}
      <UiTooltip />
    </>
  )
}
