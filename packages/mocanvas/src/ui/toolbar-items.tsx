import { GeoShapeGeoStyle, track, useEditor, useIsToolSelected, useTools, type GeoShapeKind } from "@mocanvas/editor"
import { Children, useEffect, useRef, useState, type ReactNode } from "react"
import { Icon, ICONS, type IconName } from "./icons"
import { TldrawUiPopover, TldrawUiPopoverContent, TldrawUiPopoverTrigger } from "./ui-popover"
import { TldrawUiToolbar, TldrawUiToolbarButton } from "./ui-toolbar"
import { MobileStylePanel } from "./panel-style"
import { useBreakpoint, PORTRAIT_BREAKPOINT } from "./ui-breakpoint"

/**
 * The toolbar's buttons, one exported component per tool.
 *
 * They are components rather than a data list so a caller can compose its own
 * bar out of exactly the tools it wants — `<DrawToolbarItem />
 * <EraserToolbarItem />` — while each button keeps the behaviour that makes it
 * correct: it reads the tool from the UI tool list, so it disappears when the
 * tool is not registered, follows an override's relabelling, and shows itself
 * as pressed when its tool is the current one.
 */

export interface ToolbarItemProps {
  /** The id of an entry in the UI tool list. */
  tool: string
  /** Override the item's own label. */
  label?: string
  /** Override the item's own icon. */
  icon?: string
}

/**
 * One toolbar button, driven by the tool list.
 *
 * Named `TldrawUiToolbarItem` rather than `ToolbarItem`, which is already the
 * name of the toolbar's *configuration* record in `toolbar-config`.
 *
 * Renders nothing when the tool is not registered. That is the load-bearing
 * behaviour: an editor built without the arrow tool simply has no arrow
 * button, rather than one that throws when pressed.
 */
export const TldrawUiToolbarItem = track(function TldrawUiToolbarItem({ tool: toolId, label, icon }: ToolbarItemProps) {
  const tools = useTools()
  const tool = tools[toolId]
  const isSelected = useIsToolSelected(tool)
  if (!tool) return null
  const name = icon ?? tool.icon
  const text = label ?? tool.label
  const known = Object.prototype.hasOwnProperty.call(ICONS, name)
  return (
    <TldrawUiToolbarButton
      type="tool"
      isActive={isSelected}
      title={text}
      data-tool={tool.id}
      {...(tool.disabled ? { disabled: true } : {})}
      onClick={() => tool.onSelect("toolbar")}
    >
      {known ? <Icon name={name as IconName} /> : <span className="mocanvas-btn-glyph">{text.slice(0, 1).toUpperCase()}</span>}
    </TldrawUiToolbarButton>
  )
})

/** A geo-kind button: selects the geo tool *and* the kind. */
export const GeoToolbarItem = track(function GeoToolbarItem({ geo, label }: { geo: GeoShapeKind; label?: string }) {
  const editor = useEditor()
  const tools = useTools()
  const tool = tools[geo] ?? tools["geo"]
  const current = editor.getCurrentToolId() === "geo" ? ((editor.getStateDescendant("geo") as { geo?: GeoShapeKind } | undefined)?.geo ?? "rectangle") : null
  if (!tool) return null
  const text = label ?? geo.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  return (
    <TldrawUiToolbarButton
      type="tool"
      isActive={current === geo}
      title={text}
      data-tool={geo}
      onClick={() => {
        editor.setStyleForNextShapes(GeoShapeGeoStyle, geo)
        editor.setCurrentTool("geo", { geo, force: true })
      }}
    >
      <Icon name={`geo-${geo}`} />
    </TldrawUiToolbarButton>
  )
})

// ---- tools -------------------------------------------------------------------

/** The select tool. */
export const SelectToolbarItem = () => <TldrawUiToolbarItem tool="select" />
/** The hand (pan) tool. */
export const HandToolbarItem = () => <TldrawUiToolbarItem tool="hand" />
/** The freehand draw tool. */
export const DrawToolbarItem = () => <TldrawUiToolbarItem tool="draw" />
/** The eraser. */
export const EraserToolbarItem = () => <TldrawUiToolbarItem tool="eraser" />
/** The arrow tool. */
export const ArrowToolbarItem = () => <TldrawUiToolbarItem tool="arrow" />
/** The line tool. */
export const LineToolbarItem = () => <TldrawUiToolbarItem tool="line" />
/** The text tool. */
export const TextToolbarItem = () => <TldrawUiToolbarItem tool="text" />
/** The sticky-note tool. */
export const NoteToolbarItem = () => <TldrawUiToolbarItem tool="note" />
/** The frame tool. */
export const FrameToolbarItem = () => <TldrawUiToolbarItem tool="frame" />
/** The highlighter. */
export const HighlightToolbarItem = () => <TldrawUiToolbarItem tool="highlight" />
/** The laser pointer. */
export const LaserToolbarItem = () => <TldrawUiToolbarItem tool="laser" />
/** The image / media placer. */
export const AssetToolbarItem = () => <TldrawUiToolbarItem tool="asset" label="Media" icon="image" />
/** The commenting tool. */
export const CommentToolbarItem = () => <TldrawUiToolbarItem tool="comment" />

