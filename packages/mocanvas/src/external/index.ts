export * from "./defaultExternalContentHandlers"
export { useExternalContent } from "./useExternalContent"
export {
  defaultHandleExternalUrlContent,
  createEmbedShape,
  createBookmarkShape,
  BOOKMARK_UNFURL_FAILED,
  type ExternalUrlContentOptions,
  type ExternalUrlToasts,
} from "./urlContent"

// --- the tldraw-shaped default handler family --------------------------------
export type { TLDefaultExternalContentHandlerOpts, TLExternalContentProps } from "./handler-options"
export {
  defaultHandleExternalEmbedContent,
  defaultHandleExternalFileAsset,
  defaultHandleExternalFileContent,
  defaultHandleExternalFileReplaceContent,
  defaultHandleExternalSvgTextContent,
  defaultHandleExternalTextContent,
  defaultHandleExternalTldrawContent,
  defaultHandleExternalUrlAsset,
} from "./defaultHandlers"
export { sanitizeSvg } from "./sanitizeSvg"
export { createBookmarkFromUrl, type CreateBookmarkResult } from "./bookmarks"
export {
  defaultHandleExternalExcalidrawContent,
  isExcalidrawClipboardContent,
  putExcalidrawContent,
} from "./excalidraw"
export {
  embedPermissionsToAllowAttribute,
  embedShapePermissionDefaults,
  type CustomEmbedDefinition,
  type DefaultEmbedConfig,
  type DefaultEmbedDefinitionType,
  type GoogleMapsEmbedConfig,
  type TLEmbedResult,
} from "./embeds"
