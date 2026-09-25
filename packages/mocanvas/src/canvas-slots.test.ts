import { describe, expect, it } from "vitest"
import { pickCanvasSlots } from "./canvas-slots"

/**
 * tldraw takes the editor's layers and the panels in one `components` map.
 * mocanvas renders the two in different places, so the canvas's share has to be
 * picked out of that map — and until it was, `Background`, `Grid` and
 * `InFrontOfTheCanvas` passed there were dropped without a word.
 */
describe("pickCanvasSlots", () => {
  const Slot = () => null

  it("takes the canvas's slots out of the one map", () => {
    const picked = pickCanvasSlots({ InFrontOfTheCanvas: Slot, Grid: Slot, Background: Slot, Toolbar: Slot, StylePanel: Slot })
    expect(Object.keys(picked ?? {}).sort()).toEqual(["Background", "Grid", "InFrontOfTheCanvas"])
  })

  it("leaves the panels alone", () => {
    expect(pickCanvasSlots({ Toolbar: Slot, ContextMenu: Slot })).toBeUndefined()
    expect(pickCanvasSlots(undefined)).toBeUndefined()
    expect(pickCanvasSlots({})).toBeUndefined()
  })

  it("keeps a null, which removes a default, and ignores an unmentioned slot", () => {
    // `{ Grid: null }` means "draw no grid"; every other key of that literal is
    // `undefined`, which means nothing at all.
    const picked = pickCanvasSlots({ Grid: null, Background: undefined })
    expect(picked).toEqual({ Grid: null })
  })
})