// ---- geo kinds ---------------------------------------------------------------

/** Rectangle. */
export const RectangleToolbarItem = () => <GeoToolbarItem geo="rectangle" />
/** Ellipse. */
export const EllipseToolbarItem = () => <GeoToolbarItem geo="ellipse" />
/** Triangle. */
export const TriangleToolbarItem = () => <GeoToolbarItem geo="triangle" />
/** Diamond. */
export const DiamondToolbarItem = () => <GeoToolbarItem geo="diamond" />
/** Hexagon. */
export const HexagonToolbarItem = () => <GeoToolbarItem geo="hexagon" />
/** Star. */
export const StarToolbarItem = () => <GeoToolbarItem geo="star" />
/** Rhombus. */
export const RhombusToolbarItem = () => <GeoToolbarItem geo="rhombus" />
/** Oval. */
export const OvalToolbarItem = () => <GeoToolbarItem geo="oval" />
/** Trapezoid. */
export const TrapezoidToolbarItem = () => <GeoToolbarItem geo="trapezoid" />
/** Cloud. */
export const CloudToolbarItem = () => <GeoToolbarItem geo="cloud" />
/** Heart. */
export const HeartToolbarItem = () => <GeoToolbarItem geo="heart" />
/** X box. */
export const XBoxToolbarItem = () => <GeoToolbarItem geo="x-box" />
/** Check box. */
export const CheckBoxToolbarItem = () => <GeoToolbarItem geo="check-box" />
/** Arrow pointing right. */
export const ArrowRightToolbarItem = () => <GeoToolbarItem geo="arrow-right" />
/** Arrow pointing left. */
export const ArrowLeftToolbarItem = () => <GeoToolbarItem geo="arrow-left" />
/** Arrow pointing up. */
export const ArrowUpToolbarItem = () => <GeoToolbarItem geo="arrow-up" />
/** Arrow pointing down. */
export const ArrowDownToolbarItem = () => <GeoToolbarItem geo="arrow-down" />

// ---- tool lock ---------------------------------------------------------------

export interface ToggleToolLockedButtonProps {
  activeTool?: string
  className?: string
}

/**
 * The padlock at the end of the toolbar: keep the current tool after drawing.
 *
 * Hidden for the tools it makes no difference to — select and hand do not
 * "finish" — because a control that is present but inert teaches the user
 * nothing.
 */
export const ToggleToolLockedButton = track(function ToggleToolLockedButton({ className }: ToggleToolLockedButtonProps) {
  const editor = useEditor()
  const toolId = editor.getCurrentToolId()
  if (toolId === "select" || toolId === "hand" || toolId === "eraser") return null
  const locked = editor.getInstanceState().isToolLocked
  return (
    <TldrawUiToolbarButton
      type="icon"
      isActive={locked}
      title="Tool lock"
      {...(className ? { className } : {})}
      onClick={() => editor.updateInstanceState({ isToolLocked: !locked })}
    >
      <Icon name={locked ? "lock" : "unlock"} />
    </TldrawUiToolbarButton>
  )
})

// ---- the bar -----------------------------------------------------------------

/**
 * The default set of toolbar buttons, in order.
 *
 * An array rather than markup, because {@link OverflowingToolbar} splits its
 * children one by one: handed `<DefaultToolbarContent />` it would see a
 * single opaque child and could only move the whole bar into the popover at
 * once. `Children.toArray` flattens a nested array, so spreading this list
 * into the bar gives it the per-button children it measures against.
 */
export const DEFAULT_TOOLBAR_ITEMS: readonly ReactNode[] = [
  <SelectToolbarItem key="select" />,
  <HandToolbarItem key="hand" />,
  <DrawToolbarItem key="draw" />,
  <HighlightToolbarItem key="highlight" />,
  <EraserToolbarItem key="eraser" />,
  <LaserToolbarItem key="laser" />,
  <ArrowToolbarItem key="arrow" />,
  <TextToolbarItem key="text" />,
  <NoteToolbarItem key="note" />,
  <RectangleToolbarItem key="rectangle" />,
  <EllipseToolbarItem key="ellipse" />,
  <TriangleToolbarItem key="triangle" />,
  <DiamondToolbarItem key="diamond" />,
  <StarToolbarItem key="star" />,
  <LineToolbarItem key="line" />,
  <FrameToolbarItem key="frame" />,
  <AssetToolbarItem key="asset" />,
]

/**
 * The default set of toolbar buttons, in order.
 *
 * Every one of them removes itself when its tool is absent, so this same list
 * is correct for an editor with three tools and for one with fifteen.
 */
export function DefaultToolbarContent() {
  return <>{DEFAULT_TOOLBAR_ITEMS}</>
}

