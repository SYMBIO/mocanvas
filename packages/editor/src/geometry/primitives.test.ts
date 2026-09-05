import { describe, expect, it } from "vitest"
import { Box, Mat, Vec } from "./index"

describe("Vec statics", () => {
  it("keeps the transform/question split: statics never touch their input", () => {
    const a = new Vec(3, 4)
    expect(Vec.Uni(a).len()).toBeCloseTo(1, 12)
    expect(a.toJson()).toEqual({ x: 3, y: 4 })
    expect(a.uni()).toBe(a)
    expect(a.len()).toBeCloseTo(1, 12)
  })

  it("Dpr and Cpr are the two products, and Dot is the old name for Dpr", () => {
    const a = new Vec(1, 2)
    const b = new Vec(3, 4)
    expect(Vec.Dpr(a, b)).toBe(11)
    expect(Vec.Dot(a, b)).toBe(11)
    expect(a.dpr(b)).toBe(11)
    expect(a.dot(b)).toBe(11)
    expect(Vec.Cpr(a, b)).toBe(-2)
    expect(a.cpr(b)).toBe(-2)
    // Cross is the vector product; its z is the scalar cross.
    expect(Vec.Cross(a, b).z).toBe(-2)
  })

  it("FromAngle, ToAngle and AngleBetween agree", () => {
    const v = Vec.FromAngle(Math.PI / 3, 5)
    expect(v.len()).toBeCloseTo(5, 12)
    expect(v.toAngle()).toBeCloseTo(Math.PI / 3, 12)
    // ToAngle normalizes into [0, 2π).
    expect(new Vec(0, -1).toAngle()).toBeCloseTo((Math.PI * 3) / 2, 12)
    expect(Vec.AngleBetween(new Vec(1, 0), new Vec(0, 1))).toBeCloseTo(Math.PI / 2, 12)
  })

  it("Nudge, Med, Rescale and ScaleWithOrigin", () => {
    expect(Vec.Nudge({ x: 0, y: 0 }, { x: 10, y: 0 }, 3).toJson()).toEqual({ x: 3, y: 0 })
    expect(Vec.Med({ x: 0, y: 0 }, { x: 10, y: 4 }).toJson()).toEqual({ x: 5, y: 2 })
    expect(Vec.Rescale({ x: 0, y: 4 }, 2).toJson()).toEqual({ x: 0, y: 2 })
    expect(Vec.ScaleWithOrigin({ x: 10, y: 10 }, 2, { x: 5, y: 5 }).toJson()).toEqual({ x: 15, y: 15 })
  })

  it("line helpers clamp to the segment unless told not to", () => {
    const A = { x: 0, y: 0 }
    const B = { x: 10, y: 0 }
    expect(Vec.NearestPointOnLineSegment(A, B, { x: 20, y: 5 }).toJson()).toEqual({ x: 10, y: 0 })
    expect(Vec.NearestPointOnLineSegment(A, B, { x: 20, y: 5 }, false).toJson()).toEqual({ x: 20, y: 0 })
    expect(Vec.DistanceToLineThroughPoint(A, { x: 1, y: 0 }, { x: 20, y: 5 })).toBeCloseTo(5, 12)
  })

  it("PointsBetween spans the ends and carries pressure only when there is any", () => {
    const plain = Vec.PointsBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, 3)
    expect(plain.map((p) => p.toJson())).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ])
    const pressured = Vec.PointsBetween({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 1 }, 3)
    expect(pressured[1]!.pressure).toBeCloseTo(0.5, 12)
  })

  it("z is pressure, is absent by default, and stays out of the serialized form", () => {
    expect(new Vec(1, 2).z).toBeUndefined()
    expect(new Vec(1, 2).pressure).toBe(1)
    expect(new Vec(1, 2).toJson()).toEqual({ x: 1, y: 2 })
    expect(new Vec(1, 2, 0.25).toJson()).toEqual({ x: 1, y: 2, z: 0.25 })
    expect(Vec.From({ x: 1, y: 2, z: 0.25 }).clone().pressure).toBe(0.25)
  })

  it("predicates and conversions", () => {
    expect(Vec.EqualsXY({ x: 1, y: 2 }, 1, 2)).toBe(true)
    expect(Vec.IsNaN({ x: Number.NaN, y: 0 })).toBe(true)
    expect(Vec.IsFinite({ x: Infinity, y: 0 })).toBe(false)
    expect(Vec.ManhattanDist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7)
    expect(Vec.DistMin({ x: 0, y: 0 }, { x: 3, y: 4 }, 6)).toBe(true)
    expect(Vec.DistMin({ x: 0, y: 0 }, { x: 3, y: 4 }, 4)).toBe(false)
    expect(Vec.ToInt({ x: 1.9, y: -1.9 }).toJson()).toEqual({ x: 1, y: -1 })
    expect(Vec.ToArray({ x: 1, y: 2 })).toEqual([1, 2])
    expect(Vec.Clockwise({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 })).toBe(true)
    expect(Number.isNaN(Vec.Slope({ x: 1, y: 0 }, { x: 1, y: 5 }))).toBe(true)
  })
})

