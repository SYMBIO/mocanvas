import {
  DEFAULT_COLORS,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultLabelColorStyle,
  DefaultSizeStyle,
  DefaultVerticalAlignStyle,
  GEO_SHAPE_KINDS,
  GeoShapeGeoStyle,
  LIGHT_THEME,
  track,
  useEditor,
  type DefaultColorStyle as ColorValue,
  type DefaultDashStyle as DashValue,
  type DefaultFillStyle as FillValue,
  type DefaultFontStyle as FontValue,
  type DefaultHorizontalAlignStyle as HAlignValue,
  type DefaultSizeStyle as SizeValue,
  type DefaultVerticalAlignStyle as VAlignValue,
  type Editor,
  type GeoShapeKind,
  type SharedStyle,
  type StyleProp,
} from "@mocanvas/editor"
import { useRef, useState, type ReactNode } from "react"
import { Icon, type IconName } from "./icons"
import { Popover } from "./overlays"

/** Tools whose id doubles as the type of the shape they create. */
const CREATING_TOOLS = new Set(["geo", "draw", "note", "text", "arrow", "line"])

const SWATCH_COLORS = DEFAULT_COLORS.filter((c) => c !== "white")
const FILLS: FillValue[] = ["none", "semi", "solid", "pattern", "fill"]
const DASHES: DashValue[] = ["draw", "solid", "dashed", "dotted"]
const SIZES: SizeValue[] = ["s", "m", "l", "xl"]
const FONTS: FontValue[] = ["draw", "sans", "serif", "mono"]
const H_ALIGNS: HAlignValue[] = ["start", "middle", "end"]
const V_ALIGNS: VAlignValue[] = ["start", "middle", "end"]

const FILL_ICON: Record<string, IconName> = { none: "fill-none", semi: "fill-paper", solid: "fill-tint", pattern: "fill-pattern", fill: "fill-full" }
const H_ALIGN_ICON: Record<string, IconName> = { start: "text-align-left", middle: "text-align-center", end: "text-align-right" }
const V_ALIGN_ICON: Record<string, IconName> = { start: "valign-top", middle: "valign-middle", end: "valign-bottom" }
const H_ALIGN_LABEL: Record<string, string> = { start: "Align left", middle: "Align centre", end: "Align right" }
const V_ALIGN_LABEL: Record<string, string> = { start: "Align top", middle: "Align middle", end: "Align bottom" }

function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// ---------------------------------------------------------------------------
// Which rows the panel shows
// ---------------------------------------------------------------------------

/**
 * The style rows the panel renders, in order, grouped as the panel groups them.
 *
 * With a selection this is exactly what the selected shapes declare, so a line
 * (colour, dash, size) never offers Font or Align; with nothing selected it is
 * what the active drawing tool is about to create. Exported so the rule can be
 * tested without a DOM.
 */
export interface StylePanelSections {
  /** The geo picker. */
  shape: boolean
  /** Colour swatch grids. */
  color: boolean
  labelColor: boolean
  /** Stroke and fill. */
  fill: boolean
  dash: boolean
  size: boolean
  /** Text. */
  font: boolean
  align: boolean
  verticalAlign: boolean
  /** Shape-level, not a style: only with a selection. */
  opacity: boolean
}

const NOTHING: StylePanelSections = {
  shape: false,
  color: false,
  labelColor: false,
  fill: false,
  dash: false,
  size: false,
  font: false,
  align: false,
  verticalAlign: false,
  opacity: false,
}

/** Decide which rows the style panel shows for the editor's current state. */
export function getStylePanelSections(editor: Editor): StylePanelSections {
  const hasSelection = editor.getSelectedShapeIds().length > 0
  const toolId = editor.getCurrentToolId()
  // With a selection the selection decides, full stop: falling back to the
  // active tool's styles would offer rows the selected shapes cannot carry.
  const visible: Set<StyleProp<unknown>> = hasSelection
    ? new Set(editor.getSharedStyles().keys())
    : CREATING_TOOLS.has(toolId)
      ? new Set(editor.getStylePropsForType(toolId).values())
      : new Set()
  if (visible.size === 0 && !hasSelection) return NOTHING
  return {
    shape: visible.has(GeoShapeGeoStyle),
    color: visible.has(DefaultColorStyle),
    labelColor: visible.has(DefaultLabelColorStyle),
    fill: visible.has(DefaultFillStyle),
    dash: visible.has(DefaultDashStyle),
    size: visible.has(DefaultSizeStyle),
    font: visible.has(DefaultFontStyle),
    align: visible.has(DefaultHorizontalAlignStyle),
    verticalAlign: visible.has(DefaultVerticalAlignStyle),
    opacity: hasSelection,
  }
}

