import { Eye } from "lucide-react"
import { useState } from "react"

import { Button, ConfirmDialog, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { plural, type PluralForms } from "@/shared/lib/plural"

import { useNomenclatureMutations } from "../data/use-nomenclature"

// Pages of the change over iiko dishes (hundreds, not thousands of price rows): one call on a typical account.
const PAGE = 500
const DISHES: PluralForms = ["блюдо", "блюда", "блюд"]

/**
 * «Показать блюда iiko с ценой» (W1-IIKO-04): iiko dishes arrive hidden from the POS; one action shows every
 * iiko dish that iiko prices in a restaurant of the user's scope. First a dry run counts them, then the
 * confirmation applies it. Dishes hidden on purpose in the product card stay hidden.
 */
export function ShowIikoDishesButton() {
  const { showPricedIikoDishes, hidePdfMenu, previewIikoMenuSwitch } = useNomenclatureMutations()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  const [pdfCount, setPdfCount] = useState(0)
  const [pdfPrices, setPdfPrices] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function showPages() {
    let shown = 0
    let cursor: string | null = null
    for (;;) {
      const result = await showPricedIikoDishes({ paginationOpts: { numItems: PAGE, cursor }, dryRun: false })
      shown += result.shown
      if (result.isDone) break
      cursor = result.continueCursor
    }
    return shown
  }

  // The PDF stand-in menu leaves the POS together with the switch to the iiko menu.
  async function pdfPages() {
    let hidden = 0
    let prices = 0
    let cursor: string | null = null
    for (;;) {
      const result = await hidePdfMenu({ paginationOpts: { numItems: PAGE, cursor }, dryRun: false })
      hidden += result.hidden
      prices += result.pricesDropped
      if (result.isDone) break
      cursor = result.continueCursor
    }
    return { hidden, prices }
  }

  async function countDishes() {
    setBusy(true)
    try {
      setError(null)
      const preview = await previewIikoMenuSwitch()
      if (preview.toShow === 0 && preview.hiddenService === 0 && preview.pdfHidden === 0 && preview.pdfPrices === 0) toast("Скрытых блюд iiko с ценой в ваших филиалах нет", "success")
      else {
        setPdfCount(preview.pdfHidden)
        setPdfPrices(preview.pdfPrices)
        setCount(preview.toShow)
      }
    } catch (caught) {
      toast(errorMessage(caught, "Не удалось посчитать блюда iiko"), "error")
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    setBusy(true)
    try {
      const shown = await showPages()
      const pdf = pdfCount || pdfPrices ? await pdfPages() : { hidden: 0, prices: 0 }
      setCount(null)
      toast(`На кассе показано ${shown} ${plural(shown, DISHES)} iiko${pdf.hidden ? `, меню из PDF скрыто (${pdf.hidden})` : ""}${pdf.prices ? `; цены iiko для блюд, сопоставленных с PDF, появятся после следующего импорта iiko` : ""}`, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось показать блюда"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" disabled={busy} onClick={() => void countDishes()}>
        <Eye aria-hidden />
        {busy && count === null ? "Считаем…" : "Показать блюда iiko с ценой"}
      </Button>
      <ConfirmDialog
        open={count !== null}
        onOpenChange={(open) => {
          if (!open) setCount(null)
        }}
        title={`Показать на кассе ${count ?? 0} ${plural(count ?? 0, DISHES)} iiko?`}
        description={`Будут показаны блюда из iiko, у которых в iiko есть действующая цена в ваших филиалах; в каждом филиале — только блюда с его ценой. Служебные позиции («тест», «стафф», «комплимент») и позиции с ценой 0 ₸ на кассе не показываются. Блюда, скрытые вручную в карточке товара, останутся скрытыми.${pdfCount ? ` Временное меню из PDF (${pdfCount} ${plural(pdfCount, DISHES)}) будет скрыто с кассы.` : ""}${pdfPrices ? ` У блюд, сопоставленных с iiko, снимутся цены из PDF (${pdfPrices}) — цены iiko придут со следующим импортом, до него эти блюда на кассе не видны.` : ""} Любое блюдо можно показать или скрыть в его карточке.`}
        confirmLabel="Показать на кассе"
        danger={false}
        submitting={busy}
        error={error}
        onConfirm={() => void apply()}
      />
    </>
  )
}
