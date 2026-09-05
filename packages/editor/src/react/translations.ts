import type { TLUiTranslations } from "./ui-types"

/**
 * Resolving a UI string id through an app's `TLUiOverrides.translations`.
 *
 * Kept apart from the React context so the lookup rule can be tested — and
 * reused by an app's own chrome — without rendering anything.
 */

/**
 * The locales to try, most specific first: the locale itself, its base
 * language, then English.
 *
 * SEMANTICS-ASSUMED: the base-language step is not pinned by any call site
 * (the consumer registers a single `en` map). It is included because the
 * alternative — `cs-CZ` silently missing every string a `cs` dictionary has —
 * is the failure an app would have to work around by hand.
 */
export function getLocaleChain(locale: string): string[] {
  const chain: string[] = []
  const add = (value: string) => {
    if (value.length > 0 && !chain.includes(value)) chain.push(value)
  }
  add(locale)
  const base = locale.split(/[-_]/)[0]
  if (base) add(base)
  add("en")
  return chain
}

/**
 * The display text for `id`, or `id` itself when no dictionary has it.
 *
 * Falling through to the id rather than to an empty string is deliberate: a
 * missing translation should show something a developer can grep for, and it
 * makes a localized literal (`msg("Comment")`) safe to use as a label without
 * registering anything at all.
 */
export function resolveUiMessage(translations: TLUiTranslations | undefined, locale: string, id: string): string {
  if (!translations) return id
  for (const candidate of getLocaleChain(locale)) {
    const message = translations[candidate]?.[id]
    if (typeof message === "string") return message
  }
  return id
}
