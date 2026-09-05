/**
 * How an icon is named, and how an app supplies one of its own.
 *
 * An icon slot in the UI accepts three things, and they are all spelled the
 * same way in a menu item: a name from the built-in set, a URL, or a React
 * element. The types here say so, so an app writing an override can be told at
 * compile time that its icon name is not one mocanvas ships — while still
 * leaving the door open for its own artwork.
 */

import type { ReactElement } from "react"
import { ICON_NAMES, type IconName } from "./icons"

/**
 * A built-in icon name, or any string.
 *
 * Widened to `string` on purpose: an app's override may name artwork it serves
 * itself, and a union that refused those would make every custom menu item a
 * cast. Editors still autocomplete the built-in names, which is the part that
 * actually helps.
 */
export type TLUiIconType = IconName | (string & {})

/** A ready-made element used in place of a named icon. */
export type TLUiIconJsx = ReactElement

/**
 * Every icon name mocanvas ships, sorted.
 *
 * Exported as a value rather than only as a type so a picker, a storybook page
 * or a test can enumerate them.
 */
export const iconTypes: readonly TLUiIconType[] = ICON_NAMES
