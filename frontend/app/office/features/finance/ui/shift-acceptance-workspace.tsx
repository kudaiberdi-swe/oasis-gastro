import { useId, useMemo, useState } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { Button, ConfirmDialog, DataTable, EmptyState, FilterTabs, loadMoreFromPaginated, Select, StatusPill, useToast, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatAmount } from "@/shared/lib/format"
import { recordCount } from "@/shared/lib/plural"
import { cn } from "@/shared/lib/utils"

import { FINANCE_PAGE_SIZE, useFinanceRestaurantFilter, useShiftAcceptanceMutations, useShiftAcceptances, type ShiftAcceptanceRow } from "../data/use-finance-records"
import { ShiftAcceptancePanel } from "./shift-acceptance-panel"

/** «Принятие смен» (/office/shift-acceptance, W1-FIN-06): the panel of closed shifts, then the register of accepted ones. */
export function ShiftAcceptanceWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <ShiftAcceptancePanel />
        <AcceptedShifts />
      </div>
    </PlatformErrorBoundary>
  )
}

const TABS = [
  { value: "all", label: "Все" },
  { value: "posted", label: "Принятые" },
  { value: "reversed", label: "Сторно" },
]

function AcceptedShifts() {
  const canReverse = useCan("office.shift-acceptance.reverse")
  // The register reads one restaurant at a time (acceptances by restaurant index).
  const restaurants = useFinanceRestaurantFilter({ allowAll: false })
  const list = useShiftAcceptances(restaurants.loading ? undefined : restaurants.restaurantExternalId)
  const { reverse } = useShiftAcceptanceMutations()
  const toast = useToast()
  const panelId = useId()
  const [tab, setTab] = useState("all")
  const [reversing, setReversing] = useState<ShiftAcceptanceRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(() => list.results.filter((row) => (tab === "posted" ? !row.reversedAt : tab === "reversed" ? Boolean(row.reversedAt) : true)), [list.results, tab])

  const columns: Column<ShiftAcceptanceRow>[] = [
    { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatAlmatyDateTime(row.acceptedAt)}</span>, sortValue: (row) => row.acceptedAt },
    { key: "restaurant", header: "Ресторан", cell: (row) => restaurants.restaurantName(row.restaurantExternalId) },
    { key: "expected", header: "Ожидалось, ₸", numeric: true, cell: (row) => formatAmount(row.expectedCash) },
    { key: "counted", header: "По кассиру, ₸", numeric: true, cell: (row) => formatAmount(row.countedAtCloseCash) },
    { key: "recounted", header: "Пересчитано, ₸", numeric: true, cell: (row) => formatAmount(row.recountedCash) },
    {
      key: "variance",
      header: "Расхождение, ₸",
      numeric: true,
      cell: (row) => <span className={cn(row.variance !== 0 && "font-semibold text-destructive")}>{row.variance > 0 ? `+${formatAmount(row.variance)}` : formatAmount(row.variance)}</span>,
      sortValue: (row) => row.variance,
    },
    {
      key: "by",
      header: "Принял",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate">{row.acceptedByEmail}</span>
          {row.note ? <span className="truncate text-caption text-muted-foreground">{row.note}</span> : null}
        </div>
      ),
    },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.reversedAt ? "reversed" : "posted"} /> },
    ...(canReverse
      ? [
          {
            key: "actions",
            header: <span className="sr-only">Действия</span>,
            cell: (row: ShiftAcceptanceRow) =>
              row.reversedAt ? null : (
                <Button variant="ghost" size="sm" onClick={() => setReversing(row)}>
                  Сторно
                </Button>
              ),
          },
        ]
      : []),
  ]

  async function confirmReverse(reason: string) {
    if (!reversing) return
    if (reason.trim().length < 3) {
      setError("Опишите причину — хотя бы несколько слов")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await reverse({ shiftId: reversing.shiftId, reason })
      toast("Приёмка сторнирована — смена снова ждёт приёмки", "success")
      setReversing(null)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сторнировать приёмку"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="accepted-shifts-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="accepted-shifts-title" className="font-display text-title-sm font-semibold">
          Принятые смены
        </h2>
        {restaurants.visible ? <Select aria-label="Ресторан принятых смен" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
      </div>
      <FilterTabs aria-label="Статус приёмки" value={tab} onValueChange={setTab} items={TABS} panelId={panelId} />
      <div id={panelId} role="tabpanel" aria-label={TABS.find((candidate) => candidate.value === tab)?.label} className="flex flex-col gap-3">
        {restaurants.loading || list.status === "LoadingFirstPage" ? (
          restaurants.loading || restaurants.restaurantExternalId ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : (
            <EmptyState title="Нет ресторанов" description="В вашем доступе нет ни одного ресторана." />
          )
        ) : (
          <>
            <p className="text-caption text-muted-foreground">{recordCount(rows.length)}</p>
            <DataTable
              caption="Принятые смены"
              columns={columns}
              rows={rows}
              getRowId={(row) => row._id}
              empty={<EmptyState title="Записей пока нет" description="Принятые смены появятся здесь после приёмки из панели выше." />}
              loadMore={loadMoreFromPaginated(list, FINANCE_PAGE_SIZE)}
            />
          </>
        )}
      </div>
      <ConfirmDialog
        open={reversing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReversing(null)
            setError(null)
          }
        }}
        title="Сторнировать приёмку смены?"
        description="Проводка расхождения будет отменена обратной записью, смена вернётся в список к приёмке."
        confirmLabel="Сторнировать"
        reasonLabel="Причина сторно"
        submitting={busy}
        error={error}
        onConfirm={confirmReverse}
      />
    </section>
  )
}
