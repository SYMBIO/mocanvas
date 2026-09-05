import {
  ArrowShapeArrowheadEndStyle,
  ArrowShapeArrowheadStartStyle,
  ArrowShapeKindStyle,
  DEFAULT_COLORS,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultSizeStyle,
  DefaultTextAlignStyle,
  DefaultVerticalAlignStyle,
  GEO_SHAPE_KINDS,
  GeoShapeGeoStyle,
  LIGHT_THEME,
  LineShapeSplineStyle,
  track,
  useEditor,
  type EnumStyleProp,
  type SharedStyle,
  type StyleProp,
} from "@mocanvas/editor"
import { createContext, useContext, useMemo, type ReactNode } from "react"
import { Icon, type IconName } from "./icons"
import { useRelevantStyles } from "./ui-actions"
import { TldrawUiPopover, TldrawUiPopoverContent, TldrawUiPopoverTrigger } from "./ui-popover"
import { TldrawUiSlider } from "./ui-slider"
import { TldrawUiToolbarToggleGroup, TldrawUiToolbarToggleItem } from "./ui-toolbar"
import { useUiEvents } from "./ui-events"

/**
 * The style panel's pickers, one per style prop.
 *
 * Three shapes cover all of them, so the concrete pickers below are almost all
 * one line: a row of buttons ({@link StylePanelButtonPicker}), a dropdown
 * ({@link StylePanelDropdownPicker}), or two dropdowns side by side
 * ({@link StylePanelDoubleDropdownPicker}, which exists for the arrowheads —
 * a pair that is one decision).
 *
 * Each has an `Inline` variant that omits the label row. The label is what
 * makes the panel readable and what makes the picker announce itself, so the
 * inline form is for the case where a caller has already supplied one — a
 * section heading, or a contextual toolbar with no room for two lines.
 */

// ---------------------------------------------------------------------------
// Panel context
// ---------------------------------------------------------------------------

/**
 * What every picker needs: the styles in play, and how to change one.
 *
 * Published as context rather than passed down, so a caller can compose the
 * panel out of individual pickers — or drop one into a contextual toolbar —
 * without re-plumbing the same three things into each.
 */
export interface StylePanelContext {
  styles: ReturnType<typeof useRelevantStyles>
  /** Apply a style to the selection, or to the next shape when nothing is selected. */
  setStyle<T>(style: StyleProp<T>, value: T): void
  /** Whether the panel is in its compact, popover-hosted form. */
  isMobile: boolean
  /** Whether the editor refuses edits. */
  disabled: boolean
}

const StylePanelCtx = createContext<StylePanelContext | null>(null)

export interface StylePanelContextProviderProps {
  isMobile?: boolean
  children?: ReactNode
}

/** Publishes the style panel's context. Render inside an editor provider. */
export const StylePanelContextProvider = track(function StylePanelContextProvider({ isMobile = false, children }: StylePanelContextProviderProps) {
  const editor = useEditor()
  const styles = useRelevantStyles()
  const disabled = editor.getIsReadonly()
  const value = useMemo<StylePanelContext>(
    () => ({
      styles,
      isMobile,
      disabled,
      setStyle<T>(style: StyleProp<T>, next: T) {
        editor.markHistoryStoppingPoint("style change")
        if (editor.getSelectedShapeIds().length > 0) editor.setStyleForSelectedShapes(style, next)
        editor.setStyleForNextShapes(style, next)
      },
    }),
    [editor, styles, isMobile, disabled],
  )
  return <StylePanelCtx.Provider value={value}>{children}</StylePanelCtx.Provider>
})

