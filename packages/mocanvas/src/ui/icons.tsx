/**
 * The default UI icon set.
 *
 * Artwork comes from three places, and which one an icon uses is decided by
 * what the icon has to say:
 *
 * - **Phosphor** (MIT, `regular` weight) supplies the generic chrome — tools,
 *   history, alignment, text formatting, status. It is a large, coherent,
 *   professionally drawn family, and drawing 100 of those ourselves would have
 *   produced a worse set more slowly. The path data is inlined by
 *   `scripts/generate-phosphor-icons.mjs` into `icons-phosphor.ts`; we take no
 *   runtime dependency on it.
 * - **Our own drawings** cover everything that describes what *this* canvas
 *   does and so has no equivalent in a general-purpose family: the fill and
 *   dash styles, the size steps, the font families, the arrowheads, and the
 *   text-alignment marks.
 * - **The canvas geometry itself** supplies the geo icons, generated from the
 *   same code that draws the shapes, so a toolbar button matches the shape it
 *   creates.
 *
 * The two hand-drawn sources share one grid, enforced by `icons.test.tsx`
 * where it is checkable statically and by the gallery pass otherwise:
 *
 * - the artwork lives on a 24×24 viewBox; ink (stroke included) stays inside it
 * - ink is optically centred on (12, 12) and spans about 17.75 units at its
 *   widest, so no icon reads heavier than its neighbour in the same row
 * - stroke is 1.75 with round caps and joins; only texture marks (hatching,
 *   dotted rules, the mono rails) deviate, and they say so at the call site
 * - deliberate asymmetry is allowed only when it carries meaning, e.g. the
 *   vertical-align icons sit high or low on purpose
 *
 * Phosphor draws filled outlines on a 256 grid instead, so those are scaled
 * into the same 24×24 box and painted with `fill` rather than `stroke`. The
 * seam is invisible at button sizes because Phosphor's `regular` weight is a
 * 16/256 stroke — 1.5 on our grid, against our 1.75.
 */
import { GEO_SHAPE_KINDS, type GeoShapeKind } from "@mocanvas/editor"
import type { ReactElement } from "react"
import { getGeoGeometry } from "../shapes/geo-helpers"
import { pathWordsToSvgD } from "../shapes/svg-path"
import { PHOSPHOR_GRID, PHOSPHOR_PATHS } from "./icons-phosphor"

/** Side of the drawing grid. */
export const ICON_GRID = 24
/** Longest side of the box a geo outline is fitted into, centred in the grid. */
export const GEO_BOX = 16

const solid = { fill: "currentColor", stroke: "none" } as const

// ---------------------------------------------------------------------------
// Phosphor
// ---------------------------------------------------------------------------

/**
 * Phosphor artwork, scaled from its 256 grid onto ours and painted as fill.
 *
 * The `stroke="none"` matters: the enclosing `<svg>` sets a stroke for the
 * hand-drawn icons, and without the override Phosphor's filled outlines would
 * be drawn with a 1.75 stroke on top of themselves and read as blobs.
 */
