import { describe, expect, it } from "vitest"
import { DEFAULT_THEME } from "../theme/DEFAULT_THEME"
import type { TLColorMode, TLTheme } from "../theme/types"
import { OverlayUtil, type OverlayHost } from "./OverlayUtil"
import { getOverlayDisplayValues, type OverlayOptionsWithDisplayValues } from "./overlayDisplayValues"

interface Paint {
  stroke: string
  lineWidth: number
}

const host: OverlayHost = { getZoomLevel: () => 1 }

/** An editor-shaped stub: the theme hangs off `editor.theme`, as it really does. */
function editorWithTheme(theme: TLTheme, colorMode: TLColorMode = "light"): OverlayHost {
  return { ...host, theme: { getCurrentTheme: () => theme, getColorMode: () => colorMode } } as OverlayHost
}

const defaults: OverlayOptionsWithDisplayValues<Paint> = {
  getDefaultDisplayValues: (_editor, theme, colorMode) => ({
    stroke: theme.colors[colorMode].selectStroke,
    lineWidth: 1.5,
  }),
}

describe("getOverlayDisplayValues", () => {
  it("resolves an overlay's paint against the live theme", () => {
    const values = getOverlayDisplayValues<Paint>({ editor: editorWithTheme(DEFAULT_THEME), options: defaults })
    expect(values).toEqual({ stroke: DEFAULT_THEME.colors.light.selectStroke, lineWidth: 1.5 })
  })

  it("follows the colour mode rather than assuming light", () => {
    const values = getOverlayDisplayValues<Paint>({
      editor: editorWithTheme(DEFAULT_THEME, "dark"),
      options: defaults,
    })
    expect(values.stroke).toBe(DEFAULT_THEME.colors.dark.selectStroke)
  })

  it("accepts a bare theme host, so an overlay is testable without an editor", () => {
    const bare = { getCurrentTheme: () => DEFAULT_THEME, getColorMode: () => "dark" as const }
    expect(getOverlayDisplayValues<Paint>({ editor: bare, options: defaults }).stroke).toBe(
      DEFAULT_THEME.colors.dark.selectStroke,
    )
  })

  it("merges an override over the defaults, field by field", () => {
    const values = getOverlayDisplayValues<Paint>({
      editor: editorWithTheme(DEFAULT_THEME),
      options: defaults,
      getCustomDisplayValues: () => ({ stroke: "#ff00ff" }),
    })
    expect(values).toEqual({ stroke: "#ff00ff", lineWidth: 1.5 })
  })

  it("ignores an override that answers nothing", () => {
    const values = getOverlayDisplayValues<Paint>({
      editor: editorWithTheme(DEFAULT_THEME),
      options: defaults,
      getCustomDisplayValues: () => undefined,
    })
    expect(values.stroke).toBe(DEFAULT_THEME.colors.light.selectStroke)
  })

  it("falls back to the default theme when the host has none", () => {
    const values = getOverlayDisplayValues<Paint>({ editor: {}, options: defaults })
    expect(values.stroke).toBe(DEFAULT_THEME.colors.light.selectStroke)
  })

  it("answers an empty object for an overlay with nothing theme-dependent to say", () => {
    expect(getOverlayDisplayValues({ editor: editorWithTheme(DEFAULT_THEME) })).toEqual({})
  })
})

// ── The base class ──────────────────────────────────────────────────────────

interface DemoOptions extends OverlayOptionsWithDisplayValues<Paint> {
  radius: number
  lineWidth: number
}

class DemoOverlayUtil extends OverlayUtil<OverlayHost, DemoOptions> {
  static override type = "demo"
  static override options: DemoOptions = { radius: 4, lineWidth: 1.5, ...defaults }
  readonly painted: string[] = []
  override render(_ctx: CanvasRenderingContext2D): void {
    this.painted.push(`${this.options.radius}/${this.options.lineWidth}`)
  }
}

describe("OverlayUtil", () => {
  it("reads its options off the class it was constructed from", () => {
    expect(new DemoOverlayUtil(host).options.radius).toBe(4)
    expect(new DemoOverlayUtil(host).type).toBe("demo")
  })

  it("configures onto a subclass, leaving the class it came from alone", () => {
    const Big = DemoOverlayUtil.configure({ radius: 10 })
    expect(new Big(host).options.radius).toBe(10)
    // Unspecified keys are inherited, not reset.
    expect(new Big(host).options.lineWidth).toBe(1.5)
    expect(DemoOverlayUtil.options.radius).toBe(4)
  })

  it("layers a second configure over the first rather than resetting it", () => {
    const Thick = DemoOverlayUtil.configure({ radius: 10 }).configure({ lineWidth: 3 })
    expect(new Thick(host).options).toMatchObject({ radius: 10, lineWidth: 3 })
  })

  it("keeps the type and the behaviour of the class it configured", () => {
    const Big = DemoOverlayUtil.configure({ radius: 10 })
    const util = new Big(host)
    expect(util).toBeInstanceOf(DemoOverlayUtil)
    expect(Big.type).toBe("demo")
    util.render(undefined as unknown as CanvasRenderingContext2D)
    expect(util.painted).toEqual(["10/1.5"])
  })

  it("leaves the optional interactive hooks undefined unless a util implements them", () => {
    const util = new DemoOverlayUtil(host)
    // The overlay manager tells "did not implement" from "answered nothing" by
    // exactly this, so a base class that supplied no-ops would change its
    // behaviour for every util that never opted in.
    expect(util.isActive).toBeUndefined()
    expect(util.getOverlays).toBeUndefined()
    expect(util.getGeometry).toBeUndefined()
    expect(util.dispose).toBeUndefined()
  })

  it("resolves display values through the shared accessor", () => {
    class Themed extends DemoOverlayUtil {
      static override options: DemoOptions = { radius: 4, lineWidth: 1.5, ...defaults }
    }
    const util = new Themed(editorWithTheme(DEFAULT_THEME))
    expect(getOverlayDisplayValues<Paint>(util).stroke).toBe(DEFAULT_THEME.colors.light.selectStroke)
  })
})