/** The style panel's context. Throws outside its provider. */
export function useStylePanelContext(): StylePanelContext {
  const value = useContext(StylePanelCtx)
  if (!value) throw new Error("useStylePanelContext: render inside <StylePanelContextProvider>.")
  return value
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** One choice in a picker: the value, and how to draw it. */
export interface StyleValuesForUi<T extends string> {
  value: T
  label: string
  icon?: IconName
  /** A colour swatch, for the colour picker. */
  swatch?: string
}

function titleCase(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/** The colour choices, with their light-theme swatches. */
export function getColorStyleItems(): StyleValuesForUi<string>[] {
  return DEFAULT_COLORS.filter((color) => color !== "white").map((color) => ({
    value: color,
    label: titleCase(color),
    swatch: LIGHT_THEME[color]?.solid,
  }))
}

/** The font choices. */
export function getFontStyleItems(): StyleValuesForUi<string>[] {
  const fonts = ["draw", "sans", "serif", "mono"] as const
  return fonts.map((font) => ({ value: font, label: titleCase(font), icon: `font-${font}` as IconName }))
}

/** Choices built from an enum style prop, labelled by title-casing its values. */
export function getStyleItemsForProp<T extends string>(style: EnumStyleProp<T>, icon?: (value: T) => IconName | undefined): StyleValuesForUi<T>[] {
  return style.values.map((value) => {
    const name = icon?.(value)
    return name ? { value, label: titleCase(value), icon: name } : { value, label: titleCase(value) }
  })
}

/** The shared value of a style, or `undefined` when the style is not in play. */
function useSharedValue<T>(style: StyleProp<T>): SharedStyle<T> | undefined {
  const { styles } = useStylePanelContext()
  return styles?.get(style) as SharedStyle<T> | undefined
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface StylePanelSectionProps {
  label?: string
  className?: string
  children?: ReactNode
}

/** A band of related rows, ruled off from its neighbours. */
export function StylePanelSection({ label, className, children }: StylePanelSectionProps) {
  return (
    <div className={["mocanvas-group", className].filter(Boolean).join(" ")} {...(label ? { role: "group", "aria-label": label } : {})}>
      {children}
    </div>
  )
}

export interface StylePanelSubheadingProps {
  /** Shown when the selection's values for this style disagree. */
  mixed?: boolean
  /** Rendered at the end of the row, e.g. an opacity percentage. */
  aside?: ReactNode
  children?: ReactNode
}

/** A row's label, with the "mixed" marker when the selection disagrees. */
export function StylePanelSubheading({ mixed, aside, children }: StylePanelSubheadingProps) {
  return (
    <div className="mocanvas-row-label">
      <span>{children}</span>
      {mixed ? (
        <span className="mocanvas-mixed">
          <Icon name="mixed" size={11} />
          mixed
        </span>
      ) : (
        aside
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The three picker shapes
// ---------------------------------------------------------------------------

export interface StylePanelButtonPickerProps<T extends string> {
  /** The style being edited. */
  style: StyleProp<T>
  label: string
  items: readonly StyleValuesForUi<T>[]
  /** Show colour swatches rather than icons. */
  swatches?: boolean
  className?: string
}

/**
 * A row of buttons, one per value: the shape for a style with four or five
 * choices that each have a glyph — fill, dash, size, alignment.
 */
export function StylePanelButtonPickerInline<T extends string>({ style, label, items, swatches, className }: StylePanelButtonPickerProps<T>) {
  const { setStyle, disabled } = useStylePanelContext()
  const shared = useSharedValue(style)
  const trackEvent = useUiEvents()
  const current = shared?.type === "shared" ? (shared.value as string) : undefined
  return (
    <TldrawUiToolbarToggleGroup
      label={label}
      type="single"
      {...(current === undefined ? {} : { value: current })}
      className={[swatches ? "mocanvas-swatches" : "mocanvas-seg", className].filter(Boolean).join(" ")}
      onValueChange={(value) => {
        setStyle(style, value as T)
        trackEvent("set-style", { source: "menu", id: label, value })
      }}
    >
      {items.map((item) => (
        <TldrawUiToolbarToggleItem
          key={item.value}
          value={item.value}
          title={item.label}
          disabled={disabled}
          {...(swatches ? { className: "mocanvas-swatch" } : {})}
        >
          {swatches ? <span style={{ ["--mocanvas-swatch-color" as string]: item.swatch }} /> : item.icon ? <Icon name={item.icon} /> : item.label}
        </TldrawUiToolbarToggleItem>
      ))}
    </TldrawUiToolbarToggleGroup>
  )
}

/** {@link StylePanelButtonPickerInline} with its label row. */
export function StylePanelButtonPicker<T extends string>(props: StylePanelButtonPickerProps<T>) {
  const shared = useSharedValue(props.style)
  return (
    <div className="mocanvas-style-row">
      <StylePanelSubheading mixed={shared?.type === "mixed"}>{props.label}</StylePanelSubheading>
      <StylePanelButtonPickerInline {...props} />
    </div>
  )
}

export interface StylePanelDropdownPickerProps<T extends string> {
  style: StyleProp<T>
  label: string
  items: readonly StyleValuesForUi<T>[]
  /** Columns in the popover grid. */
  columns?: number
  id?: string
}

/**
 * A button that opens a grid of choices: the shape for a style with too many
 * values to sit in a row — the twenty geo kinds, most obviously.
 */
export function StylePanelDropdownPickerInline<T extends string>({ style, label, items, columns = 5, id }: StylePanelDropdownPickerProps<T>) {
  const { setStyle, disabled } = useStylePanelContext()
  const shared = useSharedValue(style)
  const current = shared?.type === "shared" ? (shared.value as T) : null
  const currentItem = items.find((item) => item.value === current)
  return (
    <TldrawUiPopover {...(id ? { id } : {})} side="below">
      <TldrawUiPopoverTrigger className="mocanvas-picker">
        <span>
          {currentItem?.icon ? <Icon name={currentItem.icon} /> : <Icon name="mixed" />}
          {currentItem?.label ?? "Mixed"}
        </span>
        <Icon name="chevron-down" size={16} />
      </TldrawUiPopoverTrigger>
      <TldrawUiPopoverContent label={label}>
        <div className="mocanvas-popover-grid" role="radiogroup" aria-label={label} style={{ ["--mocanvas-popover-cols" as string]: columns }}>
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              className="mocanvas-btn"
              aria-checked={current === item.value}
              aria-label={item.label}
              data-tooltip={item.label}
              disabled={disabled}
              onClick={() => setStyle(style, item.value)}
            >
              {item.icon ? <Icon name={item.icon} /> : item.label}
            </button>
          ))}
        </div>
      </TldrawUiPopoverContent>
    </TldrawUiPopover>
  )
}

/** {@link StylePanelDropdownPickerInline} with its label row. */
export function StylePanelDropdownPicker<T extends string>(props: StylePanelDropdownPickerProps<T>) {
  const shared = useSharedValue(props.style)
  return (
    <div className="mocanvas-style-row">
      <StylePanelSubheading mixed={shared?.type === "mixed"}>{props.label}</StylePanelSubheading>
      <StylePanelDropdownPickerInline {...props} />
    </div>
  )
}

export interface StylePanelDoubleDropdownPickerProps<T extends string> {
  label: string
  labelA: string
  labelB: string
  styleA: StyleProp<T>
  styleB: StyleProp<T>
  items: readonly StyleValuesForUi<T>[]
}

/**
 * Two dropdowns under one label: the arrowheads, which are two styles but one
 * decision, and which read as unrelated when split into two rows.
 */
export function StylePanelDoubleDropdownPickerInline<T extends string>({ labelA, labelB, styleA, styleB, items }: StylePanelDoubleDropdownPickerProps<T>) {
  return (
    <div className="mocanvas-seg mocanvas-seg--split">
      <StylePanelDropdownPickerInline style={styleA} label={labelA} items={items} />
      <StylePanelDropdownPickerInline style={styleB} label={labelB} items={items} />
    </div>
  )
}

/** {@link StylePanelDoubleDropdownPickerInline} with its label row. */
export function StylePanelDoubleDropdownPicker<T extends string>(props: StylePanelDoubleDropdownPickerProps<T>) {
  return (
    <div className="mocanvas-style-row">
      <StylePanelSubheading>{props.label}</StylePanelSubheading>
      <StylePanelDoubleDropdownPickerInline {...props} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The concrete pickers
// ---------------------------------------------------------------------------

/** Shape colour. Renders nothing when the selection carries no colour. */
export function StylePanelColorPicker() {
  const { styles } = useStylePanelContext()
  if (!styles?.get(DefaultColorStyle)) return null
  return <StylePanelButtonPicker style={DefaultColorStyle} label="Colour" items={getColorStyleItems()} swatches />
}

const FILL_ICONS: Record<string, IconName> = { none: "fill-none", semi: "fill-semi", solid: "fill-solid", pattern: "fill-pattern" }
const DASH_ICONS: Record<string, IconName> = { draw: "dash-draw", solid: "dash-solid", dashed: "dash-dashed", dotted: "dash-dotted" }
const SIZE_ICONS: Record<string, IconName> = { s: "size-s", m: "size-m", l: "size-l", xl: "size-xl" }
const H_ALIGN_ICONS: Record<string, IconName> = { start: "align-left", middle: "align-center", end: "align-right" }
const V_ALIGN_ICONS: Record<string, IconName> = { start: "valign-top", middle: "valign-middle", end: "valign-bottom" }

/** Fill style. */
export function StylePanelFillPicker() {
  const { styles } = useStylePanelContext()
  if (!styles?.get(DefaultFillStyle)) return null
  return <StylePanelButtonPicker style={DefaultFillStyle} label="Fill" items={getStyleItemsForProp(DefaultFillStyle, (v) => FILL_ICONS[v])} />
}

/** Dash style. */
export function StylePanelDashPicker() {
  const { styles } = useStylePanelContext()
  if (!styles?.get(DefaultDashStyle)) return null
  return <StylePanelButtonPicker style={DefaultDashStyle} label="Dash" items={getStyleItemsForProp(DefaultDashStyle, (v) => DASH_ICONS[v])} />
}

/** Stroke size. */
export function StylePanelSizePicker() {
  const { styles } = useStylePanelContext()
  if (!styles?.get(DefaultSizeStyle)) return null
  return <StylePanelButtonPicker style={DefaultSizeStyle} label="Size" items={getStyleItemsForProp(DefaultSizeStyle, (v) => SIZE_ICONS[v])} />
}

/** Font family. */
export function StylePanelFontPicker() {
  const { styles } = useStylePanelContext()
  if (!styles?.get(DefaultFontStyle)) return null
  return <StylePanelButtonPicker style={DefaultFontStyle} label="Font" items={getFontStyleItems() as StyleValuesForUi<string>[]} />
}

/** Where the label sits inside its shape. */
export function StylePanelLabelAlignPicker() {
  const { styles } = useStylePanelContext()
  if (!styles?.get(DefaultHorizontalAlignStyle)) return null
  return (
    <>
      <StylePanelButtonPicker style={DefaultHorizontalAlignStyle} label="Align" items={getStyleItemsForProp(DefaultHorizontalAlignStyle, (v) => H_ALIGN_ICONS[v])} />
      {styles?.get(DefaultVerticalAlignStyle) ? (
        <StylePanelButtonPicker style={DefaultVerticalAlignStyle} label="Vertical align" items={getStyleItemsForProp(DefaultVerticalAlignStyle, (v) => V_ALIGN_ICONS[v])} />
      ) : null}
    </>
  )
}

/** How the text is aligned within the label box. */
export function StylePanelTextAlignPicker() {
  const { styles } = useStylePanelContext()
  if (!styles?.get(DefaultTextAlignStyle)) return null
  return <StylePanelButtonPicker style={DefaultTextAlignStyle} label="Text align" items={getStyleItemsForProp(DefaultTextAlignStyle, (v) => H_ALIGN_ICONS[v])} />
}

/** The geo kind. */
export function StylePanelGeoShapePicker() {
  const { styles } = useStylePanelContext()
  if (!styles?.get(GeoShapeGeoStyle)) return null
  const items = GEO_SHAPE_KINDS.map((kind) => ({ value: kind, label: titleCase(kind), icon: `geo-${kind}` as IconName }))
  return <StylePanelDropdownPicker style={GeoShapeGeoStyle} label="Shape" items={items} id="geo-picker" />
}

/** How a line interpolates between its points. */
export function StylePanelSplinePicker() {
  const { styles } = useStylePanelContext()
  if (!styles?.get(LineShapeSplineStyle)) return null
  return <StylePanelDropdownPicker style={LineShapeSplineStyle} label="Spline" items={getStyleItemsForProp(LineShapeSplineStyle)} id="spline-picker" />
}

/** How an arrow's body is routed. */
export function StylePanelArrowKindPicker() {
  const { styles } = useStylePanelContext()
  if (!styles?.get(ArrowShapeKindStyle)) return null
  return <StylePanelDropdownPicker style={ArrowShapeKindStyle} label="Arrow kind" items={getStyleItemsForProp(ArrowShapeKindStyle)} id="arrow-kind-picker" />
}

/** The two arrowheads. */
export function StylePanelArrowheadPicker() {
  const { styles } = useStylePanelContext()
  if (!styles?.get(ArrowShapeArrowheadStartStyle)) return null
  return (
    <StylePanelDoubleDropdownPicker
      label="Arrowheads"
      labelA="Start"
      labelB="End"
      styleA={ArrowShapeArrowheadStartStyle}
      styleB={ArrowShapeArrowheadEndStyle}
      items={getStyleItemsForProp(ArrowShapeArrowheadStartStyle)}
    />
  )
}

/** How many steps the opacity slider has. */
const OPACITY_STEPS = 4
const OPACITY_VALUES = [0.1, 0.25, 0.5, 0.75, 1] as const

/**
 * Shape opacity.
 *
 * Not a style prop — opacity lives on the shape record — so this reads and
 * writes the selection directly. Stepped rather than continuous, so a value
 * chosen on one shape can be matched exactly on another.
 */
export const StylePanelOpacityPicker = track(function StylePanelOpacityPicker() {
  const editor = useEditor()
  const shapes = editor.getSelectedShapes()
  if (shapes.length === 0) return null
  const first = shapes[0]!.opacity
  const mixed = shapes.some((shape) => shape.opacity !== first)
  const index = OPACITY_VALUES.findIndex((value) => Math.abs(value - first) < 0.001)
  return (
    <div className="mocanvas-style-row">
      <StylePanelSubheading mixed={mixed} aside={<span>{Math.round(first * 100)}%</span>}>
        Opacity
      </StylePanelSubheading>
      <TldrawUiSlider
        value={mixed ? null : index < 0 ? OPACITY_STEPS : index}
        steps={OPACITY_STEPS}
        label="Opacity"
        onHistoryMark={(id) => editor.markHistoryStoppingPoint(id)}
        onValueChange={(value) => editor.setOpacityForSelectedShapes(OPACITY_VALUES[value] ?? 1)}
      />
    </div>
  )
})
