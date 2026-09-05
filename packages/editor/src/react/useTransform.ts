import { useLayoutEffect, useEffect, type RefObject } from "react"

/**
 * Imperative DOM updates for things that change every frame.
 *
 * The camera moves on every pointer move of a pan and on every tick of a
 * zoom animation. Routing that through React state would re-render the shape
 * tree at pointer rate; writing the transform straight onto the element does
 * not, and is why these are effects over a ref rather than props.
 */

/**
 * Write a page-to-screen transform onto an element.
 *
 * The order — translate, then scale, then rotate — is the order the editor
 * composes a shape's own transform in, so a value taken from
 * `editor.getShapePageTransform()` can be handed straight through.
 *
 * Passing `undefined` for `x` (or `y`) clears the transform, which is how a
 * component says "not positioned yet" without unmounting.
 */
export function useTransform(
  ref: RefObject<HTMLElement | SVGElement | null>,
  x?: number,
  y?: number,
  scale?: number,
  rotate?: number,
  additionalOffset?: { x: number; y: number },
): void {
  useLayoutEffect(() => {
    const elm = ref.current
    if (!elm) return
    if (x === undefined || y === undefined) {
      elm.style.transform = ""
      return
    }
    let transform = `translate(${x}px, ${y}px)`
    if (scale !== undefined && scale !== 1) transform += ` scale(${scale})`
    if (rotate !== undefined && rotate !== 0) transform += ` rotate(${rotate}rad)`
    if (additionalOffset) transform += ` translate(${additionalOffset.x}px, ${additionalOffset.y}px)`
    elm.style.transform = transform
  })
}

/** `preventDefault` as a standalone handler, for hanging on an event directly. */
export function preventDefault(event: { preventDefault(): void }): void {
  event.preventDefault()
}

/**
 * Let a wheel event over this element reach the canvas underneath it.
 *
 * A scrollable panel over the canvas swallows the wheel, so zooming with the
 * pointer over a toolbar does nothing — which reads as the editor being
 * broken. This re-dispatches the event on the element behind the panel, and
 * suppresses the browser's own scrolling of the page.
 *
 * The listener is registered non-passively on purpose: a passive wheel
 * listener may not call `preventDefault`, and suppressing the page scroll is
 * half the point.
 */
export function usePassThroughWheelEvents(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const elm = ref.current
    if (!elm) return
    const onWheel = (event: WheelEvent) => {
      // A genuine scroll inside the panel wins: only pass through what the
      // panel itself cannot use.
      if ((event as WheelEvent & { isSpecialRedispatchedEvent?: boolean }).isSpecialRedispatchedEvent) return
      event.preventDefault()
      const cloned = new WheelEvent(event.type, event) as WheelEvent & { isSpecialRedispatchedEvent?: boolean }
      cloned.isSpecialRedispatchedEvent = true
      elm.parentElement?.dispatchEvent(cloned)
    }
    elm.addEventListener("wheel", onWheel, { passive: false })
    return () => elm.removeEventListener("wheel", onWheel)
  }, [ref])
}
