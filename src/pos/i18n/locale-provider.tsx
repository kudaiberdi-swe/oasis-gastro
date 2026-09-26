import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { UiLabelsProvider, type UiLabels } from "@/shared/lib/ui-labels"
import { createTranslator, isLocale, ruT, type Locale, type MessageKey, type Translator } from "./core"
import { ru } from "./ru"

/** Per terminal (this browser), like the theme and density: a cashier's choice survives a reload and a re-login. */
export const LOCALE_STORAGE_KEY = "sandyq-pos-locale"

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: Translator }

// Outside a provider (a component rendered on its own, the kitchen screen) everything reads Russian.
const LocaleContext = createContext<LocaleContextValue>({ locale: "ru", setLocale: () => {}, t: ruT })

export function readStoredLocale(key = LOCALE_STORAGE_KEY): Locale {
  try {
    const stored = window.localStorage.getItem(key)
    return isLocale(stored) ? stored : "ru"
  } catch {
    return "ru"
  }
}

/** The shared primitives' own words (dialog close, PIN pad, loading, status pills) in the interface language. */
function uiLabelsFor(t: Translator): UiLabels {
  return {
    close: t("common.close"),
    erase: t("common.erase"),
    loading: t("common.loading"),
    entered: (label, count, max) => t("common.entered", { label, count, max }),
    status: (domain, status) => {
      const key = `status.${domain}.${status}`
      return key in ru ? t(key as MessageKey) : undefined
    },
  }
}

/**
 * The POS interface language (RU / KK in «Профиль сотрудника»). Switching re-renders at once, no reload;
 * `<html lang>` follows it, so dialogs in portals are announced in the right language too.
 */
export function LocaleProvider({ children, initialLocale, storageKey = LOCALE_STORAGE_KEY }: { children: ReactNode; initialLocale?: Locale; storageKey?: string }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? readStoredLocale(storageKey))

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next)
      try {
        window.localStorage.setItem(storageKey, next)
      } catch {
        // Blocked storage (private mode): the language still applies until the page is reloaded.
      }
    },
    [storageKey],
  )

  useEffect(() => {
    const root = document.documentElement
    const previous = root.getAttribute("lang")
    root.setAttribute("lang", locale)
    return () => {
      if (previous === null) root.removeAttribute("lang")
      else root.setAttribute("lang", previous)
    }
  }, [locale])

  const t = createTranslator(locale)
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  const labels = useMemo(() => uiLabelsFor(t), [t])

  return (
    <LocaleContext.Provider value={value}>
      <UiLabelsProvider labels={labels}>{children}</UiLabelsProvider>
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  return useContext(LocaleContext)
}

/** `t("login.title")`, `t("order.positions", { count: 3 })`; `t.locale` and `t.intl` for Intl formatting. */
export function useT() {
  return useContext(LocaleContext).t
}
