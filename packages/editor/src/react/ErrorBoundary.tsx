import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react"

/**
 * Failure containment for the editor's React tree.
 *
 * One badly-behaved shape component should cost you that shape, not the
 * document: `<Canvas>` wraps each shape body in a boundary of its own, and the
 * editor as a whole is wrapped in another. Without this, a `TypeError` inside
 * one custom `ShapeUtil.component` unmounts the whole editor and the user
 * loses the canvas.
 */

export interface TLErrorFallbackProps {
  /** What was thrown. Not necessarily an `Error`. */
  error: unknown
  /** Re-mount the subtree. Undefined when the boundary was told not to retry. */
  resetError?(): void
}

export interface TLErrorBoundaryProps {
  children: ReactNode
  /** Rendered in place of the subtree once it has thrown. */
  fallback: (props: TLErrorFallbackProps) => ReactNode
  /** Reported to the host app: logging, error tracking. */
  onError?(error: unknown, info?: ErrorInfo): void
}

/** The pre-`TL` spelling of {@link TLErrorBoundaryProps}. The same type. */
export type ErrorBoundaryProps = TLErrorBoundaryProps

/**
 * A replacement for the editor-wide error screen, or `null` to render nothing
 * at all.
 *
 * `null` is a real choice, not an oversight: a host that shows its own error UI
 * outside the canvas wants the editor to fail silently rather than to draw a
 * second, competing message.
 */
export type TLErrorFallbackComponent = ComponentType<TLErrorFallbackProps> | null

/**
 * A replacement for the fallback drawn in place of a single broken shape, or
 * `null` to draw nothing.
 *
 * Separate from {@link TLErrorFallbackComponent} because the situations are not
 * comparable: one shape failing should cost that shape, and the fallback is
 * drawn *in the canvas*, at the shape's position, where a whole error screen
 * would be absurd.
 */
export type TLShapeErrorFallbackComponent = ComponentType<{ error: unknown }> | null

interface ErrorBoundaryState {
  error: unknown
  hasError: boolean
}

/**
 * Catches a render-time throw in its subtree and renders `fallback` instead.
 *
 * Class component because that is the only form React gives an error boundary;
 * there is no hook equivalent.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, hasError: false }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, hasError: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError?.(error, info)
  }

  private readonly resetError = () => {
    this.setState({ error: null, hasError: false })
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback({ error: this.state.error, resetError: this.resetError })
    }
    return this.props.children
  }
}

/**
 * What an unhandled error looks like when nothing better is configured: the
 * message, and a button that re-mounts the subtree.
 *
 * Deliberately plain and self-contained — it must render correctly when the
 * failure is in the very stylesheet or provider the rest of the chrome needs.
 */
export function DefaultErrorFallback({ error, resetError }: TLErrorFallbackProps) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="mocanvas-error-fallback" role="alert" style={{ padding: 16, font: "13px/1.5 system-ui, sans-serif" }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 15 }}>Something went wrong</h2>
      <p style={{ margin: "0 0 12px", whiteSpace: "pre-wrap" }}>{message}</p>
      {resetError ? (
        <button type="button" onClick={resetError}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

export interface ErrorScreenProps {
  children?: ReactNode
}

/**
 * A full-bleed error surface, for a failure that happened before there was an
 * editor to put a fallback inside of — a store that would not load, a schema
 * that would not migrate.
 */
export function ErrorScreen({ children }: ErrorScreenProps) {
  return (
    <div
      className="mocanvas-error-screen"
      role="alert"
      style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", font: "13px/1.5 system-ui, sans-serif" }}
    >
      <div>{children}</div>
    </div>
  )
}

/**
 * The indeterminate progress mark, sized to the text around it.
 *
 * Uses SMIL rather than a CSS keyframe so it also animates when the editor is
 * mounted without `ui.css` — the case a loading screen is most likely to hit,
 * since it is on screen before anything else has been set up.
 */
export function DefaultSpinner() {
  return (
    <svg className="mocanvas-spinner" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g strokeWidth="2" fill="none" stroke="currentColor">
        <circle cx="8" cy="8" r="6" opacity="0.25" />
        <path d="M14 8a6 6 0 0 0-6-6" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.75s" repeatCount="indefinite" />
        </path>
      </g>
    </svg>
  )
}

export interface LoadingScreenProps {
  children?: ReactNode
}

/**
 * What is on screen while the editor's store and engine are still coming up.
 *
 * Occupies the editor's whole box so the layout does not jump when the canvas
 * replaces it, and is labelled as a live region so a screen reader is told
 * that something is loading rather than that the page is empty.
 */
export function LoadingScreen({ children }: LoadingScreenProps) {
  return (
    <div
      className="mocanvas-loading-screen"
      role="progressbar"
      aria-busy="true"
      aria-label="Loading"
      style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", font: "13px/1.5 system-ui, sans-serif" }}
    >
      {children ?? <DefaultSpinner />}
    </div>
  )
}
