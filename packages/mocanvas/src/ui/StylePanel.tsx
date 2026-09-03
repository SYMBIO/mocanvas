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
import type { CSSProperties, ReactNode } from "react"
import { getGeoGeometry } from "../shapes/geo-helpers"
import { getFontFamily } from "../shapes/shape-theme"
import { pathWordsToSvgD } from "../shapes/svg-path"

/** Tools whose id doubles as the type of the shape they create. */
const CREATING_TOOLS = new Set(["geo", "draw", "note", "text", "arrow", "line"])

const PANEL_WIDTH = 220

const panel: CSSProperties = {
  position: "absolute",
  right: 12,
  top: 88,
  width: PANEL_WIDTH,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 8,
  background: "var(--mocanvas-panel, #fff)",
  border: "1px solid var(--mocanvas-panel-border, #e5e7eb)",
  borderRadius: 10,
  boxShadow: "0 4px 16px rgba(0,0,0,.08)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 11,
  color: "#374151",
  pointerEvents: "auto",
  zIndex: 10,
  userSelect: "none",
}

const rowLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "#6b7280",
  marginBottom: 4,
}

const mixedPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 9,
  fontWeight: 500,
  textTransform: "none",
  letterSpacing: 0,
  color: "#9ca3af",
}

const choiceRow: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4 }

const choiceBtn = (active: boolean, size = 28): CSSProperties => ({
  width: size,
  height: size,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  background: active ? "var(--mocanvas-selection, #3b82f6)" : "#f3f4f6",
  color: active ? "#fff" : "#111827",
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1,
})

/** The dashed ring shown beside a row whose selection has differing values. */
function MixedRing() {
  return (
    <span style={mixedPill} title="Selected shapes have different values">
      <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1.5px dashed #9ca3af", display: "inline-block" }} />
      mixed
    </span>
  )
}

function Row({ label, mixed, children }: { label: string; mixed: boolean; children: ReactNode }) {
  return (
    <div>
      <div style={rowLabel}>
        <span>{label}</span>
        {mixed ? <MixedRing /> : null}
      </div>
      <div style={choiceRow}>{children}</div>
    </div>
  )
}

interface ChoiceProps<T> {
  value: T
  current: SharedStyle<T> | undefined
  title: string
  onPick: (value: T) => void
  size?: number
  children: ReactNode
}

function Choice<T>({ value, current, title, onPick, size, children }: ChoiceProps<T>) {
  const active = current?.type === "shared" && current.value === value
  return (
    <button type="button" title={title} aria-pressed={active} style={choiceBtn(active, size)} onClick={() => onPick(value)}>
      {children}
    </button>
  )
}

// ---- icons -----------------------------------------------------------------

const ICON = 16

function Icon({ children, viewBox = `0 0 ${ICON} ${ICON}` }: { children: ReactNode; viewBox?: string }) {
  return (
    <svg width={ICON} height={ICON} viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

function FillIcon({ fill }: { fill: FillValue }) {
  switch (fill) {
    case "none":
      return (
        <Icon>
          <rect x={2.5} y={2.5} width={11} height={11} rx={1.5} />
        </Icon>
      )
    case "semi":
      return (
        <Icon>
          <rect x={2.5} y={2.5} width={11} height={11} rx={1.5} fill="currentColor" fillOpacity={0.25} />
        </Icon>
      )
    case "pattern":
      return (
        <Icon>
          <rect x={2.5} y={2.5} width={11} height={11} rx={1.5} />
          <path d="M3 9.5 L9.5 3 M3 13 L13 3 M6.5 13 L13 6.5 M10 13 L13 10" strokeWidth={1} />
        </Icon>
      )
    case "solid":
    case "fill":
      return (
        <Icon>
          <rect x={2.5} y={2.5} width={11} height={11} rx={1.5} fill="currentColor" />
        </Icon>
      )
  }
}

function DashIcon({ dash }: { dash: DashValue }) {
  switch (dash) {
    case "draw":
      return (
        <Icon>
          <path d="M2 9 C 5 6, 7 11, 10 8 S 13 7, 14 8" />
        </Icon>
      )
    case "solid":
      return (
        <Icon>
          <path d="M2 8 L14 8" />
        </Icon>
      )
    case "dashed":
      return (
        <Icon>
          <path d="M2 8 L14 8" strokeDasharray="3.5 2.5" />
        </Icon>
      )
    case "dotted":
      return (
        <Icon>
          <path d="M2.5 8 L13.5 8" strokeDasharray="0.1 3" strokeWidth={2} />
        </Icon>
      )
  }
}

function HAlignIcon({ align }: { align: HAlignValue }) {
  const x1 = align === "start" ? 2 : align === "end" ? 6 : 4
  return (
    <Icon>
      <path d="M2 4 L14 4 M2 12 L14 12" />
      <path d={`M${x1} 8 L${x1 + 8} 8`} />
    </Icon>
  )
}

function VAlignIcon({ align }: { align: VAlignValue }) {
  const y1 = align === "start" ? 2 : align === "end" ? 6 : 4
  return (
    <Icon>
      <path d="M4 2 L4 14 M12 2 L12 14" />
      <path d={`M8 ${y1} L8 ${y1 + 8}`} />
    </Icon>
  )
}

const GEO_ICON_PATHS: Record<GeoShapeKind, string> = Object.fromEntries(
  GEO_SHAPE_KINDS.map((kind) => [kind, pathWordsToSvgD(getGeoGeometry(kind, ICON - 3, ICON - 3, false).toPathWords())]),
) as Record<GeoShapeKind, string>

function GeoIcon({ kind }: { kind: GeoShapeKind }) {
  return (
    <Icon viewBox={`-1.5 -1.5 ${ICON} ${ICON}`}>
      <path d={GEO_ICON_PATHS[kind]} />
    </Icon>
  )
}

// ---- rows ------------------------------------------------------------------

const SWATCH_COLORS = DEFAULT_COLORS.filter((c) => c !== "white")
const FILLS: FillValue[] = ["none", "semi", "solid", "pattern"]
const DASHES: DashValue[] = ["draw", "solid", "dashed", "dotted"]
const SIZES: SizeValue[] = ["s", "m", "l", "xl"]
const FONTS: FontValue[] = ["draw", "sans", "serif", "mono"]
const H_ALIGNS: HAlignValue[] = ["start", "middle", "end"]
const V_ALIGNS: VAlignValue[] = ["start", "middle", "end"]

function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
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
            title={titleCase(c)}
            aria-pressed={active}
            onClick={() => onPick(c)}
            style={{
              width: 22,
              height: 22,
              padding: 0,
              borderRadius: "50%",
              border: "none",
              cursor: "pointer",
              background: "transparent",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: active ? "0 0 0 2px var(--mocanvas-selection, #3b82f6)" : "none",
            }}
          >
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: LIGHT_THEME[c].solid, display: "block", border: "1px solid rgba(0,0,0,.08)" }} />
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
    <Row label="Opacity" mixed={mixed}>
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={value}
        aria-label="Opacity"
        style={{ width: "100%", margin: 0, accentColor: "var(--mocanvas-selection, #3b82f6)" }}
        onPointerDown={() => editor.markHistoryStoppingPoint("opacity")}
        onChange={(e) => {
          const opacity = Number(e.currentTarget.value)
          editor.updateShapes(editor.getSelectedShapes().map((s) => ({ id: s.id, type: s.type, opacity })))
        }}
      />
    </Row>
  )
}

