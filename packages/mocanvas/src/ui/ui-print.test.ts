// @vitest-environment jsdom
import type { Editor } from "@mocanvas/editor"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Printing.
 *
 * The bug this covers is that "Print" used to call `window.print()` — and the
 * editor is a component on somebody's page, so that printed the page: the
 * navigation, the article around the canvas, and a canvas element no print
 * stylesheet can lay out. What the user asked for is the drawing, so the test
 * is that the drawing is what reaches the printer and that the host window is
 * never asked to print itself.
 */

const getSvgString = vi.fn()
vi.mock("../export", () => ({
  getSvgString: (...args: unknown[]) => getSvgString(...args),
  exportToBlob: vi.fn(),
  downloadBlob: vi.fn(),
  copyBlobToClipboard: vi.fn(),
}))

const { canPrint, printSelection } = await import("./ui-clipboard")

function makeEditor(shapes = 3) {
  const print = vi.fn()
  const editor = {
    getCurrentPageShapeIds: () => new Set(Array.from({ length: shapes }, (_, i) => `shape:${i}`)),
    getCurrentPage: () => ({ id: "page:a", name: "Drawing <1>" }),
    getInstanceState: () => ({ exportBackground: true }),
    getColorMode: () => "light",
    getContainerDocument: () => document,
    getContainerWindow: () => ({ print }),
    getSelectedShapeIds: () => [],
  } as unknown as Editor
  return { editor, print }
}

/**
 * Stand in for the two window methods jsdom does not implement, before the
 * frame's `load` reaches them. Returns the spy standing in for `print`.
 */
function stubFrameWindow(frame: HTMLIFrameElement) {
  const view = frame.contentWindow as unknown as { print: () => void; focus: () => void }
  const print = vi.fn()
  view.focus = () => {}
  view.print = print
  return print
}

afterEach(() => {
  for (const frame of Array.from(document.querySelectorAll("iframe"))) frame.remove()
  getSvgString.mockReset()
  vi.restoreAllMocks()
})

describe("printing", () => {
  it("prints the drawing rather than the page around it", () => {
    getSvgString.mockReturnValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', width: 100, height: 100 })
    const { editor, print } = makeEditor()

    expect(printSelection(editor)).toBe(true)

    const frame = document.querySelector("iframe")
    expect(frame, "printing rendered nothing to print").not.toBeNull()
    stubFrameWindow(frame!)
    expect(frame!.srcdoc).toContain("<svg")
    expect(frame!.srcdoc).toContain("<rect/>")
    // Nothing of the host page comes with it.
    expect(frame!.srcdoc).not.toContain("<body>" + document.body.innerHTML)
    // And the host window is never asked to print itself.
    expect(print).not.toHaveBeenCalled()
  })

  it("asks the frame it built to print, and takes it away afterwards", async () => {
    getSvgString.mockReturnValue({ svg: "<svg></svg>", width: 1, height: 1 })
    const { editor, print } = makeEditor()
    printSelection(editor)

    // The frame is appended synchronously; its `load` — and so the print — is
    // a tick later, which is the window in which to stand in for jsdom's
    // unimplemented `print`.
    const framePrint = stubFrameWindow(document.querySelector("iframe")!)

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(framePrint, "the print frame was built and never printed").toHaveBeenCalledTimes(1)
    expect(print, "the host page was printed instead of the drawing").not.toHaveBeenCalled()
  })

  it("escapes the page name it puts in the print document's title", () => {
    getSvgString.mockReturnValue({ svg: "<svg></svg>", width: 1, height: 1 })
    const { editor } = makeEditor()
    printSelection(editor)
    const frame = document.querySelector("iframe")!
    stubFrameWindow(frame)
    expect(frame.srcdoc).toContain("<title>Drawing &lt;1&gt;</title>")
  })

  it("hands the exporter the selection when there is one", () => {
    getSvgString.mockReturnValue({ svg: "<svg></svg>", width: 1, height: 1 })
    const { editor } = makeEditor()
    printSelection(editor, ["shape:1"] as never)
    stubFrameWindow(document.querySelector("iframe")!)
    expect(getSvgString).toHaveBeenCalledWith(editor, ["shape:1"], expect.objectContaining({ background: true }))
  })

  it("does nothing when there is nothing to draw", () => {
    getSvgString.mockReturnValue(undefined)
    const { editor, print } = makeEditor(0)
    expect(printSelection(editor)).toBe(false)
    expect(document.querySelector("iframe")).toBeNull()
    expect(print).not.toHaveBeenCalled()
  })

  it("says so, so the menu row can disable itself on an empty page", () => {
    expect(canPrint(makeEditor(0).editor)).toBe(false)
    expect(canPrint(makeEditor(2).editor)).toBe(true)
  })
})
