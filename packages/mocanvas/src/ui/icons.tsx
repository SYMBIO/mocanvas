/**
 * The default UI icon set: original artwork drawn on a 24×24 grid with a
 * 1.75px stroke, round caps and joins, painted with `currentColor` so buttons
 * control their own colour.
 *
 * Grid rules, enforced by `icons.test.tsx` where they are checkable statically
 * and by the gallery pass otherwise:
 *
 * - the artwork lives on a 24×24 viewBox; ink (stroke included) stays inside it
 * - ink is optically centred on (12, 12) and spans about 17.75 units at its
 *   widest, so no icon reads heavier than its neighbour in the same row
 * - stroke is 1.75 with round caps and joins; only texture marks (hatching,
 *   dotted rules, the mono rails) deviate, and they say so at the call site
 * - deliberate asymmetry is allowed only when it carries meaning, e.g. the
 *   vertical-align icons sit high or low on purpose
 *
 * Geo icons are generated from the same geometry the canvas draws, so a toolbar
 * button matches the shape it creates.
 */
import { GEO_SHAPE_KINDS, type GeoShapeKind } from "@mocanvas/editor"
import type { ReactElement } from "react"
import { getGeoGeometry } from "../shapes/geo-helpers"
import { pathWordsToSvgD } from "../shapes/svg-path"

/** Side of the drawing grid. */
export const ICON_GRID = 24
/** Longest side of the box a geo outline is fitted into, centred in the grid. */
export const GEO_BOX = 16

const solid = { fill: "currentColor", stroke: "none" } as const

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOL_ICONS = {
  select: <path d="M6.65 4.05v13.95l3.54-3.35 2.41 5.3 2.33-1.02-2.42-5.21 4.84-.19z" />,
  hand: (
    <path d="M8.35 14.6V9.5a1.3 1.3 0 0 1 2.6 0V5.3a1.3 1.3 0 0 1 2.6 0v.5a1.3 1.3 0 0 1 2.6 0v1.9a1.3 1.3 0 0 1 2.6 0v6.75c0 3.15-2.55 5.7-5.7 5.7h-.6c-1.9 0-3.68-.96-4.72-2.55l-1.75-2.65a1.3 1.3 0 0 1 2.17-1.42z" />
  ),
  draw: (
    <>
      <path d="M4.4 19.6l1.05-3.8L15.5 5.75a2 2 0 0 1 2.83 2.83L8.2 18.55z" />
      <path d="M13.55 7.7l2.83 2.83" />
    </>
  ),
  eraser: (
    <>
      <g transform="translate(12 10.5) rotate(-45)">
        <rect x="-5.75" y="-3.5" width="11.5" height="7" rx="1.6" />
        <path d="M0 -3.5V3.5" />
      </g>
      <path d="M7 19.4h10.5" />
    </>
  ),
  highlight: (
    <>
      {/* A chisel tip over the wet band it has just laid down. */}
      <path d="M9.15 14.9L6.1 11.85l7.15-6.4a2.15 2.15 0 0 1 3.05 3.05z" />
      <path d="M8.6 15.7l-2.9.6.5-2.95" />
      <path d="M5.2 20.05h13.6" strokeWidth={2.8} />
    </>
  ),
  laser: (
    <>
      <circle cx="12" cy="12" r="2.55" />
      <path d="M12 3.1v3.15M12 17.75v3.15M3.1 12h3.15M17.75 12h3.15" />
      <path d="M5.7 5.7l2.2 2.2M16.1 16.1l2.2 2.2M18.3 5.7l-2.2 2.2M7.9 16.1l-2.2 2.2" />
    </>
  ),
  text: (
    <>
      <path d="M5 6.25V4.5h14v1.75" />
      <path d="M12 4.5v15" />
      <path d="M8.75 19.5h6.5" />
    </>
  ),
  note: (
    <>
      <path d="M4.5 5.75A1.75 1.75 0 0 1 6.25 4h11.5a1.75 1.75 0 0 1 1.75 1.75v8L13.5 20H6.25A1.75 1.75 0 0 1 4.5 18.25z" />
      <path d="M19.5 13.75h-4.25a1.75 1.75 0 0 0-1.75 1.75V20" />
    </>
  ),
  frame: (
    <>
      <path d="M8 4.5v15M16 4.5v15" />
      <path d="M4.5 8h15M4.5 16h15" />
    </>
  ),
  arrow: (
    <>
      <path d="M5.15 18.85L18.85 5.15" />
      <path d="M12 5.15h6.85V12" />
    </>
  ),
  line: (
    <>
      <path d="M7.6 16.4L16.4 7.6" />
      <circle cx="5.85" cy="18.15" r="1.85" />
      <circle cx="18.15" cy="5.85" r="1.85" />
    </>
  ),
  image: (
    <>
      <rect x="3.9" y="5.25" width="16.2" height="13.5" rx="2.25" />
      <circle cx="8.9" cy="10" r="1.55" />
      <path d="M4 16.2l4.75-4.2 3.75 3.25 3-2.5 4.6 4.05" />
    </>
  ),
} as const

