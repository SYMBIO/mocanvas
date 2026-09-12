// @vitest-environment jsdom
import { atom } from "@mocanvas/state"
import { EditorProvider, type Editor } from "@mocanvas/editor"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { DefaultA11yAnnouncer, TldrawUiA11yProvider, useSelectedShapesAnnouncer } from "./ui-a11y"

/**
 * What the screen reader actually hears.
 *
 * "Enhanced accessibility" used to be a checkbox over a module-level boolean
 * that nothing read, so the only test worth writing for it is this one: flip
 * the preference and assert the announcement changes. A test that the box
 * ticks would have passed against the dead version.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeEditor() {
  const prefs = atom<Record<string, unknown>>("test.prefs", { id: "user:test" })
  const selected = atom<{ id: string; type: string; props?: Record<string, unknown> }[]>("test.selected", [])

  const editor = {
    getSelectedShapes: () => selected.get(),
    getShapePageBounds: () => ({ x: 12.4, y: 33.6, w: 100.2, h: 49.8 }),
    getSelectionPageBounds: () => ({ x: 0, y: 0, w: 220.4, h: 80.7 }),
    user: {
      getIsEnhancedA11yMode: () => (prefs.get()["isEnhancedA11yMode"] as boolean) ?? false,
      updateUserPreferences: (patch: Record<string, unknown>) => prefs.set({ ...prefs.get(), ...patch }),
    },
  } as unknown as Editor

  return { editor, prefs, selected }
}

function Harness() {
  useSelectedShapesAnnouncer()
  return <DefaultA11yAnnouncer />
}

let root: Root | null = null
let host: HTMLElement | null = null

function render(parts: ReturnType<typeof makeEditor>) {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <EditorProvider editor={parts.editor}>
        <TldrawUiA11yProvider>
          <Harness />
        </TldrawUiA11yProvider>
      </EditorProvider>,
    )
  })
  return parts
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
})

/** The polite live region's text, with the anti-dedupe suffix stripped. */
function announced(): string {
  const region = document.querySelector('[role="status"]')!
  return (region.textContent ?? "").replace(/​/g, "").trim()
}

describe("the selection announcer", () => {
  it("names the selection and nothing else by default", () => {
    const parts = render(makeEditor())
    act(() => {
      parts.selected.set([{ id: "shape:a", type: "rectangle" }])
    })
    expect(announced()).toBe("rectangle selected")
  })

  it("says what kind a geo shape is, not that it is a geo shape", () => {
    // Every rectangle, ellipse and star has type "geo". Reading that out is
    // the editor's internal vocabulary, not a description of what is selected.
    const parts = render(makeEditor())
    act(() => {
      parts.selected.set([{ id: "shape:a", type: "geo", props: { geo: "ellipse" } }])
    })
    expect(announced()).toBe("ellipse selected")
  })

  it("reads back position and size once enhanced accessibility is on", () => {
    const parts = render(makeEditor())
    act(() => {
      parts.editor.user.updateUserPreferences({ isEnhancedA11yMode: true })
      parts.selected.set([{ id: "shape:a", type: "rectangle" }])
    })
    // Rounded: sub-pixel precision read aloud is noise, not information.
    expect(announced()).toBe("rectangle selected, at 12, 34, 100 by 50")
  })

  it("gives a multi-shape selection its overall size when enhanced", () => {
    const parts = render(makeEditor())
    act(() => {
      parts.selected.set([
        { id: "shape:a", type: "rectangle" },
        { id: "shape:b", type: "ellipse" },
      ])
    })
    expect(announced()).toBe("2 shapes selected")
    act(() => {
      parts.editor.user.updateUserPreferences({ isEnhancedA11yMode: true })
    })
    expect(announced()).toBe("2 shapes selected, 220 by 81")
  })

  it("says nothing when the selection is emptied", () => {
    const parts = render(makeEditor())
    act(() => {
      parts.selected.set([{ id: "shape:a", type: "rectangle" }])
    })
    expect(announced()).toBe("rectangle selected")
    act(() => {
      parts.selected.set([])
    })
    // The last announcement stands rather than being cleared to silence —
    // re-announcing "nothing selected" on every deselect is chatter.
    expect(announced()).toBe("rectangle selected")
  })
})