describe("Box statics", () => {
  it("Expand unions two boxes, and the scalar form is ExpandBy", () => {
    const union = Box.Expand(new Box(0, 0, 10, 10), new Box(20, 20, 10, 10))
    expect(union.toJson()).toEqual({ x: 0, y: 0, w: 30, h: 30 })
    expect(Box.Expand(new Box(10, 10, 10, 10), 5).toJson()).toEqual({ x: 5, y: 5, w: 20, h: 20 })
  })

  it("Includes is Contains or Collides; Contains alone is not enough for a graze", () => {
    const a = new Box(0, 0, 10, 10)
    const b = new Box(5, 5, 20, 20)
    expect(Box.Contains(a, b)).toBe(false)
    expect(Box.Includes(a, b)).toBe(true)
    expect(Box.Includes(a, new Box(50, 50, 1, 1))).toBe(false)
  })

  it("ContainsApproximately forgives float dust that Contains does not", () => {
    const outer = new Box(0, 0, 100, 100)
    const inner = new Box(-1e-9, 0, 100, 100)
    expect(Box.Contains(outer, inner)).toBe(false)
    expect(Box.ContainsApproximately(outer, inner)).toBe(true)
  })

  it("ZeroFix folds a negative size back into the position", () => {
    expect(Box.ZeroFix(new Box(10, 10, -4, -6)).toJson()).toEqual({ x: 6, y: 4, w: 4, h: 6 })
    expect(new Box(10, 10, -4, -6).zeroFix().toJson()).toEqual({ x: 6, y: 4, w: 4, h: 6 })
  })

  it("FromCenter and the derived accessors", () => {
    const b = Box.FromCenter({ x: 50, y: 50 }, { x: 20, y: 10 })
    expect(b.toJson()).toEqual({ x: 40, y: 45, w: 20, h: 10 })
    expect([b.left, b.right, b.top, b.bottom]).toEqual([40, 60, 45, 55])
    expect([b.midX, b.midY]).toEqual([50, 50])
    expect(b.aspectRatio).toBe(2)
    expect(b.size.toJson()).toEqual({ x: 20, y: 10 })
    expect(b.point.toJson()).toEqual({ x: 40, y: 45 })
    expect(b.cornersAndCenter).toHaveLength(5)
    expect(b.sides).toHaveLength(4)
  })

  it("setting point, size and center moves without distorting", () => {
    const b = new Box(0, 0, 10, 20)
    b.center = { x: 100, y: 100 }
    expect(b.toJson()).toEqual({ x: 95, y: 90, w: 10, h: 20 })
    b.point = { x: 0, y: 0 }
    expect(b.toJson()).toEqual({ x: 0, y: 0, w: 10, h: 20 })
    b.size = { x: 4, y: 4 }
    expect(b.toJson()).toEqual({ x: 0, y: 0, w: 4, h: 4 })
  })

  it("Sides inset pulls each side's ends in along the edge", () => {
    const [top] = Box.Sides(new Box(0, 0, 100, 100), 10)
    expect(top![0]!.toJson()).toEqual({ x: 10, y: 0 })
    expect(top![1]!.toJson()).toEqual({ x: 90, y: 0 })
  })

  it("getHandlePoint names each of the eight handles", () => {
    const b = new Box(0, 0, 100, 50)
    expect(b.getHandlePoint("top_left").toJson()).toEqual({ x: 0, y: 0 })
    expect(b.getHandlePoint("bottom_right").toJson()).toEqual({ x: 100, y: 50 })
    expect(b.getHandlePoint("right").toJson()).toEqual({ x: 100, y: 25 })
    expect(b.getHandlePoint("top").toJson()).toEqual({ x: 50, y: 0 })
    // A rotate handle resolves to the corner it sits outside.
    expect(b.getHandlePoint("bottom_left_rotate").toJson()).toEqual({ x: 0, y: 50 })
  })

  it("Resize reports a signed scale and flips rather than going negative", () => {
    const grown = Box.Resize(new Box(0, 0, 100, 100), "right", 50, 0)
    expect(grown.box.toJson()).toEqual({ x: 0, y: 0, w: 150, h: 100 })
    expect(grown.scaleX).toBeCloseTo(1.5, 12)
    const flipped = Box.Resize(new Box(0, 0, 100, 100), "right", -150, 0)
    expect(flipped.box.toJson()).toEqual({ x: -50, y: 0, w: 50, h: 100 })
    expect(flipped.scaleX).toBeCloseTo(-0.5, 12)
  })

  it("snapToGrid keeps the box a whole number of cells and never collapses it", () => {
    const b = new Box(3, 3, 4, 4)
    b.snapToGrid(10)
    expect(b.toJson()).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })

  it("union and expand are the same growth", () => {
    const a = new Box(0, 0, 10, 10)
    expect(a.union({ x: 20, y: 0, w: 10, h: 10 })).toBe(a)
    expect(a.toJson()).toEqual({ x: 0, y: 0, w: 30, h: 10 })
  })
})

