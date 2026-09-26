import { Eye } from "lucide-react"
import { useState } from "react"

import { Button, ConfirmDialog, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { plural, type PluralForms } from "@/shared/lib/plural"

import { useNomenclatureMutations } from "../data/use-nomenclature"

const PAGE = 100
const DISHES: PluralForms = ["блюдо", "блюда", "блюд"]

/**
 * «Показать блюда iiko с ценой» (W1-IIKO-04): iiko dishes arrive hidden from the POS; one action shows every
 * iiko dish that iiko prices in a restaurant of the user's scope. First a dry run counts them, then the
 * confirmation applies it. Dishes hidden on purpose in the product card stay hidden.
 */
export function ShowIikoDishesButton() {
  const { showPricedIikoDishes } = useNomenclatureMutations()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pages(dryRun: boolean) {
    const ids = new Set<string>()
    let shown = 0
    let cursor: string | null = null
    for (;;) {
      const result = await showPricedIikoDishes({ paginationOpts: { numItems: PAGE, cursor }, dryRun })
      for (const id of result.productIds) ids.add(id)
      shown += result.shown
      if (result.isDone) break
      cursor = result.continueCursor
    }
    return dryRun ? ids.size : shown
  }

  async function countDishes() {
    setBusy(true)
    try {
      setError(null)
      const found = await pages(true)
      if (found === 0) toast("Скрытых блюд iiko с ценой в ваших филиалах нет", "success")
      else setCount(found)
    } catch (caught) {
      toast(errorMessage(caught, "Не удалось посчитать блюда iiko"), "error")
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    setBusy(true)
    try {
      const shown = await pages(false)
      setCount(null)
      toast(`На кассе показано ${shown} ${plural(shown, DISHES)} iiko`, "success")
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
        description="Будут показаны блюда из iiko, у которых в iiko есть действующая цена в ваших филиалах. Блюда, скрытые вручную в карточке товара, останутся скрытыми. Скрыть любое блюдо можно в его карточке."
        confirmLabel="Показать на кассе"
        danger={false}
        submitting={busy}
        error={error}
        onConfirm={() => void apply()}
      />
    </>
  )
}