/** Whether any row at all is on. */
export function hasAnyStyleSection(s: StylePanelSections): boolean {
  return Object.values(s).some(Boolean)
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** The dashed ring shown beside a row whose selection has differing values. */
function MixedRing() {
  return (
    <span className="mocanvas-mixed">
      <Icon name="mixed" size={11} />
      mixed
    </span>
  )
}

function Row({ label, mixed, children }: { label: string; mixed: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="mocanvas-row-label">
        <span>{label}</span>
        {mixed ? <MixedRing /> : null}
      </div>
      <div className="mocanvas-seg" role="radiogroup" aria-label={label}>
        {children}
      </div>
    </div>
  )
}

/** A titled band of related rows, separated from its neighbours by a hairline. */
function Group({ children }: { children: ReactNode }) {
  return <div className="mocanvas-group">{children}</div>
}

interface ChoiceProps<T> {
  value: T
  current: SharedStyle<T> | undefined
  label: string
  onPick: (value: T) => void
  children: ReactNode
}

function Choice<T>({ value, current, label, onPick, children }: ChoiceProps<T>) {
  const active = current?.type === "shared" && current.value === value
  return (
    <button type="button" role="radio" className="mocanvas-btn" aria-label={label} aria-checked={active} data-tooltip={label} onClick={() => onPick(value)}>
      {children}
    </button>
  )
}

function ColorRow({ label, current, onPick }: { label: string; current: SharedStyle<ColorValue> | undefined; onPick: (c: ColorValue) => void }) {
  return (
    <div>
      <div className="mocanvas-row-label">
        <span>{label}</span>
        {current?.type === "mixed" ? <MixedRing /> : null}
      </div>
      <div className="mocanvas-swatches" role="radiogroup" aria-label={label}>
        {SWATCH_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            className="mocanvas-swatch"
            aria-label={titleCase(c)}
            aria-checked={current?.type === "shared" && current.value === c}
            data-tooltip={titleCase(c)}
            onClick={() => onPick(c)}
          >
            <span style={{ ["--mocanvas-swatch-color" as string]: LIGHT_THEME[c].solid }} />
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The geo kind, as one button that opens a grid. Twenty always-visible cells
 * cost more vertical space than the rest of the panel put together, and the
 * kind rarely changes once a shape exists.
 */
function ShapePicker({ current, onPick }: { current: SharedStyle<GeoShapeKind> | undefined; onPick: (geo: GeoShapeKind) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const value = current?.type === "shared" ? current.value : null
  return (
    <div>
      <div className="mocanvas-row-label">
        <span>Shape</span>
        {current?.type === "mixed" ? <MixedRing /> : null}
      </div>
      <button
        ref={ref}
        type="button"
        className="mocanvas-picker"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={value ? `Shape: ${titleCase(value)}` : "Shape"}
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {value ? <Icon name={`geo-${value}`} /> : <Icon name="mixed" />}
          {value ? titleCase(value) : "Mixed"}
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} label="Shape" prefer="below">
        {GEO_SHAPE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="menuitemradio"
            className="mocanvas-btn"
            aria-label={titleCase(kind)}
            aria-checked={value === kind}
            data-tooltip={titleCase(kind)}
            onClick={() => {
              onPick(kind)
              setOpen(false)
            }}
          >
            <Icon name={`geo-${kind}`} />
          </button>
        ))}
      </Popover>
    </div>
  )
}

function OpacityRow({ editor }: { editor: Editor }) {
  const shapes = editor.getSelectedShapes()
  if (shapes.length === 0) return null
  const first = shapes[0]!.opacity
  const mixed = shapes.some((s) => s.opacity !== first)
  const value = mixed ? 1 : first
  return (
    <div>
      <div className="mocanvas-row-label">
        <span>Opacity</span>
        {mixed ? <MixedRing /> : <span>{Math.round(value * 100)}%</span>}
      </div>
      <input
        type="range"
        className="mocanvas-slider"
        min={0.1}
        max={1}
        step={0.05}
        value={value}
        aria-label="Opacity"
        onPointerDown={() => editor.markHistoryStoppingPoint("opacity")}
        onChange={(e) => {
          const opacity = Number(e.currentTarget.value)
          editor.updateShapes(editor.getSelectedShapes().map((s) => ({ id: s.id, type: s.type, opacity })))
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Style controls for the selection (or, with nothing selected, for the next
 * shape the active drawing tool creates). Sits in the top-right corner.
 *
 * Rows are grouped — shape, colour, stroke and fill, text, opacity — and every
 * group is omitted when the selection cannot carry it.
 */
export const StylePanel = track(function StylePanel() {
  const editor = useEditor()
  const sections = getStylePanelSections(editor)
  const styles = editor.getSharedStyles()
  if (!hasAnyStyleSection(sections)) return null

  const setStyle = <T,>(style: StyleProp<T>, value: T) => {
    editor.markHistoryStoppingPoint("style")
    editor.setStyleForSelectedShapes(style, value)
    editor.setStyleForNextShapes(style, value)
  }
  const pickGeo = (geo: GeoShapeKind) => {
    setStyle(GeoShapeGeoStyle, geo)
    // The geo tool reads its kind on enter; re-enter so the change takes effect immediately.
    if (editor.getCurrentToolId() === "geo") editor.setCurrentTool("geo", { geo, force: true })
  }

  const strokeGroup = sections.fill || sections.dash || sections.size
  const textGroup = sections.font || sections.align || sections.verticalAlign

  return (
    <div className="mocanvas-panel mocanvas-stylepanel" aria-label="Style" onPointerDown={(e) => e.stopPropagation()}>
      {sections.shape ? (
        <Group>
          <ShapePicker current={styles.get(GeoShapeGeoStyle)} onPick={pickGeo} />
        </Group>
      ) : null}

      {sections.color || sections.labelColor ? (
        <Group>
          {sections.color ? <ColorRow label="Color" current={styles.get(DefaultColorStyle)} onPick={(c) => setStyle(DefaultColorStyle, c)} /> : null}
          {sections.labelColor ? <ColorRow label="Label" current={styles.get(DefaultLabelColorStyle)} onPick={(c) => setStyle(DefaultLabelColorStyle, c)} /> : null}
        </Group>
      ) : null}

      {strokeGroup ? (
        <Group>
          {sections.fill ? (
            <Row label="Fill" mixed={styles.get(DefaultFillStyle)?.type === "mixed"}>
              {FILLS.map((f) => (
                <Choice key={f} value={f} current={styles.get(DefaultFillStyle)} label={`${titleCase(f)} fill`} onPick={(v) => setStyle(DefaultFillStyle, v)}>
                  <Icon name={FILL_ICON[f]!} />
                </Choice>
              ))}
            </Row>
          ) : null}
          {sections.dash ? (
            <Row label="Dash" mixed={styles.get(DefaultDashStyle)?.type === "mixed"}>
              {DASHES.map((d) => (
                <Choice key={d} value={d} current={styles.get(DefaultDashStyle)} label={`${titleCase(d)} line`} onPick={(v) => setStyle(DefaultDashStyle, v)}>
                  <Icon name={`dash-${d}`} />
                </Choice>
              ))}
            </Row>
          ) : null}
          {sections.size ? (
            <Row label="Size" mixed={styles.get(DefaultSizeStyle)?.type === "mixed"}>
              {SIZES.map((s) => (
                <Choice key={s} value={s} current={styles.get(DefaultSizeStyle)} label={`Size ${s.toUpperCase()}`} onPick={(v) => setStyle(DefaultSizeStyle, v)}>
                  <Icon name={`size-${s}`} />
                </Choice>
              ))}
            </Row>
          ) : null}
        </Group>
      ) : null}

      {textGroup ? (
        <Group>
          {sections.font ? (
            <Row label="Font" mixed={styles.get(DefaultFontStyle)?.type === "mixed"}>
              {FONTS.map((f) => (
                <Choice key={f} value={f} current={styles.get(DefaultFontStyle)} label={`${titleCase(f)} font`} onPick={(v) => setStyle(DefaultFontStyle, v)}>
                  <Icon name={`font-${f}`} />
                </Choice>
              ))}
            </Row>
          ) : null}
          {/* The two alignments are one idea and three buttons each, so they
              share a row rather than costing two labels' worth of height. */}
          {sections.align || sections.verticalAlign ? (
            <div>
              <div className="mocanvas-row-label">
                <span>Align</span>
                {styles.get(DefaultHorizontalAlignStyle)?.type === "mixed" || styles.get(DefaultVerticalAlignStyle)?.type === "mixed" ? <MixedRing /> : null}
              </div>
              <div className="mocanvas-seg mocanvas-seg--split">
                {sections.align ? (
                  <div className="mocanvas-seg" role="radiogroup" aria-label="Horizontal align">
                    {H_ALIGNS.map((a) => (
                      <Choice key={a} value={a} current={styles.get(DefaultHorizontalAlignStyle)} label={H_ALIGN_LABEL[a]!} onPick={(v) => setStyle(DefaultHorizontalAlignStyle, v)}>
                        <Icon name={H_ALIGN_ICON[a]!} />
                      </Choice>
                    ))}
                  </div>
                ) : null}
                {sections.verticalAlign ? (
                  <div className="mocanvas-seg" role="radiogroup" aria-label="Vertical align">
                    {V_ALIGNS.map((a) => (
                      <Choice key={a} value={a} current={styles.get(DefaultVerticalAlignStyle)} label={V_ALIGN_LABEL[a]!} onPick={(v) => setStyle(DefaultVerticalAlignStyle, v)}>
                        <Icon name={V_ALIGN_ICON[a]!} />
                      </Choice>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </Group>
      ) : null}

      {sections.opacity ? (
        <Group>
          <OpacityRow editor={editor} />
        </Group>
      ) : null}
    </div>
  )
})
