// @vitest-environment jsdom
import { atom } from "@mocanvas/state"
import { MocanvasUiProvider, type Editor, type TLCursorProps } from "@mocanvas/editor"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { CollaboratorCursors } from "../react"

/**
 * `TLEditorComponents.CollaboratorCursor` was declared on two component maps
 * and rendered by nothing, so an app that supplied its own cursor silently
 * kept seeing ours. These assert the slot is consulted — and that not
 * supplying one still draws the default arrow.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeEditor() {
  const people = atom<unknown[]>("test.people", [
    { id: "instance_presence:a", userName: "Ada", color: "#f00", cursor: { x: 10, y: 20, rotation: 0 }, selectedShapeIds: [] },
  ])
  return {
    getCollaboratorsOnCurrentPage: () => people.get(),
    pageToViewport: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    getShape: () => undefined,
    getShapePageBounds: () => null,
    people,
  } as unknown as Editor & { people: typeof people }
}

let root: Root | null = null
let host: HTMLElement | null = null

function render(editor: Editor, components?: Record<string, unknown>) {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <MocanvasUiProvider editor={editor} {...(components ? { components } : {})}>
        <CollaboratorCursors editor={editor} />
      </MocanvasUiProvider>,
    )
  })
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
})

describe("the CollaboratorCursor slot", () => {
  it("draws the default arrow when the app supplies none", () => {
    render(makeEditor())
    expect(host!.querySelector("svg.mocanvas-collaborators path")).not.toBeNull()
    expect(host!.querySelector(".mocanvas-collaborator-cursors")).toBeNull()
  })

  it("renders the app's own cursor instead, with the collaborator's details", () => {
    const seen: TLCursorProps[] = []
    function MyCursor(props: TLCursorProps) {
      seen.push(props)
      return <div data-testid="mine">{props.name}</div>
    }
    render(makeEditor(), { CollaboratorCursor: MyCursor })
    const mine = host!.querySelectorAll('[data-testid="mine"]')
    expect(mine).toHaveLength(1)
    expect(mine[0]!.textContent).toBe("Ada")
    expect(seen[0]).toMatchObject({ color: "#f00", name: "Ada", point: { x: 10, y: 20 } })
    // And ours is gone, rather than drawn underneath theirs.
    expect(host!.querySelector("svg.mocanvas-collaborators path")).toBeNull()
  })

  it("draws no cursor at all when the slot is set to null", () => {
    render(makeEditor(), { CollaboratorCursor: null })
    expect(host!.querySelector("svg.mocanvas-collaborators path")).toBeNull()
    expect(host!.querySelector('[data-testid="mine"]')).toBeNull()
  })

  it("skips a collaborator with no pointer", () => {
    const editor = makeEditor()
    ;(editor as unknown as { people: { set(v: unknown[]): void } }).people.set([
      { id: "instance_presence:b", userName: "Bo", color: "#00f", cursor: null, selectedShapeIds: [] },
    ])
    function MyCursor() {
      return <div data-testid="mine" />
    }
    render(editor, { CollaboratorCursor: MyCursor })
    expect(host!.querySelector('[data-testid="mine"]')).toBeNull()
  })
})
