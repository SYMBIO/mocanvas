/**
 * The default UI icon set: original artwork drawn on a 24×24 grid with a
 * 1.75px stroke, round caps and joins, painted with `currentColor` so buttons
 * control their own colour. Geo icons are generated from the same geometry the
 * canvas draws, so a toolbar button matches the shape it creates.
 */
import { GEO_SHAPE_KINDS, type GeoShapeKind } from "@mocanvas/editor"
import type { ReactElement } from "react"
import { getGeoGeometry } from "../shapes/geo-helpers"
import { pathWordsToSvgD } from "../shapes/svg-path"

/** Side of the drawing grid. */
export const ICON_GRID = 24
/** Side of the box the geo outlines are fitted into, centred in the grid. */
const GEO_BOX = 18
const GEO_INSET = (ICON_GRID - GEO_BOX) / 2

const solid = { fill: "currentColor", stroke: "none" } as const

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOL_ICONS = {
  select: <path d="M5 2.5v15l3.8-3.6 2.6 5.7 2.5-1.1-2.6-5.6 5.2-.2z" />,
  hand: (
    <path d="M6.75 15.5V10.5a1.25 1.25 0 0 1 2.5 0V6a1.25 1.25 0 0 1 2.5 0v-.75a1.25 1.25 0 0 1 2.5 0V8a1.25 1.25 0 0 1 2.5 0v6.75c0 3.45-2.8 6.25-6.25 6.25h-.75c-2.05 0-3.95-1.05-5.1-2.8l-1.55-2.6a1.35 1.35 0 0 1 2.3-1.35l1.35 1.25z" />
  ),
  draw: (
    <>
      <path d="M4 20l1.1-4L15.6 5.5a2.05 2.05 0 0 1 2.9 2.9L8 18.9z" />
      <path d="M13.5 7.6l2.9 2.9" />
    </>
  ),
  eraser: (
    <>
      <g transform="translate(12 11) rotate(-45)">
        <rect x="-6.25" y="-3.75" width="12.5" height="7.5" rx="1.75" />
        <path d="M0 -3.75V3.75" />
      </g>
      <path d="M9 20.5h10.5" />
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
      <path d="M7.75 3v18M16.25 3v18" />
      <path d="M3 7.75h18M3 16.25h18" />
    </>
  ),
  arrow: (
    <>
      <path d="M4.75 19.25L19.25 4.75" />
      <path d="M12.25 4.75h7v7" />
    </>
  ),
  line: (
    <>
      <path d="M7.4 16.6L16.6 7.4" />
      <circle cx="5.5" cy="18.5" r="1.9" />
      <circle cx="18.5" cy="5.5" r="1.9" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.75" width="17" height="14.5" rx="2.25" />
      <circle cx="8.75" cy="9.75" r="1.6" />
      <path d="M3.6 16.4l4.9-4.4 3.9 3.4 3.1-2.6 4.9 4.3" />
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
      <path d="M4 9.75h9.75a5.5 5.5 0 0 1 0 11H9" />
      <path d="M7.75 5.75L3.75 9.75l4 4" />
    </>
  ),
  redo: (
    <>
      <path d="M20 9.75h-9.75a5.5 5.5 0 0 0 0 11H15" />
      <path d="M16.25 5.75l4 4-4 4" />
    </>
  ),
  lock: (
    <>
      <rect x="4.75" y="10.25" width="14.5" height="9.75" rx="2.25" />
      <path d="M8.25 10.25V7.5a3.75 3.75 0 0 1 7.5 0v2.75" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.75" y="10.25" width="14.5" height="9.75" rx="2.25" />
      <path d="M8.25 10.25V7.5a3.75 3.75 0 0 1 7.15-1.5" />
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
      <path d="M4.5 6.75h15" />
      <path d="M9.5 6.75V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5v1.25" />
      <path d="M6.75 6.75l.75 12A1.5 1.5 0 0 0 9 20.25h6a1.5 1.5 0 0 0 1.5-1.5l.75-12" />
      <path d="M10.25 10.5v6M13.75 10.5v6" />
    </>
  ),
  group: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="3 3" />
      <rect x="6.75" y="6.75" width="4.75" height="4.75" rx="1" />
      <rect x="12.5" y="12.5" width="4.75" height="4.75" rx="1" />
    </>
  ),
  ungroup: (
    <>
      <path d="M3.5 8V4.75A1.25 1.25 0 0 1 4.75 3.5H8M16 3.5h3.25a1.25 1.25 0 0 1 1.25 1.25V8M20.5 16v3.25a1.25 1.25 0 0 1-1.25 1.25H16M8 20.5H4.75a1.25 1.25 0 0 1-1.25-1.25V16" />
      <rect x="6.75" y="6.75" width="4.75" height="4.75" rx="1" />
      <rect x="12.5" y="12.5" width="4.75" height="4.75" rx="1" />
    </>
  ),
  "bring-forward": (
    <>
      <rect x="4.5" y="10.75" width="15" height="9.25" rx="2.25" />
      <path d="M12 8.5V3M8.75 6.25L12 3l3.25 3.25" />
    </>
  ),
  "send-backward": (
    <>
      <rect x="4.5" y="4" width="15" height="9.25" rx="2.25" />
      <path d="M12 15.5V21M8.75 17.75L12 21l3.25-3.25" />
    </>
  ),
  "chevron-down": <path d="M6.75 9.75L12 15l5.25-5.25" />,
  check: <path d="M5 12.5l4.9 4.9L19 6.75" />,
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
  "fill-pattern": (
    <>
      <rect {...FILL_BOX} />
      <path d="M6.2 12.6l6.4-6.4M6.2 17.1l10.9-10.9M9.4 18.3l8.9-8.9M14.6 18.4l3.7-3.7" strokeWidth={1.25} />
    </>
  ),
  "dash-draw": <path d="M4 14.9c1.6-3.4 3.2-4.9 4.9-4.4 1.7.4 2.4 4 4.2 4.4 1.9.4 3.9-1.9 6.9-5.9" />,
  "dash-solid": <path d="M4.25 12h15.5" />,
  "dash-dashed": <path d="M4.5 12h15" strokeDasharray="3.1 2.8" />,
  "dash-dotted": <path d="M5 12h14" strokeDasharray="0.01 4.35" strokeWidth={2.6} />,
  "size-s": <circle cx="12" cy="12" r="2" {...solid} />,
  "size-m": <circle cx="12" cy="12" r="3.4" {...solid} />,
  "size-l": <circle cx="12" cy="12" r="4.9" {...solid} />,
  "size-xl": <circle cx="12" cy="12" r="6.6" {...solid} />,
  "align-left": <path d="M4.5 6.25h15M4.5 12h9.25M4.5 17.75h12.5" />,
  "align-center": <path d="M4.5 6.25h15M7.4 12h9.2M5.75 17.75h12.5" />,
  "align-right": <path d="M4.5 6.25h15M10.25 12h9.25M7 17.75h12.5" />,
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
  "font-draw": (
    <>
      <path d="M6.3 19.3c.6-2 1.5-4.4 2.6-7.1 1-2.4 2-4.7 3-6.9 1.2 3.1 2.4 6.1 3.6 8.9 1 2.4 1.7 4.1 2.2 5.1" />
      <path d="M8.6 14.9c2.2-1 4.4-.9 6.6.2" />
    </>
  ),
  "font-sans": (
    <>
      <path d="M6.5 19L12 5l5.5 14" />
      <path d="M8.6 14.5h6.8" />
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
      <path d="M4.75 5.75v12.5M19.25 5.75v12.5" strokeWidth={1.4} />
    </>
  ),
} as const

// ---------------------------------------------------------------------------
// Geo kinds, derived from the canvas geometry
// ---------------------------------------------------------------------------

/** `d` attribute for each geo kind, fitted to an 18×18 box. */
export const GEO_ICON_PATHS: Record<GeoShapeKind, string> = Object.fromEntries(
  GEO_SHAPE_KINDS.map((kind) => [kind, pathWordsToSvgD(getGeoGeometry(kind, GEO_BOX, GEO_BOX, false).toPathWords())]),
) as Record<GeoShapeKind, string>

type GeoIconName = `geo-${GeoShapeKind}`

const GEO_ICONS = Object.fromEntries(
  GEO_SHAPE_KINDS.map((kind) => [
    `geo-${kind}`,
    <g transform={`translate(${GEO_INSET} ${GEO_INSET})`}>
      <path d={GEO_ICON_PATHS[kind]} />
    </g>,
  ]),
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