// ---------------------------------------------------------------------------
// View, history and object actions
// ---------------------------------------------------------------------------

const ACTION_ICONS = {
  "zoom-in": (
    <>
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path d="M15.4 15.4l5.1 5.1" />
      <path d="M8 10.75h5.5M10.75 8v5.5" />
    </>
  ),
  "zoom-out": (
    <>
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path d="M15.4 15.4l5.1 5.1" />
      <path d="M8 10.75h5.5" />
    </>
  ),
  "zoom-fit": (
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
  ),
  undo: (
    <>
      <path d="M4.25 8.75h10.25a5.25 5.25 0 0 1 0 10.5H10" />
      <path d="M8.25 4.75L4.25 8.75l4 4" />
    </>
  ),
  redo: (
    <>
      <path d="M19.75 8.75H9.5a5.25 5.25 0 0 0 0 10.5H14" />
      <path d="M15.75 4.75l4 4-4 4" />
    </>
  ),
  lock: (
    <>
      <rect x="4.75" y="10.5" width="14.5" height="9.5" rx="2.25" />
      <path d="M8.25 10.5V7.75a3.75 3.75 0 0 1 7.5 0v2.75" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.75" y="10.5" width="14.5" height="9.5" rx="2.25" />
      <path d="M8.25 10.5V7.75a3.75 3.75 0 0 1 7.15-1.5" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.25" />
      <path d="M15.5 4H6.25A2.25 2.25 0 0 0 4 6.25V15.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.75A1.5 1.5 0 0 1 11 4.25h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.75 7l.75 11.5A1.5 1.5 0 0 0 9 20h6a1.5 1.5 0 0 0 1.5-1.5L17.25 7" />
      <path d="M10.25 10.5v6M13.75 10.5v6" />
    </>
  ),
  group: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" />
      <rect x="7" y="7" width="4.5" height="4.5" rx="1" />
      <rect x="12.5" y="12.5" width="4.5" height="4.5" rx="1" />
    </>
  ),
  ungroup: (
    <>
      <path d="M4 8V5.25A1.25 1.25 0 0 1 5.25 4H8M16 4h2.75A1.25 1.25 0 0 1 20 5.25V8M20 16v2.75A1.25 1.25 0 0 1 18.75 20H16M8 20H5.25A1.25 1.25 0 0 1 4 18.75V16" />
      <rect x="7" y="7" width="4.5" height="4.5" rx="1" />
      <rect x="12.5" y="12.5" width="4.5" height="4.5" rx="1" />
    </>
  ),
  "bring-forward": (
    <>
      <rect x="4.75" y="11.25" width="14.5" height="8.75" rx="2.25" />
      <path d="M12 9V4M8.75 7.25L12 4l3.25 3.25" />
    </>
  ),
  "send-backward": (
    <>
      <rect x="4.75" y="4" width="14.5" height="8.75" rx="2.25" />
      <path d="M12 15v5M8.75 16.75L12 20l3.25-3.25" />
    </>
  ),
  "chevron-down": <path d="M6.75 9.75L12 15l5.25-5.25" />,
  "chevron-up": <path d="M6.75 14.25L12 9l5.25 5.25" />,
  check: <path d="M5 12.5l4.9 4.9L19 6.75" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  mixed: <circle cx="12" cy="12" r="7.25" strokeDasharray="2.6 2.8" />,
} as const

// ---------------------------------------------------------------------------
// Style properties
// ---------------------------------------------------------------------------

const FILL_BOX = { x: 4.25, y: 4.25, width: 15.5, height: 15.5, rx: 3 } as const

const STYLE_ICONS = {
  "fill-none": <rect {...FILL_BOX} />,
  "fill-semi": (
    <>
      <rect {...FILL_BOX} fill="currentColor" fillOpacity={0.22} />
    </>
  ),
  "fill-solid": <rect {...FILL_BOX} fill="currentColor" />,
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
  "align-left": <path d="M4.5 6.5h15M4.5 12h7.5M4.5 17.5h11.5" />,
  "align-center": <path d="M4.5 6.5h15M8.25 12h7.5M6.25 17.5h11.5" />,
  "align-right": <path d="M4.5 6.5h15M12 12h7.5M8 17.5h11.5" />,
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

/** Every icon in the set, keyed by name. */
export const ICONS = { ...TOOL_ICONS, ...ACTION_ICONS, ...STYLE_ICONS, ...GEO_ICONS }

export type IconName = keyof typeof ICONS

/** All icon names, sorted — handy for tests and galleries. */
export const ICON_NAMES = Object.keys(ICONS).sort() as IconName[]

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
      {ICONS[name]}
    </svg>
  )
}
