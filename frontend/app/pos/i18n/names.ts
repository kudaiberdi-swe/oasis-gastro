import type { Locale } from "./core"

// Dish, modifier and size names carry both languages (products.name — Russian, products.nameKk — Kazakh).
// The interface language decides which one leads: Kazakh first in kk, Russian first in ru; the other is
// the quiet second line. A missing or identical Kazakh name leaves only the Russian one.

export type NamePart = { text: string; lang: Locale }

export type BilingualName = { primary: NamePart; secondary: NamePart | null }

export function bilingualName(locale: Locale, input: { name: string; nameKk?: string | null }): BilingualName {
  const ru = input.name.trim() ? input.name : (input.nameKk ?? "")
  const kk = input.nameKk?.trim() ?? ""
  const russian: NamePart = { text: ru, lang: "ru" }
  if (!kk || kk === ru.trim()) return { primary: russian, secondary: null }
  const kazakh: NamePart = { text: input.nameKk!, lang: "kk" }
  return locale === "kk" ? { primary: kazakh, secondary: russian } : { primary: russian, secondary: kazakh }
}
