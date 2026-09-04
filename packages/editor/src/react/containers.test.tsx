import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { HTMLContainer, SVGContainer, stopEventPropagation } from "./containers"

function markup(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
}

describe("HTMLContainer", () => {
  it("fills the shape's bounds box", () => {
    const html = markup(<HTMLContainer />)
    expect(html).toContain("position:absolute")
    expect(html).toContain("top:0")
    expect(html).toContain("left:0")
    expect(html).toContain("width:100%")
    expect(html).toContain("height:100%")
  })

  it("carries the container class, and keeps a caller's class too", () => {
    expect(markup(<HTMLContainer />)).toContain('class="mocanvas-html-container"')
    expect(markup(<HTMLContainer className="card" />)).toContain('class="mocanvas-html-container card"')
  })

  it("does not set pointer-events, so the shape wrapper's policy is inherited", () => {
    expect(markup(<HTMLContainer />)).not.toContain("pointer-events")
  })

  it("lets a shape opt into pointer events and its own size", () => {
    const html = markup(<HTMLContainer style={{ width: 120, height: 80, pointerEvents: "all", overflow: "visible" }} />)
    expect(html).toContain("width:120px")
    expect(html).toContain("height:80px")
    expect(html).toContain("pointer-events:all")
    expect(html).toContain("overflow:visible")
  })

  it("does not clip by default", () => {
    // The wrapper `<Canvas>` builds does not clip either; a shadow or a port
    // that overhangs the geometry bounds has to survive.
    expect(markup(<HTMLContainer />)).not.toContain("overflow:hidden")
  })

  it("passes DOM attributes through", () => {
    const html = markup(<HTMLContainer data-testid="body" aria-label="Node" />)
    expect(html).toContain('data-testid="body"')
    expect(html).toContain('aria-label="Node"')
  })
})

describe("SVGContainer", () => {
  it("fills the bounds box and does not clip its strokes", () => {
    const html = markup(<SVGContainer />)
    expect(html).toContain("position:absolute")
    expect(html).toContain("width:100%")
    expect(html).toContain("overflow:visible")
    expect(html).toContain('class="mocanvas-svg-container"')
  })

  it("renders its children into the shape's own coordinate space", () => {
    const html = markup(
      <SVGContainer style={{ overflow: "visible" }}>
        <path d="M0,0 L10,10" fill="none" stroke="red" strokeWidth={2} />
      </SVGContainer>,
    )
    expect(html).toContain("<svg")
    expect(html).toContain('d="M0,0 L10,10"')
  })
})

describe("a custom shape body", () => {
  // A shape util the library has never seen: it renders whatever it likes
  // inside an HTMLContainer, and gets positioned like every built-in.
  interface WidgetShape {
    id: string
    props: { w: number; h: number; text: string }
  }
  const WidgetUtil = {
    component(shape: WidgetShape) {
      return (
        <HTMLContainer style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}>
          <div className="widget">{shape.props.text}</div>
        </HTMLContainer>
      )
    },
  }

  it("renders through the container with its own size and content", () => {
    const html = markup(WidgetUtil.component({ id: "s1", props: { w: 240, h: 90, text: "Ingest" } }))
    expect(html).toContain('class="mocanvas-html-container"')
    expect(html).toContain("width:240px")
    expect(html).toContain("height:90px")
    expect(html).toContain("pointer-events:all")
    expect(html).toContain('<div class="widget">Ingest</div>')
  })
})

describe("stopEventPropagation", () => {
  it("stops the event and nothing else", () => {
    const stopPropagation = vi.fn()
    const preventDefault = vi.fn()
    stopEventPropagation({ stopPropagation, preventDefault } as unknown as { stopPropagation(): void })
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it("is usable straight as a React handler", () => {
    const stopPropagation = vi.fn()
    const handler: (e: { stopPropagation(): void }) => void = stopEventPropagation
    handler({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalled()
  })
})
