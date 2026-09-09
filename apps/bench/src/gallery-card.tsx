/**
 * A custom shape whose body is ordinary HTML, registered by the *app* rather than
 * built into either library.
 *
 * This is the part of the gallery that is not a comparison of two renderers but a
 * comparison of two extension points: the shape below is written once, against the
 * primitives both libraries publish (`BaseBoxShapeUtil`, `HTMLContainer`), and each
 * page supplies its own imports. If it renders the same on both, an app's own shapes
 * port across without being rewritten — which is the thing a drop-in replacement has
 * to get right and the thing a pixel diff of built-in shapes never tests.
 *
 * The two `Deps` the pages pass differ only in where they come from.
 */
import type { ReactElement } from "react"

export interface GalleryCardProps {
  w: number
  h: number
  title: string
  body: string
}

/** The primitives each library publishes under the same names. */
export interface CardDeps {
  /** `BaseBoxShapeUtil` from the library this page is running. */
  BaseBoxShapeUtil: new (...args: never[]) => unknown
  /** `HTMLContainer` from the same library. */
  HTMLContainer: (props: { children?: unknown; style?: Record<string, unknown> }) => ReactElement | null
}

const DEFAULTS: GalleryCardProps = { w: 300, h: 160, title: "Custom", body: "" }

/**
 * Build the shape util class against one library's primitives.
 *
 * A factory rather than a class because the base class is not the same object in
 * the two pages — that is precisely what is being tested.
 */
export function makeGalleryCardUtil({ BaseBoxShapeUtil, HTMLContainer }: CardDeps): unknown {
  const Base = BaseBoxShapeUtil as unknown as new (...args: never[]) => Record<string, unknown>

  class GalleryCardUtil extends Base {
    static type = "gallery-card" as const
    // Deliberately loose: the two libraries' validator vocabularies are not the
    // subject here, and a shape can declare its props without them.
    static props = undefined

    getDefaultProps(): GalleryCardProps {
      return { ...DEFAULTS }
    }

    canEdit(): boolean {
      return false
    }
    canResize(): boolean {
      return true
    }
    isAspectRatioLocked(): boolean {
      return false
    }

    component(shape: { props: GalleryCardProps }): ReactElement | null {
      const { w, h, title, body } = { ...DEFAULTS, ...shape.props }
      return HTMLContainer({
        style: { pointerEvents: "all" },
        children: (
          <div
            style={{
              width: w,
              height: h,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 16,
              borderRadius: 12,
              border: "2px solid #1d4ed8",
              background: "linear-gradient(140deg, #eff6ff, #dbeafe)",
              font: "13px/1.45 system-ui, sans-serif",
              color: "#1e3a8a",
              overflow: "hidden",
            }}
          >
            <strong style={{ fontSize: 15 }}>{title}</strong>
            <span>{body}</span>
            <code style={{ marginTop: "auto", fontSize: 11, opacity: 0.7 }}>type: "gallery-card"</code>
          </div>
        ),
      })
    }

    indicator(shape: { props: GalleryCardProps }): ReactElement | null {
      const { w, h } = { ...DEFAULTS, ...shape.props }
      return <rect width={w} height={h} rx={12} />
    }
  }

  return GalleryCardUtil
}
