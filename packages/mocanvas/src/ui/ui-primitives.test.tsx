import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TldrawUiButton, TldrawUiButtonCheck, TldrawUiButtonIcon, TldrawUiButtonLabel } from "./ui-button"
import { TldrawUiIcon } from "./ui-icon"
import { kbdToKeys, TldrawUiKbd } from "./ui-kbd"
import { TldrawUiColumn, TldrawUiGrid, TldrawUiRow } from "./ui-layout"
import { TldrawUiSlider } from "./ui-slider"
import { TldrawUiToolbar, TldrawUiToolbarToggleGroup, TldrawUiToolbarToggleItem } from "./ui-toolbar"
import { getBreakpointForWidth, PORTRAIT_BREAKPOINT } from "./ui-breakpoint"
import { containBoxSize } from "./asset-toolbars"
import { truncateStringWithEllipsis, unwrapLabel } from "./ui-hooks"

/**
 * The primitives are pure enough to render to a string, so these assert the
 * two things that are easy to get wrong and invisible when they are: the ARIA
 * a control carries, and the shortcut formatting.
 */

describe("TldrawUiButton", () => {
  it("is never a submit button", () => {
    const html = renderToStaticMarkup(<TldrawUiButton title="Go">Go</TldrawUiButton>)
    expect(html).toContain('type="button"')
  })

  it("carries aria-pressed only when it is a two-state button", () => {
    expect(renderToStaticMarkup(<TldrawUiButton title="A">A</TldrawUiButton>)).not.toContain("aria-pressed")
    expect(renderToStaticMarkup(<TldrawUiButton title="A" isChecked={false} />)).toContain('aria-pressed="false"')
  })

  it("labels itself from its title so an icon-only button is announced", () => {
    const html = renderToStaticMarkup(
      <TldrawUiButton title="Duplicate">
        <TldrawUiButtonIcon icon="duplicate" />
      </TldrawUiButton>,
    )
    expect(html).toContain('aria-label="Duplicate"')
  })

  it("renders the label slot as text", () => {
    expect(renderToStaticMarkup(<TldrawUiButtonLabel>Undo</TldrawUiButtonLabel>)).toContain("Undo")
  })

  it("keeps the check mark in the layout when unchecked, so rows do not shift", () => {
    const html = renderToStaticMarkup(<TldrawUiButtonCheck checked={false} />)
    expect(html).toContain("visibility:hidden")
    expect(html).toContain('aria-hidden="true"')
  })
})

describe("TldrawUiIcon", () => {
  it("draws a known icon from the set", () => {
    expect(renderToStaticMarkup(<TldrawUiIcon icon="undo" />)).toContain("<svg")
  })

  it("falls back to an initial for an icon the set does not have", () => {
    const html = renderToStaticMarkup(<TldrawUiIcon icon="not-a-real-icon" label="Comment" />)
    expect(html).toContain("C")
    expect(html).toContain('aria-label="Comment"')
  })

  it("treats a name with a slash or a dot as a URL", () => {
    expect(renderToStaticMarkup(<TldrawUiIcon icon="/icons/star.svg" />)).toContain("<img")
  })

  it("is hidden from assistive technology unless it was labelled", () => {
    expect(renderToStaticMarkup(<TldrawUiIcon icon="undo" />)).toContain('aria-hidden="true"')
    expect(renderToStaticMarkup(<TldrawUiIcon icon="undo" label="Undo" />)).toContain('role="img"')
  })
})

describe("TldrawUiKbd", () => {
  it("uses Apple glyphs on Apple platforms and words elsewhere", () => {
    expect(kbdToKeys("mod+shift+z", true)).toEqual(["⌘", "⇧", "Z"])
    expect(kbdToKeys("mod+shift+z", false)).toEqual(["Ctrl", "Shift", "Z"])
  })

  it("shows only the first of several alternatives", () => {
    expect(kbdToKeys("d,p,b", false)).toEqual(["D"])
  })

  it("renders nothing for an empty shortcut", () => {
    expect(renderToStaticMarkup(<TldrawUiKbd>{""}</TldrawUiKbd>)).toBe("")
  })

  it("is hidden from assistive technology", () => {
    expect(renderToStaticMarkup(<TldrawUiKbd>mod+z</TldrawUiKbd>)).toContain('aria-hidden="true"')
  })
})

