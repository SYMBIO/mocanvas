/**
 * Turning what an app hands in into the themes an editor runs on, and teaching
 * the colour style prop which names those themes define.
 */
import { DefaultColorStyle, DefaultLabelColorStyle, type EnumStyleProp } from "../records/styleProp"
import { getPaletteEntries } from "./colors"
import { DEFAULT_THEME } from "./DEFAULT_THEME"
import type { TLTheme, TLThemeColors, TLThemeId, TLThemePatch, TLThemes, TLThemesInput } from "./types"

/**
 * The themes an editor will run with: the built-in `default` plus whatever the
 * app registered, with an app's `default` *replacing* the built-in one.
 *
 * SEMANTICS-ASSUMED: a theme whose `id` disagrees with its key is re-stamped
 * rather than rejected.
 *
 * Each theme's `id` is set from the key it is registered under, so
 * `getThemes()[id].id === id` always holds and a theme copied from another id
 * cannot lie about which one it is.
 */
export function resolveThemes(themes?: TLThemesInput): TLThemes {
  const out: TLThemes = { default: DEFAULT_THEME }
  for (const [id, theme] of Object.entries(themes ?? {})) {
    if (!theme) continue
    out[id] = theme.id === id ? theme : { ...theme, id }
  }
  return out
}

/**
 * The colour names a set of themes defines, as the union of every ramp's
 * palette keys, in the order they were first seen.
 */
export function getColorNamesFromThemes(themes: TLThemes): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const theme of Object.values(themes)) {
    for (const ramp of [theme.colors.light, theme.colors.dark]) {
      for (const [name] of getPaletteEntries(ramp)) {
        if (seen.has(name)) continue
        seen.add(name)
        names.push(name)
      }
    }
  }
  return names
}

/**
 * Point the colour style props at the names the live themes actually define.
 *
 * This is what lets an app ship a palette of its own: register a theme whose
 * ramps carry extra names and `color: "brand-teal"` starts validating. It cuts
 * both ways, which is the part worth being careful about — a name **no**
 * registered ramp defines is *removed*, so a shape persisted with it no longer
 * validates and the board it lives on will not load. A custom theme should
 * therefore define every built-in name and change only their values; curate
 * which names the UI *offers* in the UI, never by dropping them here.
 *
 * The style props are module singletons, so this mutates their value list in
 * place: the validator closes over that same array, and replacing the property
 * would leave validation behind.
 *
 * One caveat that belongs to `records/styleProp.ts` rather than to the theme
 * system: `DefaultColorStyle`, `DefaultLabelColorStyle` and the exported
 * `DEFAULT_COLORS` tuple are all the *same array* today, so registering a
 * palette that adds or drops a name is visible through `DEFAULT_COLORS` too.
 * Copying the list in the `EnumStyleProp` constructor would end that.
 */
export function registerColorsFromThemes(themes: TLThemes): void {
  const names = getColorNamesFromThemes(themes)
  if (names.length === 0) return
  for (const prop of [DefaultColorStyle, DefaultLabelColorStyle]) {
    setStylePropValues(prop as unknown as EnumStyleProp<string>, names)
  }
}

/** Replace the contents of a style prop's value list without swapping the array. */
function setStylePropValues(prop: EnumStyleProp<string>, names: readonly string[]): void {
  const values = prop.values as string[]
  if (values.length === names.length && names.every((n, i) => values[i] === n)) return
  values.length = 0
  values.push(...names)
}

/**
 * Apply a patch to a theme, merging `colors` one ramp at a time.
 *
 * A ramp nobody patched is passed through by identity, so patching light
 * cannot invalidate anything memoised against dark.
 */
export function applyThemePatch(theme: TLTheme, patch: TLThemePatch, id: TLThemeId = theme.id): TLTheme {
  const colors = patch.colors
    ? {
        light: mergeRamp(theme.colors.light, patch.colors.light),
        dark: mergeRamp(theme.colors.dark, patch.colors.dark),
      }
    : theme.colors
  return { ...theme, ...patch, colors, id }
}

/**
 * A theme built on top of the built-in one — the way an app feeds its own
 * design tokens to the canvas:
 *
 * ```ts
 * const brand = createTheme("default", {
 *   colors: { light: { blue: { ...DEFAULT_THEME.colors.light.blue, solid: tokens.brandBlue } } },
 * })
 * ```
 *
 * Starting from `DEFAULT_THEME` rather than from nothing is what keeps every
 * colour name defined — see {@link registerColorsFromThemes} for why dropping
 * one is a data-loss bug rather than a missing swatch.
 */
export function createTheme(id: TLThemeId, patch: TLThemePatch = {}): TLTheme {
  return applyThemePatch(DEFAULT_THEME, patch, id)
}

/**
 * One ramp with a patch spread over it, or the ramp itself when there is no
 * patch — identity matters, so a light-only patch cannot invalidate anything
 * memoised against dark.
 *
 * The cast is the price of spreading a `Partial`: TypeScript widens the
 * result's index signature with `undefined`, which the spread cannot actually
 * produce for a key the patch does not carry.
 */
function mergeRamp(ramp: TLThemeColors, patch: Partial<TLThemeColors> | undefined): TLThemeColors {
  return patch ? ({ ...ramp, ...patch } as TLThemeColors) : ramp
}
