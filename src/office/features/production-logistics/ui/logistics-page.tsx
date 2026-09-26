import { Plus } from "lucide-react"
import { useId, useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { Banner, Button, DataTable, FilterTabs, Input, loadMoreFromPaginated, Skeleton, StatusPill, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity } from "@/shared/lib/format"
import { recordCount } from "@/shared/lib/plural"

import { formatBusinessDate, LOGISTICS, type LogisticsConfig, type RecordModule, type RecordStatus } from "../config"
import { LOGISTICS_PAGE_SIZE, useForecastTarget, useLogisticsMutations, useRecords, useRequirement, type RecordRow, type Requirement } from "../data/use-production-logistics"
import { ForecastPanel } from "./forecast-panel"
import { RecordEditor } from "./record-editor"

/** /office/<kitchen-plan|semi-finished-sheet> — Domain §3.5 with «Прогноз кухни»; /:id — the record. */
function LogisticsWorkspace({ moduleId }: { moduleId: RecordModule }) {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  const config = LOGISTICS[moduleId]
  return (
    <PlatformErrorBoundary key={`${moduleId}-${id ?? "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id ? <RecordEditor config={config} externalId={id} /> : <LogisticsRegister config={config} />}
    </PlatformErrorBoundary>
  )
}

export const KitchenPlanWorkspace = () => <LogisticsWorkspace moduleId="kitchen-plan" />
export const SemiFinishedSheetWorkspace = () => <LogisticsWorkspace moduleId="semi-finished-sheet" />

function LogisticsRegister({ config }: { config: LogisticsConfig }) {
  const navigate = useNavigate()
  const toast = useToast()
  const canEdit = useCan(`office.${config.moduleId}.edit`)
  const target = useForecastTarget()
  const sheet = config.moduleId === "semi-finished-sheet"
  const requirement = useRequirement(target.restaurantExternalId, target.targetDate, sheet)
  const { createFromForecast } = useLogisticsMutations()
  const panelId = useId()
  const [tab, setTab] = useState<"all" | RecordStatus>("all")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const list = useRecords({ moduleId: config.moduleId, status: tab === "all" ? undefined : tab, search, enabled: !target.loading })
  const open = (externalId: string) => navigate(`/office/${config.moduleId}/${encodeURIComponent(externalId)}`)

  async function create() {
    if (creating || !target.restaurantExternalId) return
    setCreating(true)
    setError(null)
    try {
      const result = await createFromForecast({ moduleId: config.moduleId, restaurantExternalId: target.restaurantExternalId, targetDate: target.targetDate })
      if (result.existing) toast(`На ${formatBusinessDate(target.targetDate)} запись уже есть — открываем её`, "info")
      open(result.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось создать запись по прогнозу"))
      setCreating(false)
    }
  }

  const columns: Column<RecordRow>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatBusinessDate(row.businessDate)}</span> },
    { key: "restaurant", header: "Ресторан", cell: (row) => row.restaurantName },
    ...(sheet
      ? [
          { key: "items", header: "Заготовка", cell: (row: RecordRow) => <span className="line-clamp-1">{namesOf(row)}</span> },
          { key: "planned", header: "План", numeric: true, cell: (row: RecordRow) => (row.plannedTotal !== null ? formatQuantity(row.plannedTotal, row.unit ?? undefined) : `${row.plannedCount} поз.`) },
          { key: "actual", header: "Факт", numeric: true, cell: (row: RecordRow) => (row.actualTotal !== null ? formatQuantity(row.actualTotal, row.unit ?? undefined) : `${row.doneCount} из ${row.plannedCount} поз.`) },
        ]
      : [{ key: "positions", header: "Позиций", numeric: true, cell: (row: RecordRow) => row.lines.length }]),
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  const unfiltered = tab === "all" && !search.trim()
  const createButton = (variant: "primary" | "secondary") =>
    canEdit ? (
      <Button variant={variant} onClick={() => void create()} disabled={creating || !target.restaurantExternalId}>
        {variant === "primary" ? <Plus aria-hidden /> : null}
        {creating ? "Создание…" : variant === "primary" ? config.createLabel : "Создать по прогнозу"}
      </Button>
    ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-muted-foreground">
          {sheet ? "Потребность в заготовках по прогнозу блюд и техкартам, минус остаток ресторана." : "План приготовления на день из прогноза продаж — одной кнопкой."}
        </p>
        {createButton("primary")}
      </div>
      {error ? (
        <Banner tone="danger" title="Не удалось выполнить действие">
          {error}
        </Banner>
      ) : null}
      <FilterTabs aria-label="Статус записей" value={tab} onValueChange={(value) => setTab(value as typeof tab)} items={config.tabs} panelId={panelId} />
      <ForecastPanel moduleId={config.moduleId} target={target} />
      {sheet && target.restaurantExternalId ? <RequirementPanel requirement={requirement} targetDate={target.targetDate} onOpen={open} action={requirement && !requirement.sheet && requirement.lines.length ? createButton("secondary") : null} /> : null}
      <div id={panelId} role="tabpanel" aria-label={config.tabs.find((candidate) => candidate.value === tab)?.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input type="search" aria-label="Поиск" placeholder={config.searchPlaceholder} className="w-full sm:w-[420px]" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
          {list.status !== "LoadingFirstPage" ? <span className="text-body-sm text-muted-foreground">{recordCount(list.results.length)}</span> : null}
        </div>
        {list.status === "LoadingFirstPage" ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <OfficeStatePage state={{ kind: "empty", description: sheet ? "Создайте ведомость по прогнозу выбранного дня." : "Создайте план по прогнозу выбранного дня.", action: createButton("secondary") ?? undefined }} />
        ) : (
          <DataTable
            caption={config.title}
            columns={columns}
            rows={list.results}
            getRowId={(row) => row.externalId}
            onRowClick={(row) => open(row.externalId)}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
            loadMore={loadMoreFromPaginated(list, LOGISTICS_PAGE_SIZE)}
          />
        )}
      </div>
    </div>
  )
}

function namesOf(row: RecordRow) {
  const names = row.lines.map((line) => line.name)
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} и ещё ${names.length - 2}` : names.join(", ") || "—"
}

type RequirementLine = Requirement["lines"][number]

/** «Потребность в заготовках» of the chosen day, live: the forecast × recipes − stock, and today's fact. */
function RequirementPanel({ requirement, targetDate, onOpen, action }: { requirement: Requirement | undefined; targetDate: string; onOpen: (externalId: string) => void; action: ReactNode }) {
  const columns: Column<RequirementLine>[] = [
    {
      key: "name",
      header: "Заготовка",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-medium">{row.name}</span>
          {row.usedBy.length ? <span className="text-caption text-muted-foreground">Для: {row.usedBy.join(", ")}</span> : null}
        </div>
      ),
    },
    { key: "need", header: "Потребность", numeric: true, cell: (row) => formatQuantity(row.forecastQuantity, row.unit ?? undefined) },
    { key: "onHand", header: "Остаток", numeric: true, cell: (row) => formatQuantity(row.onHand, row.unit ?? undefined) },
    { key: "planned", header: "План", numeric: true, cell: (row) => <span className="font-semibold">{formatQuantity(row.plannedQuantity, row.unit ?? undefined)}</span> },
    { key: "actual", header: "Факт", numeric: true, cell: (row) => formatQuantity(row.actualQuantity, row.unit ?? undefined) },
    { key: "method", header: "Выпуск", cell: (row) => (row.canProduce ? "Актом приготовления" : <span className="text-muted-foreground">Готовится по составу</span>) },
  ]
  return (
    <section aria-label="Потребность в заготовках" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-title-sm font-semibold">Потребность в заготовках на {formatBusinessDate(targetDate)}</h3>
          <p className="text-body-sm text-muted-foreground">План = потребность по прогнозу − остаток ресторана; факт — проведённые акты приготовления за дату.</p>
        </div>
        {requirement?.sheet ? (
          <Button variant="secondary" onClick={() => onOpen(requirement.sheet!.externalId)}>
            Открыть ведомость {requirement.sheet.number}
          </Button>
        ) : (
          action
        )}
      </div>
      {requirement?.dishesWithoutRecipe.length ? (
        <Banner tone="warning" title="Нет действующей техкарты">
          {requirement.dishesWithoutRecipe.slice(0, 5).join(", ")}
          {requirement.dishesWithoutRecipe.length > 5 ? ` и ещё ${requirement.dishesWithoutRecipe.length - 5}` : ""} — их заготовки в потребность не попали.
        </Banner>
      ) : null}
      {requirement === undefined ? (
        <Skeleton className="h-32 w-full" />
      ) : requirement.lines.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{requirement.forecast.products.length ? "Блюдам из прогноза не нужны заготовки — в их техкартах нет полуфабрикатов." : "Прогноз пуст — потребности нет."}</p>
      ) : (
        <DataTable caption="Потребность в заготовках" columns={columns} rows={requirement.lines} getRowId={(row) => row.productExternalId} />
      )}
    </section>
  )
}