describe("TldrawUiSlider", () => {
  it("announces a mixed selection rather than pretending it has a value", () => {
    const html = renderToStaticMarkup(<TldrawUiSlider value={null} steps={4} label="Opacity" onValueChange={() => {}} />)
    expect(html).toContain('aria-valuetext="Mixed"')
    expect(html).toContain('type="range"')
  })
})

describe("layout primitives", () => {
  it("lay out along their own axis", () => {
    expect(renderToStaticMarkup(<TldrawUiRow>a</TldrawUiRow>)).toContain("flex-direction:row")
    expect(renderToStaticMarkup(<TldrawUiColumn>a</TldrawUiColumn>)).toContain("flex-direction:column")
    expect(renderToStaticMarkup(<TldrawUiGrid columns={3}>a</TldrawUiGrid>)).toContain("repeat(3, minmax(0, 1fr))")
  })
})

describe("TldrawUiToolbar", () => {
  it("is one toolbar with an accessible name and an orientation", () => {
    const html = renderToStaticMarkup(<TldrawUiToolbar label="Tools">x</TldrawUiToolbar>)
    expect(html).toContain('role="toolbar"')
    expect(html).toContain('aria-label="Tools"')
    expect(html).toContain('aria-orientation="horizontal"')
  })

  it("makes a single-select group a radiogroup, and only the checked item a tab stop", () => {
    const html = renderToStaticMarkup(
      <TldrawUiToolbarToggleGroup label="Fill" type="single" value="solid" onValueChange={() => {}}>
        <TldrawUiToolbarToggleItem value="none" title="None" />
        <TldrawUiToolbarToggleItem value="solid" title="Solid" />
      </TldrawUiToolbarToggleGroup>,
    )
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('role="radio"')
    // The unchecked item is removed from the tab order; the checked one is not.
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('tabindex="0"')
  })

  it("makes a multi-select group a plain group of checkboxes", () => {
    const html = renderToStaticMarkup(
      <TldrawUiToolbarToggleGroup label="Marks" type="multiple" values={["bold"]}>
        <TldrawUiToolbarToggleItem value="bold" title="Bold" />
        <TldrawUiToolbarToggleItem value="italic" title="Italic" />
      </TldrawUiToolbarToggleGroup>,
    )
    expect(html).toContain('role="checkbox"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('aria-checked="false"')
  })
})

describe("breakpoints", () => {
  it("widen monotonically", () => {
    expect(getBreakpointForWidth(0)).toBe(PORTRAIT_BREAKPOINT.ZERO)
    expect(getBreakpointForWidth(400)).toBe(PORTRAIT_BREAKPOINT.MOBILE_XXS)
    expect(getBreakpointForWidth(2000)).toBe(PORTRAIT_BREAKPOINT.DESKTOP)
    let previous = -1
    for (let width = 0; width < 2000; width += 10) {
      const value = getBreakpointForWidth(width)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe("containBoxSize", () => {
  it("leaves a box that already fits alone", () => {
    expect(containBoxSize({ w: 10, h: 10 }, { w: 100, h: 100 })).toEqual({ w: 10, h: 10 })
  })

  it("scales without changing the aspect ratio", () => {
    const result = containBoxSize({ w: 4000, h: 2000 }, { w: 1000, h: 1000 })
    expect(result).toEqual({ w: 1000, h: 500 })
  })
})

describe("label helpers", () => {
  it("truncates on a grapheme boundary", () => {
    expect(truncateStringWithEllipsis("abcdef", 4)).toBe("abc…")
    expect(truncateStringWithEllipsis("abc", 10)).toBe("abc")
    // A surrogate pair must not be cut in half.
    expect(truncateStringWithEllipsis("👍👍👍👍", 3)).toBe("👍👍…")
  })

  it("unwraps a rich-text-ish label to its text", () => {
    expect(unwrapLabel("Hello")).toBe("Hello")
    expect(unwrapLabel({ text: "Hello" })).toBe("Hello")
  })
})
