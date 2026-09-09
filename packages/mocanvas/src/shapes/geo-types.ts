/**
 * The geo shape's *type table*: one entry per silhouette the `geo` shape can
 * take, and the seam an app extends it through.
 *
 * Before v5 the set of geo silhouettes was closed — a `switch` over a string
 * union in the util. It is now a table an app can add to
 * (`GeoShapeUtil.configure({ customGeoTypes })`), which is what lets a product
 * ship its own "cog" or "callout" as a `geo` shape rather than as a whole new
 * shape type with its own migrations, tool and style props.
 *
 * A definition answers three questions and no more: what outline to draw, how
 * to snap to it, and what to put on the toolbar button.
 */

import { GEO_SHAPE_KINDS, type GeoShapeKind, type Geometry2d } from "@mocanvas/editor"
import { getGeoGeometry } from "./geo-helpers"

/**
 * How other shapes snap to this silhouette.
 *
 * `"polygon"` snaps to the outline's own vertices and edge midpoints — right
 * for anything with corners. `"blobby"` ignores the outline and snaps to the
 * bounding box, which is what a cloud or a heart wants: its vertices are
 * artefacts of the curve fit and mean nothing to the person drawing.
 */
export type GeoSnapType = "polygon" | "blobby"

/** The kinds whose outline is curved, and therefore snap as blobs. */
const BLOBBY_KINDS: ReadonlySet<string> = new Set(["ellipse", "oval", "cloud", "heart"])

/** Options {@link GeoTypeDefinition.getPath} is given beyond the box. */
export interface GeoPathOptions {
  /** Whether the interior is painted, and so whether it is hit-testable. */
  isFilled?: boolean
  /**
   * The width the outline will be stroked at, when the type needs it.
   *
   * Only a mark that *ends on* the outline does: a stroke is centred on its
   * path and its round cap reaches half a width past the last point, so a line
   * drawn corner to corner of the box pokes out beyond the very outline it is
   * supposed to sit inside. The x-box's diagonals are the case. A type whose
   * marks stay clear of the edge can ignore it.
   */
  strokeWidth?: number
  /**
   * Mirror the silhouette left-to-right inside its own box. The box, the
   * bounds and the label do not move; only the outline turns over.
   *
   * A custom geo type that ignores these draws unflipped, which is the right
   * failure for a silhouette that is symmetric anyway.
   */
  flipX?: boolean | undefined
  /** Mirror the silhouette top-to-bottom; see {@link GeoPathOptions.flipX}. */
  flipY?: boolean | undefined
}

/**
 * One geo silhouette.
 *
 * The `id` is what lands in `shape.props.geo`, so it is part of the file
 * format: choose it once and do not rename it.
 */
export interface GeoTypeDefinition {
  /** The value stored in `props.geo`. */
  id: string
  /**
   * The outline in a `w × h` box, in shape-local coordinates.
   *
   * Returning a {@link Geometry2d} rather than a path string is what makes a
   * custom geo type a first-class shape: the same object drives hit-testing,
   * bounds, snapping and the indicator, so none of them can disagree.
   */
  getPath(w: number, h: number, opts?: GeoPathOptions): Geometry2d
  /** How other shapes snap to it; see {@link GeoSnapType}. */
  snapType: GeoSnapType
  /** Name of the toolbar / style-panel icon for this silhouette. */
  icon: string
  /**
   * The size a click (rather than a drag) places this silhouette at. Omitted
   * means "use the geo shape's own default box".
   */
  defaultSize?: { w: number; h: number }
  /**
   * What a double click on the shape does, when it should do something other
   * than start editing the label. Return a props patch, or nothing.
   */
  onDoubleClick?(shape: { id: string; props: { geo: string; w: number; h: number } }): { w?: number; h?: number } | void
}

/** The built-in table: one entry per {@link GeoShapeKind}. */
export const DEFAULT_GEO_TYPE_DEFINITIONS: Readonly<Record<GeoShapeKind, GeoTypeDefinition>> = Object.freeze(
  Object.fromEntries(
    GEO_SHAPE_KINDS.map((kind): [GeoShapeKind, GeoTypeDefinition] => [
      kind,
      {
        id: kind,
        getPath: (w, h, opts) => getGeoGeometry(kind, w, h, opts?.isFilled ?? false, { flipX: opts?.flipX, flipY: opts?.flipY }, opts?.strokeWidth ?? 0),
        snapType: BLOBBY_KINDS.has(kind) ? "blobby" : "polygon",
        // The icon set names its geo icons after the kind itself.
        icon: `geo-${kind}`,
      },
    ]),
  ) as Record<GeoShapeKind, GeoTypeDefinition>,
)

/**
 * The definition for a geo type, or `undefined` when nothing defines it.
 *
 * `customGeoTypes` wins over the built-in table, so an app may replace a
 * built-in silhouette as well as add to it — the same override order
 * `GeoShapeUtil` itself uses when it draws.
 */
export function getGeoTypeDefinition(
  geo: string,
  customGeoTypes?: Readonly<Record<string, GeoTypeDefinition>> | undefined,
): GeoTypeDefinition | undefined {
  if (typeof geo !== "string" || geo.length === 0) return undefined
  const custom = customGeoTypes?.[geo]
  if (custom !== undefined) return custom
  return (DEFAULT_GEO_TYPE_DEFINITIONS as Record<string, GeoTypeDefinition>)[geo]
}
