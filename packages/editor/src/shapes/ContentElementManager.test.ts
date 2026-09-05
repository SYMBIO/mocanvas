// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { ContentElementManager, type ContentElementSource } from "./ContentElementManager"
import type { ShapeId, UnknownShape } from "../records/base"

/**
 * The contract that makes a cross-origin iframe survivable: one element per
 * shape, handed out again rather than rebuilt, and released only when the
 * shape or the editor goes away.
 */

function shape(id: string): UnknownShape {
  return {
    id: `shape:${id}` as ShapeId,
    typeName: "shape",
    type: "embed",
    parentId: "page:1",
    index: "a1",
    x: 0,
    y: 0,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    props: {},
    meta: {},
  } as unknown as UnknownShape
}

function makeHost(util: ContentElementSource) {
  return { getShapeUtil: () => util }
}

/** A util that mints a fresh `<iframe>` every time it is asked. */
function iframeUtil(): ContentElementSource & { released: HTMLElement[]; made: number } {
  const state = {
    made: 0,
    released: [] as HTMLElement[],
    getContentElement() {
      state.made++
      return document.createElement("iframe")
    },
    onReleaseContentElement(_s: UnknownShape, element: HTMLElement) {
      state.released.push(element)
    },
  }
  return state
}

describe("ContentElementManager", () => {
  it("creates an element once and hands the same one back", () => {
    const util = iframeUtil()
    const manager = new ContentElementManager(makeHost(util))
    const a = shape("a")

    const first = manager.get(a)
    const second = manager.get(a)

    expect(first).toBeDefined()
    expect(second).toBe(first)
    expect(util.made).toBe(1)
  })

  it("hands the same element back for a later version of the shape", () => {
    const util = iframeUtil()
    const manager = new ContentElementManager(makeHost(util))

    const first = manager.get(shape("a"))
    // A different object, same id: an edit, not a new shape.
    const second = manager.get({ ...shape("a"), x: 40 } as UnknownShape)

    expect(second).toBe(first)
    expect(util.made).toBe(1)
  })

  it("gives nothing for a util that has no content element", () => {
    const manager = new ContentElementManager(makeHost({}))
    expect(manager.get(shape("a"))).toBeUndefined()
    expect(manager.has(shape("a").id)).toBe(false)
  })

  it("releasing detaches the element from the DOM and tells the util", () => {
    const util = iframeUtil()
    const manager = new ContentElementManager(makeHost(util))
    const a = shape("a")
    const element = manager.get(a)!
    document.body.appendChild(element)

    manager.release(a.id)

    expect(util.released).toEqual([element])
    expect(element.parentNode).toBeNull()
    expect(manager.has(a.id)).toBe(false)
  })

  it("releases a shape only once, and ignores a shape it never had", () => {
    const util = iframeUtil()
    const manager = new ContentElementManager(makeHost(util))
    const a = shape("a")
    manager.get(a)

    manager.release(a.id)
    manager.release(a.id)
    manager.release(shape("never").id)

    expect(util.released).toHaveLength(1)
  })

  it("releases the last version of the shape it saw", () => {
    const util = iframeUtil()
    const seen: UnknownShape[] = []
    const manager = new ContentElementManager(
      makeHost({
        getContentElement: (shape) => util.getContentElement!(shape),
        onReleaseContentElement: (s) => {
          seen.push(s)
        },
      }),
    )
    manager.get(shape("a"))
    manager.get({ ...shape("a"), x: 99 } as UnknownShape)

    manager.release(shape("a").id)

    expect(seen).toHaveLength(1)
    expect(seen[0]!.x).toBe(99)
  })

  it("disposing releases everything", () => {
    const util = iframeUtil()
    const manager = new ContentElementManager(makeHost(util))
    manager.get(shape("a"))
    manager.get(shape("b"))

    manager.dispose()

    expect(util.released).toHaveLength(2)
    expect(manager.has(shape("a").id)).toBe(false)
  })

  it("keeps going when one util throws on release", () => {
    const boom = vi.fn(() => {
      throw new Error("no")
    })
    const util = iframeUtil()
    const manager = new ContentElementManager({
      getShapeUtil: (s: UnknownShape): ContentElementSource =>
        s.id === shape("a").id
          ? { getContentElement: (sh) => util.getContentElement!(sh), onReleaseContentElement: boom }
          : util,
    })
    manager.get(shape("a"))
    manager.get(shape("b"))

    expect(() => manager.dispose()).not.toThrow()
    expect(boom).toHaveBeenCalled()
    expect(util.released).toHaveLength(1)
    expect(manager.has(shape("b").id)).toBe(false)
  })
})
