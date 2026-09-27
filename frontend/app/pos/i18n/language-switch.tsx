import { SegmentedControl } from "@/shared/components/ui/segmented-control"
import { Button } from "@/shared/components/ui/button"
import { useLocale } from "./locale-provider"
import type { Locale } from "./core"

// Each language is named in itself and marked with its own lang, so a screen reader reads «Қазақша» in
// Kazakh even while the interface is Russian.
const NATIVE_NAME: Record<Locale, string> = { ru: "Русский", kk: "Қазақша" }

/** RU / KK in «Профиль сотрудника»: applies at once, remembered on this terminal. */
export function LanguageSwitch({ label }: { label: string }) {
  const { locale, setLocale } = useLocale()
  return (
    <SegmentedControl<Locale>
      aria-label={label}
      size="pos"
      value={locale}
      onValueChange={setLocale}
      options={[
        { value: "ru", label: <span lang="ru">{NATIVE_NAME.ru}</span> },
        { value: "kk", label: <span lang="kk">{NATIVE_NAME.kk}</span> },
      ]}
    />
  )
}

/** A quiet link on the sign-in screen: the other language, before anyone is signed in. */
export function LanguageLink({ label }: { label: string }) {
  const { locale, setLocale } = useLocale()
  const other: Locale = locale === "kk" ? "ru" : "kk"
  return (
    <Button variant="link" className="self-center" aria-label={label} onClick={() => setLocale(other)}>
      <span lang={other}>{NATIVE_NAME[other]}</span>
    </Button>
  )
}
