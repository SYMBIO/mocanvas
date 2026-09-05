/**
 * The usable height of the browser viewport, tracked as it changes.
 *
 * @deprecated Size the editor's container with CSS instead — `100dvh`, a grid
 * row, or whatever the surrounding layout already uses. This hook predates
 * dynamic viewport units and the `visualViewport` API being reliable, and a
 * pixel height written into a style attribute is always one frame behind the
 * layout it is trying to match. It is kept because removing it would break apps
 * that still call it.
 */
import { useEffect, useState } from "react"

/**
 * The visual viewport's height in CSS pixels.
 *
 * Follows the *visual* viewport rather than the layout viewport, which is the
 * only reason this ever existed: on a phone the on-screen keyboard shrinks the
 * visible area without changing `window.innerHeight`, so an editor sized from
 * the layout viewport puts its toolbar underneath the keyboard.
 *
 * Returns `0` where there is no DOM, so a server render produces markup rather
 * than throwing.
 */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(() => readHeight())

  useEffect(() => {
    if (typeof window === "undefined") return

    const update = () => setHeight(readHeight())
    update()

    const visual = window.visualViewport
    // `visualViewport` is the accurate source but is not everywhere; the window
    // events are the fallback and are harmless to listen to in either case.
    visual?.addEventListener("resize", update)
    visual?.addEventListener("scroll", update)
    window.addEventListener("resize", update)
    window.addEventListener("orientationchange", update)

    return () => {
      visual?.removeEventListener("resize", update)
      visual?.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      window.removeEventListener("orientationchange", update)
    }
  }, [])

  return height
}

function readHeight(): number {
  if (typeof window === "undefined") return 0
  return window.visualViewport?.height ?? window.innerHeight ?? 0
}
