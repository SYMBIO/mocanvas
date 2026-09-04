import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { GEO_SHAPE_KINDS } from "@mocanvas/editor"
import { GEO_BOX, getGeoIconBox, Icon, ICONS, ICON_NAMES, type IconName } from "./icons"
import { MORE_GEO_KINDS, PRIMARY_GEO_KINDS, TOOLBAR_GROUPS } from "./DefaultUi"
import { defaultTools } from "../tools"

describe("icon set", () => {
  it("renders every icon as a 24×24 svg", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(50)
    for (const name of ICON_NAMES) {
      const html = renderToStaticMarkup(<Icon name={name} />)
      expect(html, name).toContain("<svg")
      expect(html, name).toContain('viewBox="0 0 24 24"')
      expect(html, name).toContain('stroke="currentColor"')
    }
  })

  it("honours the size prop", () => {
    const html = renderToStaticMarkup(<Icon name="select" size={32} />)
    expect(html).toContain('width="32"')
    expect(html).toContain('height="32"')
    expect(html).toContain('viewBox="0 0 24 24"')
  })

  it("draws every geo kind from the canvas geometry", () => {
    for (const kind of GEO_SHAPE_KINDS) {
      const name = `geo-${kind}` as IconName
      expect(ICON_NAMES).toContain(name)
      const html = renderToStaticMarkup(<Icon name={name} />)
      expect(html, kind).toMatch(/<path d="M/)
    }
  })

  it("draws no two icons the same", () => {
    // A duplicate silhouette is a naming bug: "oval" drew the same circle as
    // "ellipse", and the handwriting font drew the same A as the sans one.
    const seen = new Map<string, IconName>()
    for (const name of ICON_NAMES) {
      const art = renderToStaticMarkup(<Icon name={name} />).replace(/^.*?>(?=<)/, "")
      const twin = seen.get(art)
      expect(twin, `${name} is drawn identically to ${twin}`).toBeUndefined()
      seen.set(art, name)
    }
  })

  it("fits every geo outline in a box no larger than the shared one", () => {
    for (const kind of GEO_SHAPE_KINDS) {
      const [w, h] = getGeoIconBox(kind)
      expect(Math.max(w, h), kind).toBe(GEO_BOX)
      expect(Math.min(w, h), kind).toBeGreaterThan(GEO_BOX / 2)
    }
  })

  it("gives the kinds whose name implies a proportion a non-square box", () => {
    for (const kind of ["rectangle", "oval"] as const) {
      const [w, h] = getGeoIconBox(kind)
      expect(w, kind).not.toBe(h)
    }
  })

  it("covers every tool, action and style icon the UI asks for", () => {
    const required = [
      "select", "hand", "draw", "eraser", "text", "note", "frame", "arrow", "line", "image",
      "zoom-in", "zoom-out", "zoom-fit", "undo", "redo", "lock", "unlock", "duplicate", "trash",
      "group", "ungroup", "bring-forward", "send-backward", "chevron-down", "check", "mixed",
      "fill-none", "fill-semi", "fill-solid", "fill-pattern",
      "dash-draw", "dash-solid", "dash-dashed", "dash-dotted",
      "size-s", "size-m", "size-l", "size-xl",
      "align-left", "align-center", "align-right",
      "valign-top", "valign-middle", "valign-bottom",
      "font-draw", "font-sans", "font-serif", "font-mono",
    ]
    for (const name of required) expect(ICON_NAMES).toContain(name)
  })
})

describe("toolbar config", () => {
  const items = TOOLBAR_GROUPS.flat()

  it("references only icons that exist", () => {
    for (const item of items) expect(Object.keys(ICONS), item.id).toContain(item.icon)
  })

  it("references only tool ids the default tools provide", () => {
    const registered = new Set(defaultTools.map((t) => t.id))
    for (const item of items) expect(registered, item.id).toContain(item.tool)
  })

  it("has unique entry ids", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
  })

  it("splits the geo kinds between the bar and the popover", () => {
    expect([...PRIMARY_GEO_KINDS, ...MORE_GEO_KINDS].sort()).toEqual([...GEO_SHAPE_KINDS].sort())
    expect(PRIMARY_GEO_KINDS.some((k) => MORE_GEO_KINDS.includes(k))).toBe(false)
  })
})
