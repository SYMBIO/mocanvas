import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CANVAS_THEME_VARS } from "@mocanvas/editor"

/**
 * The stylesheet half of the compat layer.
 *
 * `@mocanvas/compat` aliased the symbols an app imports and not the custom
 * properties its stylesheets read — a gap nothing catches, because TypeScript
 * sees no CSS, the build succeeds and the tests pass. The regression a consumer
 * actually hit was a white cursor outline that stopped being drawn, found by
 * eye, because `--tl-color-selected-contrast` resolved to nothing.
 */

const css = readFileSync(fileURLToPath(new URL("../compat.css", import.meta.url)), "utf8")
const declarations = [...css.matchAll(/^\s*(--tl-[a-z0-9-]+):\s*([^;]+);/gm)].map(([, name, value]) => ({
  name: name!,
  value: value!.trim(),
}))

describe("compat.css", () => {
  it("defines the tokens whose absence was found by eye", () => {
    const names = declarations.map((d) => d.name)
    expect(names).toContain("--tl-color-selected-contrast")
    expect(names).toContain("--tl-zoom")
    expect(names).toContain("--tl-scale")
  })

  it("gives every mapping a literal fallback", () => {
    // A var() that resolves to nothing invalidates the whole declaration, and
    // inside calc() it takes the entire property with it. One missing token
    // must not be able to delete the rule it appears in.
    const unsafe = declarations.filter((d) => d.value.startsWith("var(") && !d.value.includes(","))
    expect(unsafe.map((d) => d.name), "these resolve to nothing when their source is unset").toEqual([])
  })

  it("only points at mocanvas variables that actually exist", () => {
    // A mapping onto a variable nothing stamps is the same bug in a new place:
    // it silently falls through to the fallback and never tracks the theme.
    const known = new Set<string>(Object.keys(CANVAS_THEME_VARS))
    // Stamped by the camera, and by `ui.css` for the chrome.
    known.add("--mocanvas-zoom")
    known.add("--mocanvas-scale")
    const uiCss = readFileSync(fileURLToPath(new URL("../../mocanvas/src/ui/ui.css", import.meta.url)), "utf8")
    for (const m of uiCss.matchAll(/(--mocanvas-[a-z0-9-]+)\s*:/g)) known.add(m[1]!)

    const referenced = new Set<string>()
    for (const d of declarations) for (const m of d.value.matchAll(/var\((--mocanvas-[a-z0-9-]+)/g)) referenced.add(m[1]!)
    const dangling = [...referenced].filter((v) => !known.has(v))
    expect(dangling, "compat.css points at variables nothing defines").toEqual([])
  })

  it("does not claim a theme variable the ramp never emits", () => {
    // `TLThemeColors` has an index signature for an app's own palette entries,
    // so mapping a name the ramp does not carry type-checks and then emits
    // nothing — the token silently falls through to its literal fallback and
    // stops following the theme, which is the bug this file exists for.
    const emitted = new Set<string>(Object.keys(CANVAS_THEME_VARS))
    const themed = declarations
      .flatMap((d) => [...d.value.matchAll(/var\((--mocanvas-[a-z0-9-]+)/g)].map((m) => m[1]!))
      .filter((v) => v.startsWith("--mocanvas-") && !v.startsWith("--mocanvas-ui-") && v !== "--mocanvas-zoom" && v !== "--mocanvas-scale")
    const notEmitted = [...new Set(themed)].filter((v) => !emitted.has(v))
    expect(notEmitted, "these look themed but resolve to their fallback forever").toEqual([])
  })

  it("is scoped, so a page still running a real tldraw editor keeps its own values", () => {
    expect(css).not.toMatch(/^\s*:root\s*\{/m)
    expect(css).toMatch(/\.mocanvas/)
  })

  it("is listed in `files` and exported under a stable subpath", async () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"))
    expect(pkg.files).toContain("compat.css")
    expect(pkg.exports["./compat.css"]).toBeDefined()
    expect(pkg.publishConfig.exports["./compat.css"]).toBeDefined()
    // `sideEffects: false` lets a bundler drop a bare CSS import entirely.
    expect(pkg.sideEffects).not.toBe(false)
  })
})
