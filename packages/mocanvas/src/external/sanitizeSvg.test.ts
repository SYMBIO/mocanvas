// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { sanitizeSvg } from "./sanitizeSvg"

const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`

describe("sanitizeSvg", () => {
  it("refuses anything that is not an svg document", () => {
    expect(sanitizeSvg("<html><body>hi</body></html>")).toBeNull()
    expect(sanitizeSvg("not markup at all")).toBeNull()
  })

  it("keeps ordinary drawing elements", () => {
    const out = sanitizeSvg(wrap('<path d="M0 0L10 10"/><rect x="1" y="1" width="2" height="2"/>'))
    expect(out).toContain("<path")
    expect(out).toContain("<rect")
  })

  it("strips script elements", () => {
    const out = sanitizeSvg(wrap('<script>alert(1)</script><path d="M0 0"/>'))
    expect(out).not.toContain("script")
    expect(out).toContain("<path")
  })

  it("strips every on* handler", () => {
    const out = sanitizeSvg(wrap('<path d="M0 0" onload="x()" onclick="y()" onmouseover="z()"/>'))
    expect(out).not.toContain("onload")
    expect(out).not.toContain("onclick")
    expect(out).not.toContain("onmouseover")
  })

  it("keeps only safe link schemes", () => {
    expect(sanitizeSvg(wrap('<a href="https://example.com"><path d="M0 0"/></a>'))).toContain("https://example.com")
    const unsafe = sanitizeSvg(wrap('<a href="javascript:alert(1)"><path d="M0 0"/></a>'))
    expect(unsafe).not.toContain("javascript:")
  })

  it("allows only data: hrefs on image", () => {
    expect(sanitizeSvg(wrap('<image href="data:image/png;base64,AAA"/>'))).toContain("data:image/png")
    expect(sanitizeSvg(wrap('<image href="https://tracker.test/pixel.png"/>'))).not.toContain("tracker.test")
  })

  it("allows only fragment hrefs on use", () => {
    expect(sanitizeSvg(wrap('<use href="#thing"/>'))).toContain("#thing")
    expect(sanitizeSvg(wrap('<use href="https://evil.test/x.svg#a"/>'))).not.toContain("evil.test")
  })

  it("removes @import and external url() from a style element", () => {
    const out = sanitizeSvg(wrap('<style>@import url("https://evil.test/x.css"); .a { fill: url("https://evil.test/y") }</style>'))
    expect(out).not.toContain("@import")
    expect(out).not.toContain("evil.test")
  })

  it("keeps a data: font url in a style element", () => {
    const out = sanitizeSvg(wrap("<style>@font-face { src: url(data:font/woff2;base64,AAA) }</style>"))
    expect(out).toContain("data:font/woff2")
  })

  it("keeps foreignObject content under an html allowlist", () => {
    const out = sanitizeSvg(wrap("<foreignObject><div><span>hi</span><iframe src=\"https://evil.test\"></iframe></div></foreignObject>"))
    expect(out).toContain("hi")
    expect(out).not.toContain("iframe")
  })

  it("drops comments and processing instructions", () => {
    const out = sanitizeSvg(wrap('<!-- a comment --><path d="M0 0"/>'))
    expect(out).not.toContain("a comment")
  })
})
