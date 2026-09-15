import type { CSSProperties } from "react"
import { Icon, hasIcon } from "./icons"

/**
 * The icon element the UI primitives use.
 *
 * Distinct from {@link Icon}, which takes a name the set is known to have.
 * This one takes an arbitrary string, because a `TLUiActionItem.icon` comes
 * from an app's override and may name artwork mocanvas does not ship: an
 * unknown name falls back to the label's initial rather than rendering an
 * empty box, so a custom item is still a legible button.
 */
export interface TLUiIconProps {
  /** Icon name, or an image URL when it contains a `/` or `.`. */
  icon: string
  /** Read out when the icon is the button's only content. */
  label?: string
  /** Draw at the smaller size used inside dense rows. */
  small?: boolean
  /** Mirror horizontally, for a direction icon in a right-to-left locale. */
  invertIcon?: boolean
  className?: string
  style?: CSSProperties
  color?: string
}

/** Whether `icon` looks like a URL rather than a name in the built-in set. */
function isUrl(icon: string): boolean {
  return icon.includes("/") || icon.includes(".")
}

/**
 * An icon, from the built-in set, from a URL, or as a fallback initial.
 *
 * `aria-hidden` unless it was given a label: an icon inside a labelled button
 * is decoration, and announcing it would make a screen reader say the name
 * twice.
 */
export function TldrawUiIcon({ icon, label, small, invertIcon, className, style, color }: TLUiIconProps) {
  const classes = ["mocanvas-icon", small ? "mocanvas-icon--small" : null, className].filter(Boolean).join(" ")
  const transform = invertIcon ? "scaleX(-1)" : undefined
  const size = small ? 16 : 20

  if (hasIcon(icon)) {
    return (
      <span className={classes} style={{ ...style, color, transform, display: "inline-flex" }} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
        <Icon name={icon} size={size} />
      </span>
    )
  }

  if (isUrl(icon)) {
    return (
      <img
        className={classes}
        src={icon}
        alt={label ?? ""}
        width={size}
        height={size}
        style={{ ...style, transform }}
        {...(label ? {} : { "aria-hidden": true })}
      />
    )
  }

  return (
    <span
      className={`${classes} mocanvas-icon--fallback`}
      style={{ ...style, color, transform, width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {(label ?? icon).slice(0, 1).toUpperCase()}
    </span>
  )
}
