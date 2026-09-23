import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/shared/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, formatTenge } from "@/shared/lib/utils"

import { useFinanceEntries, useFinanceRestaurants, useFinanceSummary, useRecordExpense, type FinanceFilter } from "../data/use-office-finance"

const inputClass = "h-11 rounded-[var(--radius-control)] border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"

const EXPENSE_CATEGORY_SUGGESTIONS = ["Аренда", "Коммунальные", "Зарплата", "Маркетинг", "Ремонт", "Прочее"]

const SOURCE_LABEL: Record<string, string> = { orders: "Касса", stock: "Склад", manual: "Вручную" }

export function FinanceWorkspace() {
  const restaurants = useFinanceRestaurants()
  const [restaurantExternalId, setRestaurantExternalId] = useState<string>("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [addingExpense, setAddingExpense] = useState(false)
  const recordExpense = useRecordExpense()

  const filter: FinanceFilter = useMemo(
    () => ({ restaurantExternalId: restaurantExternalId || undefined, from: from || undefined, to: to || undefined }),
    [restaurantExternalId, from, to],
  )
  const { summary, loading: summaryLoading } = useFinanceSummary(filter)
  const { entries, loading: entriesLoading } = useFinanceEntries({ ...filter, limit: 200 })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={restaurantExternalId} onChange={(event) => setRestaurantExternalId(event.target.value)} className={cn(inputClass, "h-9 w-48")}>
            <option value="">Все филиалы</option>
            {restaurants.map((restaurant) => <option key={restaurant.externalId} value={restaurant.externalId}>{restaurant.name}</option>)}
          </select>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={cn(inputClass, "h-9 w-40")} />
          <span className="text-sm text-muted-foreground">—</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={cn(inputClass, "h-9 w-40")} />
        </div>
        <Button size="sm" onClick={() => setAddingExpense(true)}>
          <Plus className="size-3.5" /> Добавить расход
        </Button>
      </div>

      {summaryLoading ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Загрузка…</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-3 gap-3 p-5">
            <SummaryCard label="Выручка" value={summary!.revenue} tone="positive" />
            <SummaryCard label="Расходы" value={summary!.expense} tone="negative" />
            <SummaryCard label="Прибыль" value={summary!.net} tone={summary!.net >= 0 ? "positive" : "negative"} />
          </div>

          {summary!.byCategory.length ? (
            <div className="px-5 pb-4">
              <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">По статьям</p>
              <div className="flex flex-wrap gap-2">
                {summary!.byCategory.map((row) => (
                  <div key={row.category} className="rounded-[var(--radius-card)] border border-border bg-card px-3 py-2 text-sm">
                    <span className="font-semibold text-foreground">{row.category}</span>{" "}
                    <span className={cn("tabular-nums", row.kind === "revenue" ? "text-success" : "text-destructive")}>{row.kind === "revenue" ? "+" : "-"}{formatTenge(row.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left">Дата</th>
                <th className="px-3 py-2 text-left">Филиал</th>
                <th className="px-3 py-2 text-left">Статья</th>
                <th className="px-3 py-2 text-left">Описание</th>
                <th className="px-3 py-2 text-left">Источник</th>
                <th className="px-3 py-2 text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {entriesLoading ? null : entries.map((entry) => (
                <tr key={entry._id} className="border-t border-border/60">
                  <td className="px-5 py-2 text-xs text-muted-foreground">{entry.businessDate}</td>
                  <td className="px-3 py-2">{restaurants.find((restaurant) => restaurant.externalId === entry.restaurantExternalId)?.name ?? entry.restaurantExternalId}</td>
                  <td className="px-3 py-2 font-semibold text-foreground">{entry.category}</td>
                  <td className="px-3 py-2 text-muted-foreground">{entry.description}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{SOURCE_LABEL[entry.sourceModuleId] ?? entry.sourceModuleId}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", entry.kind === "revenue" ? "text-success" : "text-destructive")}>
                    {entry.kind === "revenue" ? "+" : "-"}{formatTenge(entry.amount)}
                  </td>
                </tr>
              ))}
              {!entriesLoading && !entries.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">Записей нет за выбранный период</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {addingExpense ? (
        <RecordExpenseDialog restaurants={restaurants} onClose={() => setAddingExpense(false)} onRecord={recordExpense} />
      ) : null}
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "positive" | "negative" }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-border bg-card p-4">
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("font-display mt-1 text-2xl font-semibold tabular-nums", tone === "positive" ? "text-success" : "text-destructive")}>{formatTenge(value)}</p>
    </div>
  )
}

function RecordExpenseDialog({
  restaurants,
  onClose,
  onRecord,
}: {
  restaurants: { externalId: string; name: string }[]
  onClose: () => void
  onRecord: (args: { restaurantExternalId: string; amount: number; category: string; description: string }) => Promise<unknown>
}) {
  const [restaurantExternalId, setRestaurantExternalId] = useState(restaurants[0]?.externalId ?? "")
  const [category, setCategory] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onRecord({ restaurantExternalId, amount: Number(amount), category, description })
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить расход"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Новый расход</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Филиал</span>
            <select value={restaurantExternalId} onChange={(event) => setRestaurantExternalId(event.target.value)} className={inputClass} required>
              {restaurants.map((restaurant) => <option key={restaurant.externalId} value={restaurant.externalId}>{restaurant.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Статья</span>
            <input value={category} onChange={(event) => setCategory(event.target.value)} list="expense-categories" className={inputClass} required />
            <datalist id="expense-categories">
              {EXPENSE_CATEGORY_SUGGESTIONS.map((option) => <option key={option} value={option} />)}
            </datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Сумма, ₸</span>
            <input type="number" min={0} step="any" value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Комментарий</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} className={inputClass} />
          </label>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="mt-1">{submitting ? "Сохранение…" : "Сохранить"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
