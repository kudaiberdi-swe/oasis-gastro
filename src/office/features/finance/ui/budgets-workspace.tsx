import { useState } from "react"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Select, Skeleton, StatusPill, type Column } from "@/shared/components/ui"
import { formatAmount } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import { useFinanceRestaurantFilter, type FinanceRecord } from "../data/use-finance-records"
import { useBudgetExecution } from "../data/use-planning"
import { APPROVAL_TABS, formatBusinessDate } from "../model/modules"
import { budgetPeriodOf, budgetVersionOf, formatExecution } from "../model/planning"
import { BudgetEditor } from "./budget-editor"
import { FinanceRegister } from "./finance-register"

const MODULE = "budgets"

/** «Бюджеты» (/office/budgets — register, /office/budgets/:id — the editor, W3-FIN-13): plans by account and cashflow category and their plan-fact. */
export function BudgetsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  const selection = useMasterSelection(MODULE)
  return (
    <PlatformErrorBoundary key={`${selection.selectedId ?? (selection.isNew ? "new" : "list")}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      <Budgets />
    </PlatformErrorBoundary>
  )
}

/** «Факт» and «Исполнение» of an agreed budget; a draft has nothing to compare yet. */
function useRowFact(row: FinanceRecord) {
  const counted = row.status !== "draft" && row.status !== "cancelled"
  return { counted, execution: useBudgetExecution(counted ? row.externalId : null) }
}

function FactCell({ row }: { row: FinanceRecord }) {
  const { counted, execution } = useRowFact(row)
  if (!counted) return <span className="text-muted-foreground">—</span>
  if (execution === undefined) return <Skeleton className="ml-auto h-4 w-16" />
  return <span>{formatAmount(execution.fact)}</span>
}

function ExecutionCell({ row }: { row: FinanceRecord }) {
  const { counted, execution } = useRowFact(row)
  if (!counted) return <span className="text-muted-foreground">—</span>
  if (execution === undefined) return <Skeleton className="ml-auto h-4 w-12" />
  return <span className={cn(execution.percent !== null && execution.percent > 100 && "text-destructive")}>{formatExecution(execution.percent)}</span>
}

function Budgets() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const selection = useMasterSelection(MODULE)
  const restaurants = useFinanceRestaurantFilter()

  if (selection.selectedId !== null || (selection.isNew && canEdit)) return <BudgetEditor externalId={selection.selectedId} defaultRestaurantExternalId={restaurants.restaurantExternalId} />

  const columns: Column<FinanceRecord>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    {
      key: "period",
      header: "Период",
      cell: (row) => {
        const period = budgetPeriodOf(row)
        return (
          <div className="flex min-w-0 flex-col">
            <span className="whitespace-nowrap">
              {formatBusinessDate(period.start)} — {formatBusinessDate(period.end)}
            </span>
            <span className="truncate text-caption text-muted-foreground">
              {row.name} · версия {budgetVersionOf(row)}
            </span>
          </div>
        )
      },
      sortValue: (row) => budgetPeriodOf(row).start,
    },
    { key: "restaurant", header: "Ресторан", cell: (row) => restaurants.restaurantName(row.restaurantExternalId) },
    { key: "plan", header: "План, ₸", numeric: true, cell: (row) => formatAmount(row.amount), sortValue: (row) => row.amount },
    { key: "fact", header: "Факт, ₸", numeric: true, cell: (row) => <FactCell row={row} /> },
    { key: "execution", header: "Исполнение, %", numeric: true, cell: (row) => <ExecutionCell row={row} /> },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <FinanceRegister
        moduleId={MODULE}
        caption="Бюджеты"
        tabs={APPROVAL_TABS}
        columns={columns}
        searchPlaceholder="Поиск: бюджеты"
        createLabel={canEdit ? "Новый бюджет" : undefined}
        onCreate={selection.openNew}
        formOpen={false}
        selectedId={null}
        onSelect={selection.select}
        emptyTitle="Бюджетов пока нет"
        emptyDescription="Создайте бюджет на период: план по счетам и статьям ДДС, факт посчитается из журнала и платежей."
        restaurantExternalId={restaurants.loading ? undefined : restaurants.restaurantExternalId}
        toolbar={restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
      />
    </div>
  )
}
