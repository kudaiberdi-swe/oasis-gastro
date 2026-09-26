import { PosWorkspace } from "@/pos/features/order-taking/ui/pos-workspace"
import { LocaleProvider, useLocale } from "@/pos/i18n"

export function PosRouter() {
  return (
    <LocaleProvider>
      <PosRoot />
    </LocaleProvider>
  )
}

/** `lang` on the POS root follows the interface language (portalled dialogs read it from `<html lang>`). */
function PosRoot() {
  const { locale } = useLocale()
  return (
    <div lang={locale} className="h-full w-full">
      <PosWorkspace />
    </div>
  )
}
