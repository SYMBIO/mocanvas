import { describe, expect, it } from "vitest"
import { PATH_OP } from "@mocanvas/wasm"
import { Box, Ellipse2d, Group2d, Polyline2d, Rectangle2d, Vec } from "./index"

describe("geometry", () => {
  it("rectangle serializes to a closed polygon", () => {
    const r = new Rectangle2d({ width: 10, height: 5, isFilled: true })
    expect(r.toPathWords()).toEqual([PATH_OP.MOVE, 0, 0, PATH_OP.LINE, 10, 0, PATH_OP.LINE, 10, 5, PATH_OP.LINE, 0, 5, PATH_OP.CLOSE])
    expect(r.bounds).toEqual(new Box(0, 0, 10, 5))
    expect(r.hitTestPoint({ x: 5, y: 2 }, 0, true)).toBe(true)
    expect(r.hitTestPoint({ x: 5, y: 2 }, 0, false)).toBe(false)
    expect(r.hitTestPoint({ x: 5, y: 0.5 }, 1, false)).toBe(true)
  })

  it("ellipse uses cubics and tight bounds", () => {
    const e = new Ellipse2d({ width: 100, height: 40, isFilled: false })
    const w = e.toPathWords()
    expect(w[0]).toBe(PATH_OP.MOVE)
    expect(w.filter((x, i) => i % 7 === 3 && x === PATH_OP.CUBIC).length).toBe(4)
    expect(Math.round(e.bounds.w)).toBe(100)
  })

  it("polyline is open and nearest point works", () => {
    const l = new Polyline2d({ points: [new Vec(0, 0), new Vec(10, 0)] })
    expect(l.isClosed).toBe(false)
    expect(l.nearestPoint({ x: 5, y: 3 })).toEqual(new Vec(5, 0))
    expect(l.distanceToPoint({ x: 5, y: 3 })).toBe(3)
  })

  it("group skips labels in path words", () => {
    const g = new Group2d({
      children: [
        new Rectangle2d({ width: 10, height: 10, isFilled: true }),
        new Rectangle2d({ width: 4, height: 4, isFilled: false, isLabel: true }),
      ],
    })
    expect(g.toPathWords().length).toBe(13)
  })
})
