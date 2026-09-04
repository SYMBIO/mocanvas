import { T } from "../validation/T"
import type { Validator } from "../validation/validator"
import type { Asset, AssetId, BookmarkAsset, ImageAsset, VideoAsset } from "../records/asset"

/**
 * Per-type asset validators.
 *
 * One validator per asset type rather than a single record-wide one: an app
 * that only ever deals in images should be able to say so, and a failure should
 * name the type it was checked against ("At image_asset.props.w: ...") instead
 * of reporting that a value matched none of three shapes.
 */

/** An `asset:...` record id. */
export const assetIdValidator = T.idOfType<AssetId>("asset")

/** `w`, `h`, `src` and the file metadata an image or video asset carries. */
export const imageAssetPropsValidator = T.object({
  w: T.number,
  h: T.number,
  name: T.string,
  isAnimated: T.boolean,
  mimeType: T.string.nullable(),
  src: T.srcUrl.nullable(),
  fileSize: T.number.optional(),
})

/** The unfurled metadata a bookmark asset caches for its card. */
export const bookmarkAssetPropsValidator = T.object({
  title: T.string,
  description: T.string,
  image: T.srcUrl,
  favicon: T.srcUrl,
  src: T.linkUrl.nullable(),
})

function assetValidatorFor<A extends Asset>(
  type: A["type"],
  props: { validate(value: unknown): unknown; isValid(value: unknown): boolean },
): Validator<A> {
  return T.model(
    `${type}_asset`,
    T.object({
      id: assetIdValidator,
      typeName: T.literal("asset"),
      type: T.literal(type),
      props: props as Validator<unknown>,
      meta: T.jsonObject,
    }),
    // The config above describes exactly `A`, but `T.object` infers a structurally
    // equal-yet-distinct type (mutable `id`, `Record<string, unknown>` meta), and
    // `Validator` is invariant in its parameter. Restate the type we built.
  ) as unknown as Validator<A>
}

/** A bitmap asset: an image the canvas paints inside an `image` shape. */
export const imageAssetValidator: Validator<ImageAsset> = assetValidatorFor<ImageAsset>(
  "image",
  imageAssetPropsValidator,
)

/** A video asset. Same props as an image; the shape decides how it is played. */
export const videoAssetValidator: Validator<VideoAsset> = assetValidatorFor<VideoAsset>(
  "video",
  imageAssetPropsValidator,
)

/** A link asset: the unfurled title, description and images behind a bookmark shape. */
export const bookmarkAssetValidator: Validator<BookmarkAsset> = assetValidatorFor<BookmarkAsset>(
  "bookmark",
  bookmarkAssetPropsValidator,
)

/**
 * Any asset, dispatched on `type`.
 *
 * This is what a store uses to check an `asset` record; reach for the per-type
 * validators when you already know which one you have.
 */
export const assetValidator: Validator<Asset> = T.union("type", {
  image: imageAssetValidator,
  video: videoAssetValidator,
  bookmark: bookmarkAssetValidator,
}) as unknown as Validator<Asset>

/** The per-type validators, keyed by asset type — handy for a lookup by `asset.type`. */
export const assetValidators = {
  image: imageAssetValidator,
  video: videoAssetValidator,
  bookmark: bookmarkAssetValidator,
} as const
