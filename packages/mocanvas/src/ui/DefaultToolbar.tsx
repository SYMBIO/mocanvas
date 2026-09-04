import { stopEventPropagation, type TLUiEventSource, type TLUiToolItem } from "@mocanvas/editor"
import { Children, useEffect, useRef, useState, type ReactNode } from "react"
import { Icon, ICONS, type IconName } from "./icons"
import { Popover } from "./overlays"
import "./ui.css"

/**
 * The toolbar shell and the button that goes in it.
 *
 * Split out from `DefaultUi` so an app can keep the shell — the plate, the
 * overflow behaviour, the pointer-event isolation — while choosing which
 * tools go in it and in what order. That is the whole of what the consumer's
 * custom toolbars need: they render their own list of
 * {@link MocanvasUiMenuItem}s inside a {@link DefaultToolbar}.
 */

/** Linear map from one range to another, clamped to the output range. */
function modulate(value: number, [inMin, inMax]: [number, number], [outMin, outMax]: [number, number]): number {
  if (inMax === inMin) return outMin
  const t = (value - inMin) / (inMax - inMin)
  const out = outMin + t * (outMax - outMin)
  return Math.max(Math.min(outMin, outMax), Math.min(Math.max(outMin, outMax), out))
}

export interface DefaultToolbarProps {
  /**
   * How many children stay inline at the narrowest width. The count is a
   * *last inline index*, not a length: children `0..itemsToShow` are inline
   * and the rest overflow, so `n` keeps `n + 1` of them.
   */
  minItems?: number
  /** How many children stay inline at the widest width, same counting. */
  maxItems?: number
  /** The width at which `minItems` applies, in CSS px. */
  minSizePx?: number
  /** The width at which `maxItems` applies, in CSS px. */
  maxSizePx?: number
  /** Accessible name for the toolbar. */
  label?: string
  children?: ReactNode
}

/*
 * SEMANTICS-ASSUMED — the overflow budget.
 * The rule is fixed by the consumer, which pins `minItems === maxItems` to
 * force an exact split independent of width: the inline count is
 * `floor(modulate(width, [minSizePx, maxSizePx], [minItems, maxItems]))`, and
 * child index `i` is inline while `i <= itemsToShow`. The four defaults below
 * are not: they are chosen so the ten default tools fit on a laptop and the
 * bar still holds five on a phone.
 */
const DEFAULT_BUDGET = { minItems: 4, maxItems: 12, minSizePx: 340, maxSizePx: 760 } as const

/**
 * The toolbar plate. Children past the width budget move into a "more"
 * popover, in order; a child that renders nothing still takes a slot, so a
 * caller mapping over a fixed id list gets a stable split.
 */
export function DefaultToolbar({
  minItems = DEFAULT_BUDGET.minItems,
  maxItems = DEFAULT_BUDGET.maxItems,
  minSizePx = DEFAULT_BUDGET.minSizePx,
  maxSizePx = DEFAULT_BUDGET.maxSizePx,
  label = "Tools",
  children,
}: DefaultToolbarProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const update = () => setWidth(el.getBoundingClientRect().width)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const items = Children.toArray(children)
  // Before the first measurement, assume the widest budget: a toolbar that
  // starts collapsed and expands one frame later reads as a glitch, while one
  // that starts full and settles narrower does not.
  const itemsToShow = Math.floor(modulate(width ?? maxSizePx, [minSizePx, maxSizePx], [minItems, maxItems]))
  const inline = items.slice(0, itemsToShow + 1)
  const overflow = items.slice(itemsToShow + 1)

  return (
    <div
      ref={barRef}
      className="mocanvas-panel mocanvas-toolbar"
      role="toolbar"
      aria-label={label}
      onPointerDown={stopEventPropagation}
    >
      {inline}
      {overflow.length > 0 ? (
        <span className="mocanvas-more">
          <button
            ref={moreRef}
            type="button"
            className="mocanvas-btn"
            aria-label="More tools"
            data-tooltip="More tools"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
          >
            <Icon name="chevron-down" />
          </button>
          <Popover anchorRef={moreRef} open={moreOpen} onClose={() => setMoreOpen(false)} label="More tools" prefer="above">
            <div className="mocanvas-toolbar-overflow" onClick={() => setMoreOpen(false)}>
              {overflow}
            </div>
          </Popover>
        </span>
      ) : null}
    </div>
  )
}

export interface MocanvasUiMenuItemProps extends TLUiToolItem {
  /** Whether the item is the active one; drives `aria-pressed`. */
  isSelected?: boolean
  /** Reported to `onSelect`. Defaults to `"toolbar"`. */
  source?: TLUiEventSource
}

/**
 * One UI item rendered as a button — the thing a toolbar is made of.
 *
 * Takes a {@link TLUiToolItem} spread flat, so `<MocanvasUiMenuItem {...tool}
 * isSelected={…} />` is the whole call. An icon name the set does not have
 * falls back to the label's initial, so an app's own tool still gets a
 * pressable, labelled button without shipping artwork into mocanvas.
 */
export function MocanvasUiMenuItem({ id, label, icon, kbd, disabled, isSelected, source = "toolbar", onSelect, meta }: MocanvasUiMenuItemProps) {
  void meta
  const known = Object.prototype.hasOwnProperty.call(ICONS, icon)
  return (
    <button
      type="button"
      className="mocanvas-btn"
      data-tool={id}
      aria-label={label}
      data-tooltip={label}
      {...(kbd ? { "data-shortcut": kbdLabel(kbd) } : {})}
      {...(isSelected === undefined ? {} : { "aria-pressed": isSelected })}
      {...(disabled ? { disabled: true } : {})}
      onClick={() => onSelect(source)}
    >
      {known ? <Icon name={icon as IconName} /> : <span className="mocanvas-btn-glyph">{label.slice(0, 1).toUpperCase()}</span>}
    </button>
  )
}

/** The first of a `kbd` list's alternatives, upper-cased for display. */
function kbdLabel(kbd: string): string {
  return (kbd.split(",")[0] ?? "").trim().toUpperCase()
}
