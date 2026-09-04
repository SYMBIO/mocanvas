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
import type { ReactNode } from "react"
import { Icon, type IconName } from "./icons"

/** Tools whose id doubles as the type of the shape they create. */
const CREATING_TOOLS = new Set(["geo", "draw", "note", "text", "arrow", "line"])

const SWATCH_COLORS = DEFAULT_COLORS.filter((c) => c !== "white")
const FILLS: FillValue[] = ["none", "semi", "solid", "pattern"]
const DASHES: DashValue[] = ["draw", "solid", "dashed", "dotted"]
const SIZES: SizeValue[] = ["s", "m", "l", "xl"]
const FONTS: FontValue[] = ["draw", "sans", "serif", "mono"]
const H_ALIGNS: HAlignValue[] = ["start", "middle", "end"]
const V_ALIGNS: VAlignValue[] = ["start", "middle", "end"]

const FILL_ICON: Record<string, IconName> = { none: "fill-none", semi: "fill-semi", solid: "fill-solid", pattern: "fill-pattern" }
const H_ALIGN_ICON: Record<string, IconName> = { start: "align-left", middle: "align-center", end: "align-right" }
const V_ALIGN_ICON: Record<string, IconName> = { start: "valign-top", middle: "valign-middle", end: "valign-bottom" }
const H_ALIGN_LABEL: Record<string, string> = { start: "Align left", middle: "Align centre", end: "Align right" }
const V_ALIGN_LABEL: Record<string, string> = { start: "Align top", middle: "Align middle", end: "Align bottom" }

function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/** The dashed ring shown beside a row whose selection has differing values. */
function MixedRing() {
  return (
    <span className="mocanvas-mixed">
      <Icon name="mixed" size={11} />
      mixed
    </span>
  )
}

