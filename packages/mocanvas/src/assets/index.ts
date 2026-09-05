/**
 * Assets: the utils for the three built-in types, and the file handling every
 * asset path shares.
 */
export {
  BookmarkAssetUtil,
  DEFAULT_MAX_ASSET_SIZE,
  DEFAULT_SUPPORTED_IMAGE_TYPES,
  DEFAULT_SUPPORTED_VIDEO_TYPES,
  ImageAssetUtil,
  VideoAssetUtil,
  defaultAssetUtils,
  type AssetUtilClass,
  type AssetUtilOptions,
} from "./AssetUtils"
export {
  createShapesForAssets,
  downsizeDimensions,
  downsizeImage,
  notifyIfFileNotAllowed,
  readImageSize,
  type ImageDimensions,
} from "./media"