const PHOSPHOR_ICONS = Object.fromEntries(
  Object.entries(PHOSPHOR_PATHS).map(([name, ds]) => [
    name,
    <g fill="currentColor" stroke="none" transform={`scale(${ICON_GRID / PHOSPHOR_GRID})`}>
      {ds.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>,
  ]),
) as Record<keyof typeof PHOSPHOR_PATHS, ReactElement>

// ---------------------------------------------------------------------------
// Style properties — ours, because they describe this canvas's own styles
// ---------------------------------------------------------------------------

const FILL_BOX = { x: 4.25, y: 4.25, width: 15.5, height: 15.5, rx: 3 } as const

/*
 * The fill icons are named for what they draw, not for the style that picks
 * them, because those two do not line up: the style called `semi` paints the
 * paper, `solid` paints the hue's pale tint, and only `fill` paints the hue.
 * `DEFAULT_FILL_TOKENS` says so in as many words and warns that reading the
 * token whose name matches the style is the easy mistake — which is exactly
 * what the picker did. Every swatch was one step too strong, and the fifth
 * style had no icon at all.
 */
const STYLE_ICONS = {
  "fill-none": <rect {...FILL_BOX} />,
  // Paper, not a tint: `semi` fills a shape with the canvas's own surface, so
  // the swatch is the plate's surface inside the outline.
  "fill-paper": <rect {...FILL_BOX} fill="var(--mocanvas-ui-panel)" />,
  "fill-tint": <rect {...FILL_BOX} fill="currentColor" fillOpacity={0.22} />,
  "fill-full": <rect {...FILL_BOX} fill="currentColor" />,
  // Hatching is texture, not outline: a lighter stroke keeps the block's weight
  // level with the other three fill icons.
  "fill-pattern": (
    <>
      <rect {...FILL_BOX} />
      <path d="M6.2 12.6l6.4-6.4M6.2 17.1l10.9-10.9M9.4 18.3l8.9-8.9M14.6 18.4l3.7-3.7" strokeWidth={1.25} />
    </>
  ),
  "dash-draw": <path d="M4 14.9c1.6-3.4 3.2-4.9 4.9-4.4 1.7.4 2.4 4 4.2 4.4 1.9.4 3.9-1.9 6.9-5.9" />,
  "dash-solid": <path d="M4.25 12h15.5" />,
  "dash-dashed": <path d="M4.5 12h15" strokeDasharray="3.1 2.8" />,
  // Round caps on a zero-length dash draw the dots; the wider stroke is the dot.
  "dash-dotted": <path d="M5 12h14" strokeDasharray="0.01 4.35" strokeWidth={2.6} />,
  "size-s": <circle cx="12" cy="12" r="2" {...solid} />,
  "size-m": <circle cx="12" cy="12" r="3.4" {...solid} />,
  "size-l": <circle cx="12" cy="12" r="4.9" {...solid} />,
  "size-xl": <circle cx="12" cy="12" r="6.6" {...solid} />,
  // Text alignment, as three ragged lines. Distinct from `align-left` and its
  // neighbours, which align *objects* to each other and come from Phosphor.
  "text-align-left": <path d="M4.5 6.5h15M4.5 12h7.5M4.5 17.5h11.5" />,
  "text-align-center": <path d="M4.5 6.5h15M8.25 12h7.5M6.25 17.5h11.5" />,
  "text-align-right": <path d="M4.5 6.5h15M12 12h7.5M8 17.5h11.5" />,
  // A label's vertical seat inside its shape: the rule is where the text lands,
  // the box is the shape. Deliberately off-centre — that is the whole message.
  "valign-top": (
    <>
      <path d="M4.5 4.5h15" />
      <rect x="7.5" y="7.75" width="9" height="6.25" rx="1.5" />
    </>
  ),
  "valign-middle": (
    <>
      <path d="M4.5 12h15" />
      <rect x="7.5" y="8.9" width="9" height="6.25" rx="1.5" />
    </>
  ),
  "valign-bottom": (
    <>
      <path d="M4.5 19.5h15" />
      <rect x="7.5" y="10" width="9" height="6.25" rx="1.5" />
    </>
  ),
  // A single-storey script "a": the other three fonts share the capital-A
  // silhouette, so the handwriting option needs a different letter to stay
  // legible at 20px.
  "font-draw": (
    <>
      <circle cx="10.6" cy="12.6" r="4.4" />
      <path d="M15 6.3v8.9c0 1.5 1 2.5 2.5 2.5" />
    </>
  ),
  "font-sans": (
    <>
      <path d="M5.5 19L12 5l6.5 14" />
      <path d="M8 14.5h8" />
    </>
  ),
  "font-serif": (
    <>
      <path d="M6.75 19L12 5l5.25 14" />
      <path d="M8.7 14.5h6.6" />
      <path d="M4.9 19h3.6M15.5 19h3.6" />
    </>
  ),
  "font-mono": (
    <>
      <path d="M8 19l4-13 4 13" />
      <path d="M9.6 14.9h4.8" />
      {/* The rails are a frame, not a letter stroke: keep them lighter. */}
      <path d="M4.75 5.75v12.5M19.25 5.75v12.5" strokeWidth={1.4} />
    </>
  ),
  // An indeterminate value across a mixed selection. Ours rather than
  // Phosphor's `Minus`, which `minus` already uses and which reads as an
  // action rather than as "these differ".
  mixed: <circle cx="12" cy="12" r="7.25" strokeDasharray="2.6 2.8" />,
} as const

// ---------------------------------------------------------------------------
// Arrowheads — ours, because they name terminals the canvas actually draws
// ---------------------------------------------------------------------------

/**
 * The shaft every arrowhead icon sits on, so the eight read as one family and
 * the terminal is the only thing that changes between them.
 */
const SHAFT = (to: number) => <path d={`M4 12h${to - 4}`} />

const ARROWHEAD_ICONS = {
  "arrowhead-none": SHAFT(19.5),
  "arrowhead-arrow": (
    <>
      {SHAFT(18.5)}
      <path d="M13.9 7.4L18.5 12l-4.6 4.6" />
    </>
  ),
  "arrowhead-triangle": (
    <>
      {SHAFT(13.5)}
      <path d="M13.5 6.6L20 12l-6.5 5.4z" {...solid} />
    </>
  ),
  "arrowhead-triangle-inverted": (
    <>
      {SHAFT(20)}
      <path d="M20 6.6L13.5 12 20 17.4z" {...solid} />
    </>
  ),
  "arrowhead-square": (
    <>
      {SHAFT(13.6)}
      <rect x="13.6" y="7.8" width="8.4" height="8.4" rx="1.1" {...solid} />
    </>
  ),
  "arrowhead-diamond": (
    <>
      {SHAFT(12.4)}
      <path d="M16.4 6.6L21.2 12l-4.8 5.4L11.6 12z" {...solid} />
    </>
  ),
  "arrowhead-dot": (
    <>
      {SHAFT(13.3)}
      <circle cx="17" cy="12" r="3.7" {...solid} />
    </>
  ),
  "arrowhead-bar": (
    <>
      {SHAFT(17.5)}
      <path d="M17.5 6.2v11.6" />
    </>
  ),
} as const

// ---------------------------------------------------------------------------
// Geo kinds, derived from the canvas geometry
// ---------------------------------------------------------------------------

/**
 * Box each geo outline is fitted into. Square by default; kinds whose name
 * implies a proportion get one, so that e.g. "oval" does not draw the same
 * circle as "ellipse". The longest side is always `GEO_BOX`, which keeps every
 * geo icon at the same optical weight as the rest of the set.
 */
const GEO_ICON_BOX: Partial<Record<GeoShapeKind, readonly [number, number]>> = {
  rectangle: [GEO_BOX, 12],
  oval: [GEO_BOX, 10.5],
  "arrow-left": [GEO_BOX, 13],
  "arrow-right": [GEO_BOX, 13],
  "arrow-up": [13, GEO_BOX],
  "arrow-down": [13, GEO_BOX],
}

/** The box a geo icon's outline is fitted into, in grid units. */
export function getGeoIconBox(kind: GeoShapeKind): readonly [number, number] {
  return GEO_ICON_BOX[kind] ?? [GEO_BOX, GEO_BOX]
}

/** `d` attribute for each geo kind, fitted to its icon box. */
export const GEO_ICON_PATHS: Record<GeoShapeKind, string> = Object.fromEntries(
  GEO_SHAPE_KINDS.map((kind) => {
    const [w, h] = getGeoIconBox(kind)
    return [kind, pathWordsToSvgD(getGeoGeometry(kind, w, h, false).toPathWords())]
  }),
) as Record<GeoShapeKind, string>

type GeoIconName = `geo-${GeoShapeKind}`

const GEO_ICONS = Object.fromEntries(
  GEO_SHAPE_KINDS.map((kind) => {
    const [w, h] = getGeoIconBox(kind)
    return [
      `geo-${kind}`,
      <g transform={`translate(${(ICON_GRID - w) / 2} ${(ICON_GRID - h) / 2})`}>
        <path d={GEO_ICON_PATHS[kind]} />
      </g>,
    ]
  }),
) as Record<GeoIconName, ReactElement>

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

/** Every icon that has artwork of its own, keyed by name. */
export const ICONS = { ...PHOSPHOR_ICONS, ...STYLE_ICONS, ...ARROWHEAD_ICONS, ...GEO_ICONS }

/** A name with its own artwork. */
export type DrawnIconName = keyof typeof ICONS

/**
 * Second spellings for icons that already exist.
 *
 * Mostly tldraw's names, so an app ported from it asks for artwork it gets
 * rather than falling back to an initial. An alias never introduces a drawing:
 * if two names should look different, they belong in `ICONS`.
 */
export const ICON_ALIASES = {
  // Size steps
  "size-small": "size-s",
  "size-medium": "size-m",
  "size-large": "size-l",
  "size-extra-large": "size-xl",
  // Tool names carrying a `tool-` prefix
  "tool-pointer": "select",
  "tool-hand": "hand",
  "tool-pencil": "draw",
  "tool-eraser": "eraser",
  "tool-highlight": "highlight",
  "tool-laser": "laser",
  "tool-text": "text",
  "tool-note": "note",
  "tool-frame": "frame",
  "tool-arrow": "arrow",
  "tool-line": "line",
  "tool-media": "image",
  "tool-screenshot": "screenshot",
  // A shape label's alignment within its shape is the same mark as text
  // alignment within a paragraph.
  "horizontal-align-start": "text-align-left",
  "horizontal-align-middle": "text-align-center",
  "horizontal-align-end": "text-align-right",
  "vertical-align-start": "valign-top",
  "vertical-align-middle": "valign-middle",
  "vertical-align-end": "valign-bottom",
  // Plain `align-center` is ambiguous between the two axes; the horizontal one
  // is what a toolbar means by it.
  "align-center": "align-center-horizontal",
  // A paste command is marked with a clipboard. The artwork is spelled
  // `clipboard-copy` because the docs' copy-to-clipboard button claimed the
  // name first; the glyph is a plain clipboard and this is what a menu means
  // by paste.
  paste: "clipboard-copy",
  // The fill swatches were named after two of the colour tokens before they
  // were named after their own artwork. Same drawings, older spellings.
  "fill-semi": "fill-tint",
  "fill-solid": "fill-full",
  // Odds and ends
  "cross-2": "close",
  "question-mark-circle": "help-circle",
} as const satisfies Record<string, DrawnIconName>

/** An alias for a drawn icon. */
export type IconAlias = keyof typeof ICON_ALIASES

/** Any name the set answers to, drawn or aliased. */
export type IconName = DrawnIconName | IconAlias

/** Resolves an alias to the name that owns the artwork. Identity otherwise. */
export function resolveIconName(name: IconName): DrawnIconName {
  return (ICON_ALIASES as Record<string, DrawnIconName>)[name] ?? (name as DrawnIconName)
}

/** Whether the set can draw `name`, under that spelling or an alias. */
export function hasIcon(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name) || Object.prototype.hasOwnProperty.call(ICON_ALIASES, name)
}

/** All icon names, aliases included, sorted — handy for tests and galleries. */
export const ICON_NAMES = [...Object.keys(ICONS), ...Object.keys(ICON_ALIASES)].sort() as IconName[]

export interface IconProps {
  name: IconName
  /** Rendered size in px; the artwork is scaled from the 24×24 grid. */
  size?: number
  className?: string
}

/** Renders one icon from the set. Decorative by default: label the button instead. */
export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      className={className ? `mocanvas-icon ${className}` : "mocanvas-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[resolveIconName(name)]}
    </svg>
  )
}
