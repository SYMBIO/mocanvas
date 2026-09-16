import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DEFAULT_FILLS, DEFAULT_FILL_TOKENS, GEO_SHAPE_KINDS } from "@mocanvas/editor"
import { GEO_BOX, getGeoIconBox, hasIcon, Icon, ICONS, ICON_ALIASES, ICON_NAMES, resolveIconName, type IconName } from "./icons"
import { MORE_GEO_KINDS, PRIMARY_GEO_KINDS, TOOLBAR_GROUPS } from "./DefaultUi"
import { defaultTools } from "../tools"

/**
 * The fill swatches have to show what the fill styles paint.
 *
 * The style names and the colour token names overlap without lining up:
 * `semi` paints the paper, `solid` paints the hue's pale tint (the token
 * called `semi`), and only `fill` paints the hue at full strength.
 * `DEFAULT_FILL_TOKENS` says exactly that and warns that reading the token
 * whose name matches the style is the easy mistake. The picker made it — every
 * swatch was one step too strong — and the fifth style had no icon at all, so
 * it rendered as the word "Fill" in a row of drawings.
 */
describe("the fill swatches", () => {
  const EXPECTED: Record<string, string> = {
    none: "fill-none",
    semi: "fill-paper",
    solid: "fill-tint",
    pattern: "fill-pattern",
    fill: "fill-full",
  }

  /** The `{ style: "icon-name" }` literal a picker maps with. */
  function mapIn(file: string, name: string): Record<string, string> {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8")
    const literal = source.match(new RegExp(`const ${name}[^=]*=\\s*\\{([^}]*)\\}`))
    expect(literal, `${name} is no longer an object literal in ${file}`).not.toBeNull()
    return Object.fromEntries([...literal![1]!.matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!]))
  }

  it.each([
    ["./StylePanel.tsx", "FILL_ICON"],
    ["./style-pickers.tsx", "FILL_ICONS"],
  ])("in %s show what each style paints", (file, name) => {
    expect(mapIn(file, name)).toEqual(EXPECTED)
  })

  it("covers every fill style there is", () => {
    // The panel iterates the style's own values, so a style with no entry here
    // falls back to its name in words.
    for (const fill of DEFAULT_FILLS) {
      expect(EXPECTED[fill], `the ${fill} fill has no swatch`).toBeDefined()
      expect(hasIcon(EXPECTED[fill]!), `${EXPECTED[fill]} is not a drawn icon`).toBe(true)
    }
  })

  it("keeps the paper fill separate from the tinted one", () => {
    // The two the picker used to confuse: `semi` paints the surface, `solid`
    // paints a tint of the hue, and the swatches have to differ the same way.
    expect(DEFAULT_FILL_TOKENS.semi).toBe("paper")
    expect(DEFAULT_FILL_TOKENS.solid).toBe("semi")
    expect(EXPECTED.semi).not.toBe(EXPECTED.solid)
  })
})

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

  it("paints Phosphor artwork as fill, scaled onto our grid", () => {
    // Phosphor draws filled outlines on a 256 grid. Painted with the enclosing
    // svg's 1.75 stroke, or left unscaled, each one would fill the button with
    // a blob — so both overrides have to be on the group.
    const html = renderToStaticMarkup(<Icon name="select" />)
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('stroke="none"')
    expect(html).toContain(`scale(${24 / 256})`)
  })

  it("keeps every icon's ink inside the 24×24 box", () => {
    // Only the hand-drawn icons are checkable this way: their coordinates are
    // literal. A number outside [-1, 25] means artwork that will clip.
    for (const name of ICON_NAMES) {
      if (name in ICON_ALIASES) continue
      const html = renderToStaticMarkup(<Icon name={name} />)
      if (html.includes("scale(")) continue // Phosphor, drawn on its own grid
      for (const n of html.matchAll(/-?\d+\.?\d*/g)) {
        const v = Number(n[0])
        if (!Number.isFinite(v)) continue
        expect(Math.abs(v), `${name} has an out-of-box coordinate ${v}`).toBeLessThan(26)
      }
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
    // Aliases are exempt by definition — they exist to share one drawing.
    const seen = new Map<string, IconName>()
    for (const name of Object.keys(ICONS) as IconName[]) {
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
      "text-align-left", "text-align-center", "text-align-right",
      "valign-top", "valign-middle", "valign-bottom",
      "font-draw", "font-sans", "font-serif", "font-mono",
    ]
    for (const name of required) expect(ICON_NAMES).toContain(name)
  })

  it("draws objects and text with different alignment marks", () => {
    // These were one name for both jobs, so the "align objects" menu showed
    // three ragged lines of text. They must never converge again.
    for (const [object, text] of [
      ["align-left", "text-align-left"],
      ["align-right", "text-align-right"],
    ] as const) {
      const a = renderToStaticMarkup(<Icon name={object} />)
      const b = renderToStaticMarkup(<Icon name={text} />)
      expect(a, object).not.toEqual(b)
    }
  })

  it("resolves every alias onto artwork that exists", () => {
    for (const [alias, target] of Object.entries(ICON_ALIASES)) {
      expect(Object.keys(ICONS), alias).toContain(target)
      expect(resolveIconName(alias as IconName)).toBe(target)
      expect(hasIcon(alias)).toBe(true)
    }
  })

  it("leaves a name it does not have to the caller's fallback", () => {
    expect(hasIcon("no-such-icon")).toBe(false)
  })

  it("answers to the names a tldraw-shaped app asks for", () => {
    // The spellings molekula and other ported apps use. A miss here is a
    // fallback initial in their UI, not a crash, which is why it needs a test.
    const ported = [
      "tool-pointer", "tool-hand", "tool-pencil", "tool-eraser", "tool-laser", "tool-note",
      "size-small", "size-medium", "size-large", "size-extra-large",
      "horizontal-align-start", "horizontal-align-middle", "horizontal-align-end",
      "vertical-align-start", "vertical-align-middle", "vertical-align-end",
      "align-top", "align-bottom", "align-center-horizontal", "align-center-vertical",
      "distribute-horizontal", "distribute-vertical", "stack-horizontal", "stack-vertical",
      "stretch-horizontal", "stretch-vertical", "pack",
      "arrowhead-none", "arrowhead-arrow", "arrowhead-bar", "arrowhead-diamond",
      "arrowhead-dot", "arrowhead-square", "arrowhead-triangle", "arrowhead-triangle-inverted",
      "bold", "italic", "underline", "strike", "code", "heading", "list", "bulletList",
      "bring-to-front", "send-to-back", "menu", "dots-horizontal", "dots-vertical",
      "chevron-left", "check-circle", "cross-2", "cross-circle", "plus", "minus",
      "info-circle", "warning-triangle", "help-circle", "question-mark-circle",
      "external-link", "link", "clipboard-copy", "clipboard-copied", "download",
      "toggle-on", "toggle-off", "rotate-cw", "rotate-ccw", "reset-zoom",
      "spline-cubic", "spline-line", "arrow-arc", "arrow-elbow", "arrow-cycle",
    ]
    for (const name of ported) expect(hasIcon(name), name).toBe(true)
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