function Row({ label, mixed, dense, children }: { label: string; mixed: boolean; dense?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="mocanvas-row-label">
        <span>{label}</span>
        {mixed ? <MixedRing /> : null}
      </div>
      <div className={dense ? "mocanvas-seg mocanvas-seg--dense" : "mocanvas-seg"} role="radiogroup" aria-label={label}>
        {children}
      </div>
    </div>
  )
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
    <Row label={label} mixed={current?.type === "mixed"}>
      {SWATCH_COLORS.map((c) => {
        const active = current?.type === "shared" && current.value === c
        return (
          <button
            key={c}
            type="button"
            role="radio"
            className="mocanvas-swatch"
            aria-label={titleCase(c)}
            aria-checked={active}
            data-tooltip={titleCase(c)}
            onClick={() => onPick(c)}
          >
            <span style={{ ["--mocanvas-swatch-color" as string]: LIGHT_THEME[c].solid }} />
          </button>
        )
      })}
    </Row>
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

/**
 * Style controls for the selection (or, with nothing selected, for the next
 * shape the active drawing tool creates). Sits in the top-right corner.
 */
export const StylePanel = track(function StylePanel() {
  const editor = useEditor()
  const toolId = editor.getCurrentToolId()
  const hasSelection = editor.getSelectedShapeIds().length > 0
  const creating = CREATING_TOOLS.has(toolId)
  const styles = editor.getSharedStyles()

  // With a selection, show what the selected shapes declare; otherwise only the
  // styles of the shape type the active tool will create.
  const visible: Set<StyleProp<unknown>> = hasSelection && styles.size > 0 ? new Set(styles.keys()) : creating ? new Set(editor.getStylePropsForType(toolId).values()) : new Set()
  if (visible.size === 0) return null

  const has = (sp: StyleProp<unknown>) => visible.has(sp)
  const setStyle = <T,>(style: StyleProp<T>, value: T) => {
    editor.markHistoryStoppingPoint("style")
    editor.setStyleForSelectedShapes(style, value)
    editor.setStyleForNextShapes(style, value)
  }
  const pickGeo = (geo: GeoShapeKind) => {
    setStyle(GeoShapeGeoStyle, geo)
    // The geo tool reads its kind on enter; re-enter so the change takes effect immediately.
    if (toolId === "geo") editor.setCurrentTool("geo", { geo, force: true })
  }

  return (
    <div className="mocanvas-panel mocanvas-stylepanel" onPointerDown={(e) => e.stopPropagation()}>
      {has(GeoShapeGeoStyle) ? (
        <Row label="Shape" mixed={styles.get(GeoShapeGeoStyle)?.type === "mixed"} dense>
          {GEO_SHAPE_KINDS.map((kind) => (
            <Choice key={kind} value={kind} current={styles.get(GeoShapeGeoStyle)} label={titleCase(kind)} onPick={pickGeo}>
              <Icon name={`geo-${kind}`} size={18} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultColorStyle) ? <ColorRow label="Color" current={styles.get(DefaultColorStyle)} onPick={(c) => setStyle(DefaultColorStyle, c)} /> : null}
      {has(DefaultLabelColorStyle) ? <ColorRow label="Label" current={styles.get(DefaultLabelColorStyle)} onPick={(c) => setStyle(DefaultLabelColorStyle, c)} /> : null}
      {has(DefaultFillStyle) ? (
        <Row label="Fill" mixed={styles.get(DefaultFillStyle)?.type === "mixed"}>
          {FILLS.map((f) => (
            <Choice key={f} value={f} current={styles.get(DefaultFillStyle)} label={`${titleCase(f)} fill`} onPick={(v) => setStyle(DefaultFillStyle, v)}>
              <Icon name={FILL_ICON[f]!} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultDashStyle) ? (
        <Row label="Dash" mixed={styles.get(DefaultDashStyle)?.type === "mixed"}>
          {DASHES.map((d) => (
            <Choice key={d} value={d} current={styles.get(DefaultDashStyle)} label={`${titleCase(d)} line`} onPick={(v) => setStyle(DefaultDashStyle, v)}>
              <Icon name={`dash-${d}`} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultSizeStyle) ? (
        <Row label="Size" mixed={styles.get(DefaultSizeStyle)?.type === "mixed"}>
          {SIZES.map((s) => (
            <Choice key={s} value={s} current={styles.get(DefaultSizeStyle)} label={`Size ${s.toUpperCase()}`} onPick={(v) => setStyle(DefaultSizeStyle, v)}>
              <Icon name={`size-${s}`} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultFontStyle) ? (
        <Row label="Font" mixed={styles.get(DefaultFontStyle)?.type === "mixed"}>
          {FONTS.map((f) => (
            <Choice key={f} value={f} current={styles.get(DefaultFontStyle)} label={`${titleCase(f)} font`} onPick={(v) => setStyle(DefaultFontStyle, v)}>
              <Icon name={`font-${f}`} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultHorizontalAlignStyle) ? (
        <Row label="Align" mixed={styles.get(DefaultHorizontalAlignStyle)?.type === "mixed"}>
          {H_ALIGNS.map((a) => (
            <Choice key={a} value={a} current={styles.get(DefaultHorizontalAlignStyle)} label={H_ALIGN_LABEL[a]!} onPick={(v) => setStyle(DefaultHorizontalAlignStyle, v)}>
              <Icon name={H_ALIGN_ICON[a]!} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultVerticalAlignStyle) ? (
        <Row label="Vertical align" mixed={styles.get(DefaultVerticalAlignStyle)?.type === "mixed"}>
          {V_ALIGNS.map((a) => (
            <Choice key={a} value={a} current={styles.get(DefaultVerticalAlignStyle)} label={V_ALIGN_LABEL[a]!} onPick={(v) => setStyle(DefaultVerticalAlignStyle, v)}>
              <Icon name={V_ALIGN_ICON[a]!} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {hasSelection ? <OpacityRow editor={editor} /> : null}
    </div>
  )
})
