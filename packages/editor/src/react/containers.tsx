import type { CSSProperties, HTMLAttributes, ReactNode, Ref, SVGAttributes } from "react"

/**
 * Shape-body containers.
 *
 * A shape that renders through `ShapeUtil.component` is painted on the DOM
 * overlay, inside the wrapper `<Canvas>` builds for it (`.mocanvas-shape`):
 * an absolutely positioned box already sized to the shape's geometry bounds,
 * already carrying the shape's page transform and opacity, and already
 * carrying the pointer-events policy for the current editing state.
 *
 * These two components are the body that goes *inside* that wrapper. They
 * exist so a shape util written by an app — one this library has never seen —
 * lands in the same box, with the same class names and the same
 * pointer-events conventions, as the shapes that ship with mocanvas. A util
 * should return exactly one of them at its root.
 */

/**
 * The box both containers fill: the whole of the wrapper `<Canvas>` sized to
 * the shape's geometry bounds, anchored at its top-left in shape-local space.
 */
const CONTAINER_BOX: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
}

/*
 * SEMANTICS-ASSUMED — pointer events.
 * Neither container sets `pointer-events`. `pointer-events` is an inherited
 * CSS property, and `<Canvas>`'s per-shape wrapper already sets the policy
 * mocanvas wants: `none` normally (the engine hit-tests on the canvas, so the
 * DOM body must not swallow the pointer) and `auto` while that shape is being
 * edited (so a text caret or an embedded input works). Inheriting reproduces
 * both without a container-level rule, and still lets a body opt in the way
 * the consumer's shape utils do — `<HTMLContainer style={{ pointerEvents:
 * "all" }}>` wins over an inherited `none` on the ancestor, because
 * `pointer-events: none` on an ancestor only removes *that ancestor* from
 * hit-testing; a descendant may re-enable itself.
 */

/*
 * SEMANTICS-ASSUMED — overflow.
 * `HTMLContainer` leaves `overflow` at the CSS initial `visible`, matching the
 * wrapper `<Canvas>` builds (which does not clip either) and matching the
 * shape clipping mocanvas *does* do, which is a frame's page-space clip rect
 * applied by an outer element. So a shadow, a label or a port that overhangs
 * the geometry bounds is drawn, and a consumer that writes
 * `style={{ overflow: "visible" }}` gets a no-op rather than a surprise.
 * `SVGContainer` sets `overflow: "visible"` explicitly, because the UA
 * stylesheet clips `<svg>` to its viewport and a stroke centred on the
 * geometry edge would lose its outer half — the same reason `<Canvas>`'s own
 * indicator layer sets it.
 */

export interface HTMLContainerProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
  ref?: Ref<HTMLDivElement>
}

/**
 * The DOM body of a shape. Fills the shape's bounds; anything else — size,
 * pointer-events, overflow, a class of your own — is set through `style` and
 * `className`, which are merged over the defaults rather than replacing them.
 */
export function HTMLContainer({ children, className, style, ...rest }: HTMLContainerProps) {
  return (
    <div
      {...rest}
      className={className ? `mocanvas-html-container ${className}` : "mocanvas-html-container"}
      style={{ ...CONTAINER_BOX, ...style }}
    >
      {children}
    </div>
  )
}

export interface SVGContainerProps extends SVGAttributes<SVGSVGElement> {
  children?: ReactNode
  ref?: Ref<SVGSVGElement>
}

/**
 * The SVG body of a shape: an `<svg>` filling the shape's bounds, whose user
 * space is the shape's own local coordinate space, so a `<path>` drawn at
 * `(0, 0)` sits at the shape's origin at any pan, zoom or rotation.
 */
export function SVGContainer({ children, className, style, ...rest }: SVGContainerProps) {
  return (
    <svg
      {...rest}
      className={className ? `mocanvas-svg-container ${className}` : "mocanvas-svg-container"}
      style={{ ...CONTAINER_BOX, overflow: "visible", ...style }}
    >
      {children}
    </svg>
  )
}

/**
 * Stop an event travelling any further up the tree.
 *
 * The canvas listens for pointer events on its container, so a click on a
 * piece of chrome rendered over it — a toolbar button, a menu, a panel —
 * would also start a canvas interaction. Hanging this on the chrome's root
 * (`onPointerDown={stopEventPropagation}`) keeps the two apart.
 *
 * Typed structurally rather than against `React.SyntheticEvent` so it can be
 * handed to a native listener, a React handler, or a test double alike.
 */
export function stopEventPropagation(event: { stopPropagation(): void }): void {
  event.stopPropagation()
}
