/**
 * A heavy DOM-overlay shape for the DOM-overlay benchmark (`scripts/dom-overlay.mjs`).
 *
 * The built-in shapes are drawn on the GPU, so the main benchmark never mounts
 * more than a label's worth of DOM. An app's own shapes are the opposite: every
 * card on a product board is a `ShapeUtil.component` rendering a few hundred
 * nodes of ordinary React. This is that card — about 150 nodes — written once
 * against the primitives both libraries publish, the way `gallery-card.tsx` is.
 *
 * Two types: `dom-card` lets the renderer cull it, `dom-card-live` opts out with
 * `canCull() === false`, the way a live embed or a playing video does.
 *
 * The body counts its own renders, mounts and unmounts on
 * `window.__domBench`, which is how the driver tells a re-render from a
 * remount without a profiling build of React.
 */
import { useLayoutEffect, type ReactElement } from "react"

export interface DomCardProps {
  w: number
  h: number
  index: number
}

export interface DomBenchCounters {
  renders: number
  mounts: number
  unmounts: number
}

declare global {
  interface Window {
    __domBench?: DomBenchCounters
  }
}

function counters(): DomBenchCounters {
  const w = window as Window
  return (w.__domBench ??= { renders: 0, mounts: 0, unmounts: 0 })
}

/** Rows in the card's list; each row is six nodes, so 24 rows put the card at ~150. */
const ROWS = 24

const DEFAULTS: DomCardProps = { w: 280, h: 200, index: 0 }

function DomCardBody({ w, h, index }: DomCardProps): ReactElement {
  counters().renders++
  useLayoutEffect(() => {
    counters().mounts++
    return () => {
      counters().unmounts++
    }
  }, [])
  const rows: ReactElement[] = []
  for (let r = 0; r < ROWS; r++) {
    rows.push(
      <li key={r} style={{ display: "flex", gap: 4, whiteSpace: "nowrap" }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: r % 3 ? "#93c5fd" : "#f59e0b" }} />
        <span>
          <b>#{index}</b>.{r}
        </span>
        <span style={{ opacity: 0.6 }}>row</span>
        <span style={{ marginLeft: "auto" }}>{(index * 31 + r * 7) % 97}</span>
      </li>,
    )
  }
  return (
    <div
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        padding: 10,
        borderRadius: 10,
        border: "1px solid #94a3b8",
        background: "#ffffff",
        font: "9px/1.2 system-ui, sans-serif",
        color: "#0f172a",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <header style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <div style={{ width: 18, height: 18, borderRadius: 9, background: "#1d4ed8" }} />
        <strong style={{ fontSize: 11 }}>Card {index}</strong>
        <em style={{ marginLeft: "auto", opacity: 0.6 }}>draft</em>
      </header>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", columns: 2, columnGap: 8 }}>{rows}</ul>
      <footer style={{ marginTop: "auto", display: "flex", gap: 4 }}>
        <span>tag</span>
        <span>tag</span>
        <span>tag</span>
      </footer>
    </div>
  )
}

/** The primitives each library publishes under the same names. */
export interface DomCardDeps {
  BaseBoxShapeUtil: new (...args: never[]) => unknown
  HTMLContainer: (props: { children?: unknown; style?: Record<string, unknown> }) => ReactElement | null
}

export const DOM_CARD_TYPE = "dom-card"
export const DOM_CARD_LIVE_TYPE = "dom-card-live"

/** Build the cullable and the non-cullable card utils against one library's primitives. */
export function makeDomCardUtils({ BaseBoxShapeUtil, HTMLContainer }: DomCardDeps): [unknown, unknown] {
  const Base = BaseBoxShapeUtil as unknown as new (...args: never[]) => Record<string, unknown>

  class DomCardUtil extends Base {
    static type = DOM_CARD_TYPE
    static props = undefined

    getDefaultProps(): DomCardProps {
      return { ...DEFAULTS }
    }
    canEdit(): boolean {
      return false
    }
    component(shape: { props: DomCardProps }): ReactElement | null {
      const props = { ...DEFAULTS, ...shape.props }
      return HTMLContainer({ children: <DomCardBody {...props} /> })
    }
    indicator(shape: { props: DomCardProps }): ReactElement | null {
      const { w, h } = { ...DEFAULTS, ...shape.props }
      return <rect width={w} height={h} rx={10} />
    }
  }

  class DomCardLiveUtil extends DomCardUtil {
    static override type = DOM_CARD_LIVE_TYPE
    canCull(): boolean {
      return false
    }
  }

  return [DomCardUtil, DomCardLiveUtil]
}
