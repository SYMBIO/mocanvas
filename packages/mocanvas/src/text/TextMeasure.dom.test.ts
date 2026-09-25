// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import { TextMeasure } from "./TextMeasure"

const opts = { fontFamily: "sans-serif", fontSize: 22, lineHeight: 1.35 }

function probe(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".mocanvas-text-measure-html")
  if (el === null) throw new Error("no html probe")
  return el
}

describe("measureHtml probe styles", () => {
  let tm: TextMeasure

  beforeEach(() => {
    document.body.innerHTML = ""
    tm = new TextMeasure()
  })

  it("puts back a probe rule that otherStyles overwrote", () => {
    tm.measureHtml("<p>a</p>", opts)
    expect(probe().style.overflowWrap).toBe("break-word")

    tm.measureHtml("<p>b</p>", { ...opts, otherStyles: { "overflow-wrap": "normal" } })
    expect(probe().style.overflowWrap).toBe("normal")

    // Without the restore this reads "" — the probe would wrap like a plain element from here on.
    tm.measureHtml("<p>c</p>", opts)
    expect(probe().style.overflowWrap).toBe("break-word")
  })

  it("restores the rule even when otherStyles set it to the probe's own value", () => {
    tm.measureHtml("<p>a</p>", { ...opts, otherStyles: { "overflow-wrap": "break-word" } })
    tm.measureHtml("<p>b</p>", opts)
    expect(probe().style.overflowWrap).toBe("break-word")
  })

  it("still clears a style the probe does not set itself", () => {
    tm.measureHtml("<p>a</p>", { ...opts, otherStyles: { "font-variant": "small-caps" } })
    expect(probe().style.fontVariant).toBe("small-caps")
    tm.measureHtml("<p>b</p>", opts)
    expect(probe().style.fontVariant).toBe("")
  })

  it("keeps the other probe rules across a call that overwrites one", () => {
    tm.measureHtml("<p>a</p>", { ...opts, otherStyles: { "white-space": "nowrap", "box-sizing": "content-box" } })
    tm.measureHtml("<p>b</p>", opts)
    const style = probe().style
    expect(style.whiteSpace).toBe("pre-wrap")
    expect(style.boxSizing).toBe("border-box")
    expect(style.wordBreak).toBe("normal")
  })
})
