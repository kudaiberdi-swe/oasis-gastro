import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  KpiCard,
  MoneyInput,
  Select,
  SkeletonRows,
  type Column,
} from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import { useFinanceEntries, useFinanceRestaurants, useFinanceSummary, useRecordExpense, type FinanceFilter } from "../data/use-office-finance"

const EXPENSE_CATEGORY_SUGGESTIONS = ["Аренда", "Коммунальные", "Зарплата", "Маркетинг", "Ремонт", "Прочее"]

const SOURCE_LABEL: Record<string, string> = { orders: "Касса", stock: "Склад", manual: "Вручную" }

/** Radix Select cannot hold "", so «Все филиалы» uses a sentinel that maps back to "no filter". */
const ALL_RESTAURANTS = "all"

type FinanceEntry = ReturnType<typeof useFinanceEntries>["entries"][number]

/** Revenue is shown with "+", expense with a real minus, both via formatTenge. */
function signedAmount(kind: string, amount: number) {
  return formatTenge(kind === "revenue" ? amount : -amount, { explicitPlus: true })
}

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

  const restaurantOptions = [{ value: ALL_RESTAURANTS, label: "Все филиалы" }, ...restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name }))]

  const columns: Column<FinanceEntry>[] = [
    { key: "date", header: "Дата", sortValue: (entry) => entry.businessDate, cell: (entry) => <span className="whitespace-nowrap text-muted-foreground">{entry.businessDate}</span> },
    {
      key: "restaurant",
      header: "Филиал",
      cell: (entry) => restaurants.find((restaurant) => restaurant.externalId === entry.restaurantExternalId)?.name ?? entry.restaurantExternalId,
    },
    { key: "category", header: "Статья", sortValue: (entry) => entry.category, cell: (entry) => <span className="font-semibold">{entry.category}</span> },
    { key: "description", header: "Описание", cell: (entry) => <span className="text-muted-foreground">{entry.description}</span> },
    { key: "source", header: "Источник", cell: (entry) => <span className="text-muted-foreground">{SOURCE_LABEL[entry.sourceModuleId] ?? entry.sourceModuleId}</span> },
    {
      key: "amount",
      header: "Сумма",
      numeric: true,
      sortValue: (entry) => (entry.kind === "revenue" ? entry.amount : -entry.amount),
      cell: (entry) => <span className={cn("font-semibold", entry.kind === "revenue" ? "text-success" : "text-destructive")}>{signedAmount(entry.kind, entry.amount)}</span>,
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Филиал"
            value={restaurantExternalId || ALL_RESTAURANTS}
            onValueChange={(value) => setRestaurantExternalId(value === ALL_RESTAURANTS ? "" : value)}
            options={restaurantOptions}
            className="w-56"
          />
          <Input type="date" aria-label="С даты" value={from} onChange={(event) => setFrom(event.target.value)} className="w-44" />
          <span aria-hidden className="text-body-sm text-muted-foreground">
            —
          </span>
          <Input type="date" aria-label="По дату" value={to} onChange={(event) => setTo(event.target.value)} className="w-44" />
        </div>
        <Button size="sm" onClick={() => setAddingExpense(true)}>
          <Plus /> Добавить расход
        </Button>
      </div>

      {summaryLoading ? (
        <div className="flex min-h-0 flex-1 flex-col p-5">
          <SkeletonRows />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard label="Выручка" value={summary!.revenue} tone="positive" />
            <SummaryCard label="Расходы" value={summary!.expense} tone="negative" />
            <SummaryCard label="Прибыль" value={summary!.net} tone={summary!.net >= 0 ? "positive" : "negative"} />
          </div>

          {summary!.byCategory.length ? (
            <section aria-labelledby="finance-by-category" className="flex flex-col gap-2">
              <h2 id="finance-by-category" className="text-body-sm font-semibold text-foreground">
                По статьям
              </h2>
              <div className="flex flex-wrap gap-2">
                {summary!.byCategory.map((row) => (
                  <div key={row.category} className="flex items-baseline gap-2 rounded-card border border-border bg-card px-3 py-2 text-body-sm">
                    <span className="font-semibold text-foreground">{row.category}</span>
                    <span className={cn("tabular-nums", row.kind === "revenue" ? "text-success" : "text-destructive")}>{signedAmount(row.kind, row.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <DataTable
            caption="Проводки"
            columns={columns}
            rows={entriesLoading ? undefined : entries}
            getRowId={(entry) => entry._id}
            empty={<EmptyState title="Записей нет" description="За выбранный период проводок нет." />}
          />
        </div>
      )}

      {addingExpense ? <RecordExpenseDialog restaurants={restaurants} onClose={() => setAddingExpense(false)} onRecord={recordExpense} /> : null}
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "positive" | "negative" }) {
  return <KpiCard label={label} value={<span className={tone === "positive" ? "text-success" : "text-destructive"}>{formatTenge(value)}</span>} />
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
  const [amount, setAmount] = useState<number | null>(null)
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    // The native <select required> used to block submit without a branch; Radix Select has no native validation.
    if (!restaurantExternalId) {
      setError("Выберите филиал")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onRecord({ restaurantExternalId, amount: amount ?? 0, category, description })
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
        <DialogHeader>
          <DialogTitle>Новый расход</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Филиал">
            {(control) => (
              <Select
                {...control}
                value={restaurantExternalId || undefined}
                onValueChange={setRestaurantExternalId}
                options={restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name }))}
              />
            )}
          </Field>
          <Field label="Статья">
            {(control) => (
              <>
                <Input {...control} value={category} onChange={(event) => setCategory(event.target.value)} list="expense-categories" required />
                <datalist id="expense-categories">
                  {EXPENSE_CATEGORY_SUGGESTIONS.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Сумма">{(control) => <MoneyInput {...control} value={amount} onValueChange={setAmount} required />}</Field>
          <Field label="Комментарий">{(control) => <Input {...control} value={description} onChange={(event) => setDescription(event.target.value)} />}</Field>
          {error ? (
            <p role="alert" className="text-body-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