/**
 * Style controls for the selection (or, with nothing selected, for the next
 * shape the active drawing tool creates). Sits under the debug stats, top-right.
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
    <div style={panel} onPointerDown={(e) => e.stopPropagation()}>
      {has(GeoShapeGeoStyle) ? (
        <Row label="Shape" mixed={styles.get(GeoShapeGeoStyle)?.type === "mixed"}>
          {GEO_SHAPE_KINDS.map((kind) => (
            <Choice key={kind} value={kind} current={styles.get(GeoShapeGeoStyle)} title={titleCase(kind)} onPick={pickGeo} size={34}>
              <GeoIcon kind={kind} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultColorStyle) ? <ColorRow label="Color" current={styles.get(DefaultColorStyle)} onPick={(c) => setStyle(DefaultColorStyle, c)} /> : null}
      {has(DefaultLabelColorStyle) ? <ColorRow label="Label" current={styles.get(DefaultLabelColorStyle)} onPick={(c) => setStyle(DefaultLabelColorStyle, c)} /> : null}
      {has(DefaultFillStyle) ? (
        <Row label="Fill" mixed={styles.get(DefaultFillStyle)?.type === "mixed"}>
          {FILLS.map((f) => (
            <Choice key={f} value={f} current={styles.get(DefaultFillStyle)} title={titleCase(f)} onPick={(v) => setStyle(DefaultFillStyle, v)}>
              <FillIcon fill={f} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultDashStyle) ? (
        <Row label="Dash" mixed={styles.get(DefaultDashStyle)?.type === "mixed"}>
          {DASHES.map((d) => (
            <Choice key={d} value={d} current={styles.get(DefaultDashStyle)} title={titleCase(d)} onPick={(v) => setStyle(DefaultDashStyle, v)}>
              <DashIcon dash={d} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultSizeStyle) ? (
        <Row label="Size" mixed={styles.get(DefaultSizeStyle)?.type === "mixed"}>
          {SIZES.map((s) => (
            <Choice key={s} value={s} current={styles.get(DefaultSizeStyle)} title={s.toUpperCase()} onPick={(v) => setStyle(DefaultSizeStyle, v)}>
              {s.toUpperCase()}
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultFontStyle) ? (
        <Row label="Font" mixed={styles.get(DefaultFontStyle)?.type === "mixed"}>
          {FONTS.map((f) => (
            <Choice key={f} value={f} current={styles.get(DefaultFontStyle)} title={titleCase(f)} onPick={(v) => setStyle(DefaultFontStyle, v)}>
              <span style={{ fontFamily: getFontFamily(f), fontSize: 13, fontWeight: 500 }}>Aa</span>
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultHorizontalAlignStyle) ? (
        <Row label="Align" mixed={styles.get(DefaultHorizontalAlignStyle)?.type === "mixed"}>
          {H_ALIGNS.map((a) => (
            <Choice key={a} value={a} current={styles.get(DefaultHorizontalAlignStyle)} title={`Align ${a}`} onPick={(v) => setStyle(DefaultHorizontalAlignStyle, v)}>
              <HAlignIcon align={a} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {has(DefaultVerticalAlignStyle) ? (
        <Row label="Vertical align" mixed={styles.get(DefaultVerticalAlignStyle)?.type === "mixed"}>
          {V_ALIGNS.map((a) => (
            <Choice key={a} value={a} current={styles.get(DefaultVerticalAlignStyle)} title={`Vertical align ${a}`} onPick={(v) => setStyle(DefaultVerticalAlignStyle, v)}>
              <VAlignIcon align={a} />
            </Choice>
          ))}
        </Row>
      ) : null}
      {hasSelection ? <OpacityRow editor={editor} /> : null}
    </div>
  )
})
