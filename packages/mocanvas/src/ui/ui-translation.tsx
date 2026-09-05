import { getLocaleChain, resolveUiMessage, useEditor, useValue, type TLUiTranslations } from "@mocanvas/editor"
import { createContext, useContext, useMemo, type ReactNode } from "react"

/**
 * UI strings, and the locale they are resolved in.
 *
 * mocanvas ships no dictionary of its own — its default chrome labels are
 * already display text — so this exists to give an app's chrome one lookup
 * that follows the editor's locale rather than two that disagree.
 */

/** One locale's dictionary: string id to display text. */
export interface TLUiTranslation {
  locale: string
  label: string
  dir: "ltr" | "rtl"
  messages: Readonly<Record<string, string>>
}

/**
 * A UI string id. Open (`string`) rather than a closed union: mocanvas has no
 * fixed key list, and an app registers its own ids freely.
 */
export type TLUiTranslationKey = string

/** A language mocanvas knows how to name and lay out. */
export interface TLLanguage {
  readonly locale: string
  readonly label: string
}

/**
 * The languages offered in the language menu.
 *
 * SEMANTICS-ASSUMED: mocanvas ships no message catalogues, so this is a list
 * of locale *tags* an app can offer, not a claim that strings exist for them.
 * Picking one sets `user.locale`, which is what an app's own dictionary is
 * then resolved against.
 */
export const LANGUAGES: readonly TLLanguage[] = [
  { locale: "ar", label: "العربية" },
  { locale: "cs", label: "Čeština" },
  { locale: "da", label: "Dansk" },
  { locale: "de", label: "Deutsch" },
  { locale: "en", label: "English" },
  { locale: "es", label: "Español" },
  { locale: "fa", label: "فارسی" },
  { locale: "fi", label: "Suomi" },
  { locale: "fr", label: "Français" },
  { locale: "he", label: "עברית" },
  { locale: "hi", label: "हिन्दी" },
  { locale: "hu", label: "Magyar" },
  { locale: "it", label: "Italiano" },
  { locale: "ja", label: "日本語" },
  { locale: "ko", label: "한국어" },
  { locale: "nl", label: "Nederlands" },
  { locale: "no", label: "Norsk" },
  { locale: "pl", label: "Polski" },
  { locale: "pt", label: "Português" },
  { locale: "ru", label: "Русский" },
  { locale: "sv", label: "Svenska" },
  { locale: "tr", label: "Türkçe" },
  { locale: "uk", label: "Українська" },
  { locale: "vi", label: "Tiếng Việt" },
  { locale: "zh", label: "中文" },
]

/** Base languages written right to left. */
export const RTL_LANGUAGES: readonly string[] = ["ar", "fa", "he", "ur"]

/**
 * The best match for a browser locale among {@link LANGUAGES}, falling back to
 * English. Takes the navigator's list so a browser configured with
 * `["cs-CZ", "en"]` gets Czech rather than the first exact match.
 */
export function getDefaultTranslationLocale(locales: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? []): string {
  for (const locale of locales) {
    for (const candidate of getLocaleChain(locale)) {
      if (LANGUAGES.some((l) => l.locale === candidate)) return candidate
    }
  }
  return "en"
}

/** Whether a locale is written right to left. */
export function isRtlLanguage(locale: string): boolean {
  return RTL_LANGUAGES.includes(locale.split(/[-_]/)[0] ?? locale)
}

const TranslationContext = createContext<TLUiTranslation | null>(null)

export interface TLUiTranslationProviderProps {
  /** Extra dictionaries, keyed by locale then by string id. */
  overrides?: TLUiTranslations
  children?: ReactNode
}

/**
 * Resolves the editor's current locale into a {@link TLUiTranslation} and
 * publishes it. Re-resolves when the user changes locale, so a language menu
 * takes effect without remounting the chrome.
 */
export function TldrawUiTranslationProvider({ overrides, children }: TLUiTranslationProviderProps) {
  const editor = useEditor()
  const locale = useValue("ui locale", () => editor.user.getLocale(), [editor])
  const value = useMemo<TLUiTranslation>(() => {
    const messages = overrides ? Object.assign({}, ...getLocaleChain(locale).reverse().map((l) => overrides[l] ?? {})) : {}
    return {
      locale,
      label: LANGUAGES.find((l) => l.locale === locale)?.label ?? locale,
      dir: isRtlLanguage(locale) ? "rtl" : "ltr",
      messages,
    }
  }, [locale, overrides])
  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>
}

/**
 * The resolved dictionary. Throws outside a provider — a component that needs
 * the locale as well as the strings has no sensible fallback for "no locale".
 */
export function useCurrentTranslation(): TLUiTranslation {
  const value = useContext(TranslationContext)
  if (!value) throw new Error("useCurrentTranslation: render inside <TldrawUiTranslationProvider>.")
  return value
}

/** The resolved dictionary, or `null` outside a provider. */
export function useMaybeCurrentTranslation(): TLUiTranslation | null {
  return useContext(TranslationContext)
}

/**
 * Look a string id up. An id with no entry passes through unchanged, so a
 * component may use a localized literal as its own label and still be safe to
 * render outside a provider.
 */
export function useTranslation(): (id: TLUiTranslationKey) => string {
  const translation = useMaybeCurrentTranslation()
  return useMemo(() => {
    if (!translation) return (id: string) => id
    const dict: TLUiTranslations = { [translation.locale]: translation.messages as Record<string, string> }
    return (id: string) => resolveUiMessage(dict, translation.locale, id)
  }, [translation])
}

/** Alias of {@link useTranslation}, spelled as the value it returns. */
export const useMsg = useTranslation

/** The writing direction of the current locale; `"ltr"` outside a provider. */
export function useDirection(): "ltr" | "rtl" {
  return useMaybeCurrentTranslation()?.dir ?? "ltr"
}

/**
 * The value {@link useCurrentTranslation} returns: the active locale's strings.
 *
 * The name a component annotates a prop with when it is handed the translation
 * rather than reading it from context — a static renderer, say, or a test.
 */
export type TLUiTranslationContextType = TLUiTranslation
