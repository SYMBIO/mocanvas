import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ReactNode } from "react"
import type { IndexKey } from "@mocanvas/store"
import { createShapeId, PageRecordType, type UnknownShape } from "../records/base"
import { getShapeIndicatorNode } from "./Canvas"

/** A shape record with no store behind it: the indicator rule never reads one. */
function makeShape(type: string): UnknownShape {
  return {
    id: createShapeId(),
    typeName: "shape",
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1" as IndexKey,
    parentId: PageRecordType.createId("page"),
    isLocked: false,
    opacity: 1,
    props: {},
    meta: {},
  }
}

const BOUNDS = { x: 5, y: 6, w: 40, h: 30 }

function markup(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
}

describe("getShapeIndicatorNode", () => {
  it("draws what the util's own indicator returns", () => {
    const shape = makeShape("sigil")
    const util = { indicator: (s: UnknownShape) => <polygon data-testid="sigil" data-id={s.id} points="0,0 10,0 5,9" /> }
    const html = markup(getShapeIndicatorNode(util, shape, BOUNDS))
    expect(html).toContain('data-testid="sigil"')
    expect(html).toContain('points="0,0 10,0 5,9"')
    // The util spoke, so the bounds rectangle is not drawn on top of it.
    expect(html).not.toContain("<rect")
  })

  it("passes the shape to the util", () => {
    const shape = makeShape("sigil")
    const seen: UnknownShape[] = []
    const util = {
      indicator: (s: UnknownShape) => {
        seen.push(s)
        return <circle r={3} />
      },
    }
    getShapeIndicatorNode(util, shape, BOUNDS)
    expect(seen).toEqual([shape])
  })

  it("falls back to the geometry bounds rectangle when the util has no indicator", () => {
    const html = markup(getShapeIndicatorNode({}, makeShape("bare"), BOUNDS))
    expect(html).toBe('<rect x="5" y="6" width="40" height="30"></rect>')
  })

  it("falls back to the bounds rectangle when the indicator returns nothing", () => {
    for (const empty of [null, undefined, false] as const) {
      const html = markup(getShapeIndicatorNode({ indicator: () => empty }, makeShape("quiet"), BOUNDS))
      expect(html, String(empty)).toBe('<rect x="5" y="6" width="40" height="30"></rect>')
    }
  })

  it("draws nothing when there is neither an indicator nor bounds", () => {
    expect(getShapeIndicatorNode({}, makeShape("bare"), undefined)).toBeNull()
    expect(getShapeIndicatorNode({ indicator: () => null }, makeShape("quiet"), undefined)).toBeNull()
  })

  it("keeps an indicator that draws nothing visible of its own", () => {
    // An empty fragment is still an answer: no bounds rectangle appears.
    const html = markup(getShapeIndicatorNode({ indicator: () => <></> }, makeShape("hidden"), BOUNDS))
    expect(html).toBe("")
  })
})