describe("Mat additions", () => {
  it("invert mutates and is its own undo", () => {
    const m = Mat.Identity().translate(10, 20).rotate(0.4)
    const copy = m.clone()
    expect(m.invert()).toBe(m)
    // The inverse undoes the original, and inverting twice comes back.
    expect(m.applyToPoint(copy.applyToPoint({ x: 3, y: 4 })).x).toBeCloseTo(3, 9)
    const back = m.invert().applyToPoint({ x: 3, y: 4 })
    expect(back.x).toBeCloseTo(copy.applyToPoint({ x: 3, y: 4 }).x, 9)
    // A singular matrix has no inverse and becomes the identity rather than NaN.
    expect(Mat.Identity().scale(0, 0).invert().equals(Mat.Identity())).toBe(true)
  })

  it("Rotate about a pivot leaves the pivot alone", () => {
    const m = Mat.Rotate(Math.PI / 2, 50, 50)
    const p = m.applyToPoint({ x: 50, y: 50 })
    expect(p.x).toBeCloseTo(50, 9)
    expect(p.y).toBeCloseTo(50, 9)
  })

  it("applyToBounds gives the bounding box of the transformed rectangle", () => {
    const m = Mat.Rotate(Math.PI / 4)
    const b = Mat.applyToBounds(m, new Box(0, 0, 10, 10))
    expect(b.w).toBeCloseTo(Math.SQRT2 * 10, 9)
  })

  it("Scale, Point, applyToXY, setTo, identity and equals", () => {
    expect(Mat.Scale(2, 3).toJson()).toEqual({ a: 2, b: 0, c: 0, d: 3, e: 0, f: 0 })
    expect(Mat.Point({ a: 1, b: 0, c: 0, d: 1, e: 7, f: 8 }).toJson()).toEqual({ x: 7, y: 8 })
    expect(Mat.applyToXY(Mat.Translate(1, 2), 10, 10)).toEqual([11, 12])
    const m = Mat.Identity()
    expect(m.setTo(Mat.Translate(5, 5))).toBe(m)
    expect(m.equals(Mat.Translate(5, 5))).toBe(true)
    expect(m.identity().equals(Mat.Identity())).toBe(true)
  })

  it("Smooth rounds away float dust and Absolute removes a reflection", () => {
    expect(Mat.Smooth({ a: 1.000000001, b: 0, c: 0, d: 1, e: 0, f: 0 }).a).toBe(1)
    const mirrored = Mat.Identity().scale(-2, 2)
    expect(Mat.Absolute(mirrored).decompose().scaleX).toBeCloseTo(2, 9)
  })

  it("multiplyBy is retained as an alias of multiply", () => {
    const a = Mat.Identity().translate(1, 2)
    const b = Mat.Identity().translate(1, 2)
    expect(a.multiply(Mat.Translate(3, 4)).toJson()).toEqual(b.multiplyBy(Mat.Translate(3, 4)).toJson())
  })
})
