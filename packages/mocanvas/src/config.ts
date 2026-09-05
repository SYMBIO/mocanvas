/**
 * The flagship's configuration seams, under the names they are documented by.
 *
 * Nothing here has behaviour. Each entry is the shape an app fills in — the
 * geo table it may extend, the asset urls it may self-host, the options a
 * custom shape util resolves its display values through — kept in one file so
 * "what can I configure" is one import rather than a hunt through the barrel.
 */

import type { TLDefaultDisplayValues, TLEditorAssetUrls, TLUiAssetUrls, ShapeUtilOptions, UnknownShape } from "@mocanvas/editor"
import { DEFAULT_GEO_TYPE_DEFINITIONS, type GeoTypeDefinition } from "./shapes/geo-types"

/**
 * A shape util's options, including how it resolves its style props into the
 * concrete values it paints with.
 *
 * The second type argument is the util's own display values: a util that only
 * paints the shared set leaves it at {@link TLDefaultDisplayValues}, and one
 * that adds its own — a note's body size, a label's padding — names its own
 * interface here and gets it back from `getDisplayValues`.
 */
export interface ShapeOptionsWithDisplayValues<T extends UnknownShape = UnknownShape, D extends object = TLDefaultDisplayValues>
  extends ShapeUtilOptions<T, D> {}

/**
 * The built-in geo forms, keyed by their `geo` prop value.
 *
 * The table `GeoShapeUtil.configure({ customGeoTypes })` merges over: an entry
 * with a key that is already here replaces that form, and a new key adds one.
 */
export const defaultGeoTypeDefinitions: Readonly<Record<string, GeoTypeDefinition>> = DEFAULT_GEO_TYPE_DEFINITIONS

/**
 * A partial override of the self-hosted asset urls, as an app supplies one.
 *
 * Two levels deep, because that is how the map is shaped: an override that
 * names one icon should not have to restate every other icon, and one that
 * names icons should not have to restate the fonts.
 */
export type TLUiAssetUrlOverrides = {
  [K in keyof TLUiAssetUrls]?: Readonly<Record<string, string>>
}

/**
 * The editor's default asset urls: none.
 *
 * mocanvas serves nothing from a CDN. Its icons are inline SVG, it ships no
 * translation bundles, and every built-in font face names a family that is
 * already on the machine — so the map an app would override is empty rather
 * than pointing somewhere. The *mechanism* is the point (`assetUrls` on the
 * component, `useAssetUrls()` below it); an app that self-hosts fills this in,
 * and one that does not never loads anything over the network.
 */
export const defaultEditorAssetUrls: TLEditorAssetUrls = Object.freeze({})
