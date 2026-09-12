import { describe, expect, it, vi } from "vitest"
import type { Editor } from "@mocanvas/editor"
import {
  CollaboratorCursorOverlayUtil,
  DEFAULT_COLLABORATOR_OVERLAY_OPTIONS,
  type CollaboratorOverlayUtilOptions,
} from "./CollaboratorOverlayUtils"
import type { TLCollaboratorCursorOverlay } from "./types"

/**
 * What a subclass needs in order to redraw a collaborator cursor.
 *
 * Both of these were reported by a consumer who could not express "paint some
 * of these myself, let the inherited painter do the rest" without narrowing
 * `getOverlays()` — which every other reader of it would then see narrowed too.
 */

function person(id: string, name: string, x = 0) {
  return { id, userName: name, color: "#f00", cursor: { x, y: 0, rotation: 0 }, chatMessage: "", selectedShapeIds: [] }
}

function makeEditor(people: unknown[]) {
  return {
    collaborators: {
      getVisibleCollaboratorsOnCurrentPage: () => people,
      isCollaboratorIdle: () => false,
    },
    pageToViewport: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
  } as unknown as Editor
}

/** A 2D context that records nothing but answers measurement. */
function fakeCtx() {
  const calls: string[] = []
  const ctx = new Proxy(
    {
      font: "",
      measureText: (t: string) => ({ width: t.length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }),
      fillText: (t: string) => calls.push(`fillText:${t}`),
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      arc: () => {},
      quadraticCurveTo: () => {},
      setTransform: () => {},
      scale: () => {},
      rect: () => {},
      clip: () => {},
    } as unknown as CanvasRenderingContext2D,
    { get: (t, k) => (k in t ? (t as unknown as Record<string, unknown>)[k as string] : () => {}), set: () => true },
  )
  return { ctx, calls }
}

describe("rendering a subset without narrowing getOverlays", () => {
  it("hands render the overlays the manager already resolved", () => {
    const editor = makeEditor([person("instance_presence:a", "Ada"), person("instance_presence:b", "Bo", 50)])
    const util = new CollaboratorCursorOverlayUtil(editor)
    const { ctx, calls } = fakeCtx()
    const all = util.getOverlays()
    expect(all).toHaveLength(2)

    // Paint only one of them, and leave getOverlays() telling the truth.
    util.render(ctx, [all[0]!])
    expect(calls.filter((c) => c.startsWith("fillText:"))).toEqual(["fillText:Ada"])
    expect(util.getOverlays(), "hit-testing and the cursor lookup still see both").toHaveLength(2)
  })

  it("falls back to its own list when the caller passes none", () => {
    const editor = makeEditor([person("instance_presence:a", "Ada")])
    const util = new CollaboratorCursorOverlayUtil(editor)
    const { ctx, calls } = fakeCtx()
    util.render(ctx)
    expect(calls).toContain("fillText:Ada")
  })

  it("lets a subclass delegate the rest to the inherited painter", () => {
    const editor = makeEditor([person("instance_presence:a", "Ada"), person("instance_presence:b", "Bo", 50)])
    const mine: string[] = []
    class Mine extends CollaboratorCursorOverlayUtil {
      override render(ctx: CanvasRenderingContext2D, given?: TLCollaboratorCursorOverlay[]) {
        const overlays = given ?? this.getOverlays()
        const [first, ...rest] = overlays
        if (first) mine.push(first.userName)
        super.render(ctx, rest)
      }
    }
    const { ctx, calls } = fakeCtx()
    const util = new Mine(editor)
    util.render(ctx, util.getOverlays())
    expect(mine).toEqual(["Ada"])
    expect(calls.filter((c) => c.startsWith("fillText:"))).toEqual(["fillText:Bo"])
  })
})

describe("the label measurements a subclass would otherwise hard-code", () => {
  it("are on the options, with the documented defaults", () => {
    expect(DEFAULT_COLLABORATOR_OVERLAY_OPTIONS).toEqual({
      idleOpacity: 0.5,
      fontSize: 12,
      nameMaxWidth: 120,
      chatMaxWidth: 200,
    })
  })

  it("cuts a name that would otherwise draw a chip across the board", () => {
    const editor = makeEditor([person("instance_presence:a", "A".repeat(200))])
    const util = new CollaboratorCursorOverlayUtil(editor)
    const { ctx, calls } = fakeCtx()
    util.render(ctx)
    const drawn = calls.find((c) => c.startsWith("fillText:"))!.slice("fillText:".length)
    expect(drawn.endsWith("…")).toBe(true)
    // 120 wide, 6px padding each side, 7px per character in the fake metrics.
    expect(drawn.length).toBeLessThan(200)
  })

  it("are what `configure` replaces, so a restyled subclass is still a constructor", () => {
    const Wide = CollaboratorCursorOverlayUtil.configure({ nameMaxWidth: 600 })
    const opts = (Wide as unknown as { options: CollaboratorOverlayUtilOptions }).options
    expect(opts.nameMaxWidth).toBe(600)
    expect(opts.idleOpacity, "omitted keys keep their value").toBe(0.5)
    const editor = makeEditor([person("instance_presence:a", "Ada")])
    expect(() => new Wide(editor).render(fakeCtx().ctx)).not.toThrow()
  })

  it("leaves the original class untouched", () => {
    CollaboratorCursorOverlayUtil.configure({ nameMaxWidth: 999 })
    expect(CollaboratorCursorOverlayUtil.options.nameMaxWidth).toBe(120)
  })
})

describe("zIndex", () => {
  it("is a static a subclass overrides, not an option", () => {
    class Above extends CollaboratorCursorOverlayUtil {
      static override zIndex = 1100
    }
    expect(Above.zIndex).toBe(1100)
    expect(CollaboratorCursorOverlayUtil.zIndex).toBe(60)
    expect(vi.isMockFunction(Above)).toBe(false)
  })
})