export interface OverflowingToolbarProps {
  label?: string
  /** How many children stay inline before the rest move into the popover. */
  maxInline?: number
  children?: ReactNode
}

/** The layout metrics, read from the same custom properties the CSS uses. */
interface BarMetrics {
  /** Width one button occupies, including the gap after it. */
  slot: number
  /** Width unavailable to the bar: its own padding plus the side docks. */
  reserved: number
}

const FALLBACK_METRICS: BarMetrics = { slot: 42, reserved: 634 }

/**
 * How wide a button is and how much of the row the bar may not use.
 *
 * Read off the element rather than hard-coded, so restyling the chrome through
 * the custom properties moves the split with it instead of leaving the two
 * descriptions of the same layout to drift apart.
 */
function readBarMetrics(el: HTMLElement): BarMetrics {
  if (typeof getComputedStyle !== "function") return FALLBACK_METRICS
  const style = getComputedStyle(el)
  const px = (name: string, fallback: number) => {
    const value = Number.parseFloat(style.getPropertyValue(name))
    return Number.isFinite(value) ? value : fallback
  }
  const pad = px("--mocanvas-ui-pad", 4)
  const inset = px("--mocanvas-ui-inset", 12)
  const dock = px("--mocanvas-ui-dock", 300)
  return {
    slot: px("--mocanvas-ui-btn", 40) + px("--mocanvas-ui-gap", 2),
    // Matches `.mocanvas-toolbar`'s `max-width`, plus the plate's own padding
    // and 1px border on each side.
    reserved: 2 * (inset + dock + pad + 1),
  }
}

/**
 * A toolbar that moves whatever will not fit into a "more" popover.
 *
 * The split is measured, not guessed, so the same component works in a 320px
 * phone frame and in a 1600px desktop one without the caller configuring
 * anything.
 *
 * ## Why the *container* is measured, not the bar
 * The plate is `width: max-content`, so its own width is a consequence of how
 * many children it is currently showing. Deriving the split from that is a
 * feedback loop: dropping a button narrows the bar, which drops another. The
 * room available to it — the container, less what the CSS reserves for the
 * docks on either side — is independent of the decision, so the split settles.
 *
 * A child that renders nothing still takes a slot, so a caller mapping over a
 * fixed list gets a split that does not jump around as tools appear.
 */
export function OverflowingToolbar({ label = "Tools", maxInline, children }: OverflowingToolbarProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState<number | null>(null)
  const [metrics, setMetrics] = useState<BarMetrics>(FALLBACK_METRICS)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    const el = barRef.current
    const container = el?.parentElement
    if (!el || !container || typeof ResizeObserver === "undefined") return
    const update = () => {
      setMetrics(readBarMetrics(el))
      const width = container.getBoundingClientRect().width
      // A zero width is an unlaid-out or headless container, not a bar with no
      // room: treat it as "not measured" and show everything.
      setAvailable(width > 0 ? width : null)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  const items = Children.toArray(children)
  // Before the first measurement, assume everything fits: a bar that starts
  // full and settles narrower reads as layout, one that starts collapsed reads
  // as a glitch.
  const room = available === null ? null : available - metrics.reserved
  const fits =
    room === null || items.length * metrics.slot <= room
      ? items.length
      : // One slot goes to the "more" button itself.
        Math.max(1, Math.floor(room / metrics.slot) - 1)
  const limit = Math.min(maxInline ?? items.length, fits)
  const inline = items.slice(0, limit)
  const overflow = items.slice(limit)

  return (
    <TldrawUiToolbar ref={barRef} label={label}>
      {inline}
      {overflow.length > 0 ? (
        <TldrawUiPopover id="toolbar-overflow" side="above" open={moreOpen} onOpenChange={setMoreOpen}>
          <TldrawUiPopoverTrigger className="mocanvas-btn" label="More tools">
            <Icon name="chevron-down" />
          </TldrawUiPopoverTrigger>
          <TldrawUiPopoverContent label="More tools">
            {/* Picking a tool closes the panel: it is the toolbar's spill-over,
                not a palette to stay open while you work. */}
            <div className="mocanvas-toolbar-overflow" onClick={() => setMoreOpen(false)}>
              {overflow}
            </div>
          </TldrawUiPopoverContent>
        </TldrawUiPopover>
      ) : null}
    </TldrawUiToolbar>
  )
}

/**
 * The toolbar, with the mobile style trigger beside it on narrow layouts.
 *
 * The style panel has nowhere to dock on a phone, so it travels with the
 * toolbar instead of disappearing.
 */
export function DefaultToolbarWithOverflow() {
  const breakpoint = useBreakpoint()
  return (
    <OverflowingToolbar label="Tools">
      {DEFAULT_TOOLBAR_ITEMS}
      <ToggleToolLockedButton />
      {breakpoint < PORTRAIT_BREAKPOINT.TABLET_SM ? <MobileStylePanel /> : null}
    </OverflowingToolbar>
  )
}
