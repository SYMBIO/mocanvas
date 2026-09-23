// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { assertCompatStylesLoaded } from "./index"

/**
 * The guard that would have caught the import nobody noticed was missing.
 *
 * A consumer had `@mocanvas/compat` but not its stylesheet, so every `--tl-*`
 * was empty, every `calc()` over one collapsed, and headings came out at a
 * constant tiny size. Nothing threw, which is why it took a screenshot
 * comparison against their old build to find it.
 */
describe("assertCompatStylesLoaded", () => {
  it("reports the stylesheet as missing when nothing declares --tl-zoom", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(assertCompatStylesLoaded()).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toMatch(/compat\.css/)
    warn.mockRestore()
  })

  it("reports it as present once a rule declares it, and stays quiet", () => {
    const style = document.createElement("style")
    style.textContent = ".mocanvas { --tl-zoom: 1; }"
    document.head.appendChild(style)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(assertCompatStylesLoaded()).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    style.remove()
  })

  it("leaves nothing behind in the document", () => {
    const before = document.body.childElementCount
    assertCompatStylesLoaded()
    expect(document.body.childElementCount).toBe(before)
  })
})
