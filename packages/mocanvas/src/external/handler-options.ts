/**
 * What the default external-content handlers are configured with.
 *
 * Split into two interfaces because they are configured from two places. The
 * limits in {@link TLExternalContentProps} are props on `<Mocanvas>` — an app
 * decides them once. The toasts and the translator in
 * {@link TLDefaultExternalContentHandlerOpts} are React contexts, so a handler
 * can only be given them from inside the UI tree; that is why the handlers take
 * them as a third argument rather than reading them themselves.
 */

import type { TLUiToastsContextType } from "../ui/ui-toasts"
import type { TLUiTranslationKey } from "../ui/ui-translation"

/** The file limits an app configures on the component. */
export interface TLExternalContentProps {
  /** The mime types of images that are allowed to be handled. */
  acceptedImageMimeTypes?: readonly string[]
  /** The mime types of videos that are allowed to be handled. */
  acceptedVideoMimeTypes?: readonly string[]
  /** The maximum size (in bytes) of an asset. Defaults to 10mb. */
  maxAssetSize?: number
  /** The maximum dimension (width or height) of an image. Defaults to infinity. */
  maxImageDimension?: number
}

/** {@link TLExternalContentProps} plus the two UI contexts a handler needs to talk to the user. */
export interface TLDefaultExternalContentHandlerOpts extends TLExternalContentProps {
  /** The translator, from `useTranslation()`. */
  msg: (id: TLUiTranslationKey) => string
  /** The toast queue, from `useToasts()`. */
  toasts: TLUiToastsContextType
}
