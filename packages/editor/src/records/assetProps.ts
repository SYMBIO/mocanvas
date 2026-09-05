/**
 * The props of the built-in asset types, as validator maps.
 *
 * They are exported separately from the asset *validators* because a props map
 * is composable and a finished validator is not: an app writing its own
 * image-like asset can spread `imageAssetProps` and add a field, which is the
 * whole reason these are data rather than being inlined.
 */

import { T } from "../validation/T"
import type { BaseAsset } from "./asset"
import type { AssetPropsForType } from "./props"

/** The props of an `image` asset: the file, its dimensions, and how to describe it. */
export const imageAssetProps = {
  w: T.number,
  h: T.number,
  name: T.string,
  isAnimated: T.boolean,
  mimeType: T.string.nullable(),
  src: T.srcUrl.nullable(),
  fileSize: T.number.optional(),
} as const

/**
 * The props of a `video` asset.
 *
 * Identical to an image's: the difference between the two is what the shape
 * does with the file, not what has to be stored about it.
 */
export const videoAssetProps = imageAssetProps

/** The props of a `bookmark` asset: the unfurled metadata behind a link card. */
export const bookmarkAssetProps = {
  title: T.string,
  description: T.string,
  image: T.string,
  favicon: T.string,
  src: T.linkUrl.nullable(),
} as const

/**
 * An asset whose type this build does not know.
 *
 * A document may carry assets registered by a newer version of an app, or by a
 * util that was not passed to this editor. They must survive a load and save
 * untouched, which means there has to be a type for "an asset, contents
 * unexamined".
 */
export type TLUnknownAsset = BaseAsset<string, object>

/** An asset record of type `Type`, with its props resolved from the global map. */
export type TLRegisteredAsset<Type extends string> = BaseAsset<Type, AssetPropsForType<Type>>
