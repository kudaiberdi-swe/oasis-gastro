import { plural as pluralRussian, type PluralForms } from "@/shared/lib/plural"
import { kk } from "./kk"
import { ru, type MessageKey } from "./ru"

// The cashier's interface language (PRODUCT.md: «Kazakh + Russian interface is required, at least on the
// POS»). No library: a typed dictionary per language — ru.ts is the source of truth, kk.ts must have every
// key (a missing one fails typecheck) — `{name}` interpolation and `{count|форма|формы|форм}` plurals.
// Server texts (ConvexError messages) stay Russian; the office never uses this module.

export type Locale = "ru" | "kk"

export const LOCALES: Locale[] = ["ru", "kk"]

export type { MessageKey } from "./ru"

export type Messages = Record<MessageKey, string>

export type Params = Record<string, string | number>

export const MESSAGES: Record<Locale, Messages> = { ru, kk }

/** Intl locale for dates and times: «24 сентября» / «24 қыркүйек». Money is formatted the same in both. */
export const INTL_LOCALE: Record<Locale, string> = { ru: "ru-RU", kk: "kk-KZ" }

/**
 * The noun form for a count. Russian agrees with the numeral (1 позиция, 2–4 позиции, 5+ позиций; 11–14 →
 * позиций); Kazakh does not — a noun after a numeral stays singular (1 позиция / 5 позиция), so the first
 * form is always the one.
 */
export function pluralForm(locale: Locale, count: number, forms: readonly string[]) {
  if (locale === "kk" || forms.length < 3) return forms[0] ?? ""
  return pluralRussian(count, forms as unknown as PluralForms)
}

const PLURAL_TOKEN = /\{(\w+)\|([^{}]+)\}/g
const PARAM_TOKEN = /\{(\w+)\}/g

/** Fills `{name}` and `{count|one|few|many}` in a message; an unknown parameter is left visible, never «undefined». */
export function formatMessage(template: string, params: Params | undefined, locale: Locale) {
  if (!params) return template
  return template
    .replace(PLURAL_TOKEN, (_, name: string, forms: string) => pluralForm(locale, Number(params[name] ?? 0), forms.split("|")))
    .replace(PARAM_TOKEN, (token, name: string) => (params[name] === undefined ? token : String(params[name])))
}

/** The parameter names a message uses — the dictionary tests check that kk and ru ask for the same ones. */
export function messageParams(template: string) {
  return [...template.matchAll(/\{(\w+)(?:\|[^{}]*)?\}/g)].map((match) => match[1]).sort()
}

export interface Translator {
  (key: MessageKey, params?: Params): string
  locale: Locale
  /** "ru-RU" / "kk-KZ" for Intl date and time formatting. */
  intl: string
}

const translators = new Map<Locale, Translator>()

export function createTranslator(locale: Locale): Translator {
  const cached = translators.get(locale)
  if (cached) return cached
  const messages = MESSAGES[locale]
  const translate = ((key: MessageKey, params?: Params) => formatMessage(messages[key] || ru[key] || key, params, locale)) as Translator
  translate.locale = locale
  translate.intl = INTL_LOCALE[locale]
  translators.set(locale, translate)
  return translate
}

/** Russian — the default of every model helper that takes a translator, so callers outside the POS read as before. */
export const ruT = createTranslator("ru")

export function isLocale(value: unknown): value is Locale {
  return value === "ru" || value === "kk"
}
