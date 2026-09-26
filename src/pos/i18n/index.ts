// The POS interface language: dictionaries (ru.ts, kk.ts), the translator, the provider and helpers.

export { createTranslator, formatMessage, INTL_LOCALE, isLocale, LOCALES, MESSAGES, messageParams, pluralForm, ruT, type Locale, type MessageKey, type Messages, type Params, type Translator } from "./core"
export { bilingualName, type BilingualName, type NamePart } from "./names"
export { LOCALE_STORAGE_KEY, LocaleProvider, readStoredLocale, useLocale, useT } from "./locale-provider"
export { posErrorMessage } from "./errors"
