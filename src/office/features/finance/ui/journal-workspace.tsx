import { Plus } from "lucide-react"
import { useId, useMemo, useState } from "react"
import { Link } from "react-router"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Banner, Button, Combobox, DataTable, EmptyState, FilterTabs, Input, loadMoreFromPaginated, Select, StatusPill, TonePill, type Column } from "@/shared/components/ui"
import { formatAmount } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import {
  FINANCE_PAGE_SIZE,
  useFinanceOverview,
  useFinanceRecord,
  useFinanceRecords,
  useFinanceReferences,
  useFinanceRestaurantFilter,
  useJournal,
  type FinanceRecord,
  type FinanceReferences,
  type JournalRow,
} from "../data/use-finance-records"
import { accountLabel, DOCUMENT_TABS, formatBusinessDate, JOURNAL_SOURCES, last30Days, sourceHref, sourceLabel } from "../model/modules"
import { FinanceKpi } from "./finance-kpi"
import { TransactionPanel } from "./transaction-panel"

const MODULE = "transactions"
const ALL = "all"
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** «Проводки» (/office/transactions/:id?, W1-FIN-05): the whole journal — system and manual lines — with KPI. */
export function TransactionsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Transactions />
    </PlatformErrorBoundary>
  )
}

const linkClass = cn("rounded-control text-accent underline-offset-4 hover:underline", focusRingClass)

function Transactions() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const selection = useMasterSelection(MODULE)
  const references = useFinanceReferences(MODULE)
  const record = useFinanceRecord(MODULE, selection.selectedId)
  const restaurants = useFinanceRestaurantFilter()
  const panelId = useId()
  const [tab, setTab] = useState("all")
  const [period, setPeriod] = useState(() => last30Days())
  const [account, setAccount] = useState(ALL)
  const [source, setSource] = useState(ALL)
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)

  const periodValid = DATE.test(period.from) && DATE.test(period.to) && period.from <= period.to
  const defaultPeriod = last30Days()
  const is30Days = period.from === defaultPeriod.from && period.to === defaultPeriod.to
  const filter = periodValid && !restaurants.loading ? { from: period.from, to: period.to, ...(restaurants.restaurantExternalId ? { restaurantExternalId: restaurants.restaurantExternalId } : {}) } : null
  const accountExternalId = account === ALL ? undefined : account
  const overview = useFinanceOverview(filter ? { ...filter, ...(accountExternalId ? { accountExternalId } : {}) } : null)
  const drafts = tab === "draft"
  const journal = useJournal(filter && !drafts ? { ...filter, ...(accountExternalId ? { accountExternalId } : {}), ...(source !== ALL ? { sourceModuleId: source } : {}) } : null)
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const accountOptions = [{ value: ALL, label: "Все счета" }, ...(references?.accounts ?? []).map((row) => ({ value: row.externalId, label: `${row.code} · ${row.name}` }))]
  const sourceOptions = [{ value: ALL, label: "Все источники" }, ...Object.entries(JOURNAL_SOURCES).map(([value, entry]) => ({ value, label: entry.label }))]

  // Journal lines are immutable: «Сторно» are the reversal lines, «Проведённые» everything else.
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru")
    return journal.results.filter((row) => {
      if (tab === "posted" && row.reversalOf) return false
      if (tab === "reversed" && !row.reversalOf) return false
      if (!query) return true
      return [row.sourceNumber, row.description, row.debitAccount?.code, row.debitAccount?.name, row.creditAccount?.code, row.creditAccount?.name, sourceLabel(row.sourceModuleId)].join(" ").toLocaleLowerCase("ru").includes(query)
    })
  }, [journal.results, tab, search])

  const columns: Column<JournalRow>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.sourceNumber || "—"}</span> },
    { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatBusinessDate(row.businessDate)}</span>, sortValue: (row) => row.businessDate },
    { key: "debit", header: "Дебет", cell: (row) => accountLabel(row.debitAccount) },
    { key: "credit", header: "Кредит", cell: (row) => accountLabel(row.creditAccount) },
    { key: "amount", header: "Сумма, ₸", numeric: true, cell: (row) => formatAmount(row.amount), sortValue: (row) => row.amount },
    {
      key: "source",
      header: "Источник",
      cell: (row) => {
        const href = sourceHref(row)
        return (
          <div className="flex min-w-0 flex-col">
            {href ? (
              <Link to={href} className={linkClass}>
                {sourceLabel(row.sourceModuleId)}
              </Link>
            ) : (
              <span>{sourceLabel(row.sourceModuleId)}</span>
            )}
            <span className="truncate text-caption text-muted-foreground">{row.description}</span>
          </div>
        )
      },
    },
    { key: "status", header: "Статус", cell: (row) => (row.reversalOf ? <TonePill tone="danger">Сторно</TonePill> : <StatusPill domain="document" status="posted" />) },
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-body-sm font-medium">
              С
              <Input type="date" aria-label="Период с" className="w-44" value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} />
            </label>
            <label className="flex flex-col gap-1.5 text-body-sm font-medium">
              По
              <Input type="date" aria-label="Период по" className="w-44" value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} />
            </label>
            {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
            <Combobox aria-label="Счёт" className="w-full sm:w-64" value={account} onValueChange={(value) => setAccount(value || ALL)} options={accountOptions} searchPlaceholder="Код или название счёта" />
            <Select aria-label="Источник" className="w-full sm:w-56" value={source} onValueChange={setSource} options={sourceOptions} />
          </div>
          {canEdit ? (
            <Button variant={formOpen ? "secondary" : "primary"} onClick={selection.openNew}>
              <Plus aria-hidden />
              Новая операция
            </Button>
          ) : null}
        </div>

        {periodValid ? (
          <FinanceKpi overview={overview} last30Days={is30Days} sourceFiltered={source !== ALL} />
        ) : (
          <Banner tone="warning" title="Укажите период">
            Дата начала не может быть позже даты окончания.
          </Banner>
        )}

        <FilterTabs aria-label="Статус проводок" value={tab} onValueChange={setTab} items={DOCUMENT_TABS.map(({ value, label }) => ({ value, label }))} panelId={panelId} />
        <div id={panelId} role="tabpanel" aria-label={DOCUMENT_TABS.find((candidate) => candidate.value === tab)?.label} className="flex flex-col gap-4">
          <Input type="search" aria-label="Поиск" placeholder="Поиск: проводки" className="w-full sm:w-[420px]" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
          {drafts ? (
            <DraftOperations search={search} restaurantExternalId={restaurants.restaurantExternalId} references={references} selectedId={selection.selectedId} onSelect={selection.select} />
          ) : !periodValid ? null : journal.status === "LoadingFirstPage" ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : (
            <>
              <p className="text-caption text-muted-foreground">{rows.length} записей</p>
              <DataTable
                caption="Журнал проводок"
                columns={columns}
                rows={rows}
                getRowId={(row) => row._id}
                empty={
                  <EmptyState
                    title="Проводок нет"
                    description={journal.results.length ? "Ничего не найдено по выбранным фильтрам." : "За выбранный период в журнале нет строк. Измените период или фильтры."}
                  />
                }
                loadMore={loadMoreFromPaginated(journal, FINANCE_PAGE_SIZE)}
              />
            </>
          )}
        </div>
      </div>
      {selection.isNew && canEdit && references ? (
        <TransactionPanel key="new" record={null} references={references} defaultRestaurantExternalId={restaurants.restaurantExternalId} onClose={selection.close} onSaved={selection.select} />
      ) : null}
      {selection.selectedId !== null && record && references ? <TransactionPanel key={record.externalId} record={record} references={references} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && (!record || !references) ? (
        <RightPanel
          open
          onOpenChange={(next) => {
            if (!next) selection.close()
          }}
          title="Проводка"
        >
          {record === null ? <EmptyState title="Операция не найдена" description="Возможно, она относится к ресторану вне вашего доступа или ссылка устарела." /> : <OfficeStatePage state={{ kind: "loading" }} />}
        </RightPanel>
      ) : null}
    </div>
  )
}

/** «Черновики»: manual operations not posted yet — they have no journal line. */
function DraftOperations({
  search,
  restaurantExternalId,
  references,
  selectedId,
  onSelect,
}: {
  search: string
  restaurantExternalId?: string
  references: FinanceReferences | undefined
  selectedId: string | null
  onSelect: (externalId: string) => void
}) {
  const list = useFinanceRecords(MODULE, { status: "draft", search, restaurantExternalId })
  const account = (externalId: string | undefined) => {
    const row = references?.accounts.find((candidate) => candidate.externalId === externalId)
    return row ? `${row.code} · ${row.name}` : "—"
  }
  const columns: Column<FinanceRecord>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatBusinessDate(row.businessDate)}</span> },
    { key: "debit", header: "Дебет", cell: (row) => account(row.debitAccountExternalId) },
    { key: "credit", header: "Кредит", cell: (row) => account(row.creditAccountExternalId) },
    { key: "amount", header: "Сумма, ₸", numeric: true, cell: (row) => formatAmount(row.amount) },
    {
      key: "source",
      header: "Источник",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span>{sourceLabel(MODULE)}</span>
          <span className="truncate text-caption text-muted-foreground">{row.name}</span>
        </div>
      ),
    },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]
  if (list.status === "LoadingFirstPage") return <OfficeStatePage state={{ kind: "loading" }} />
  return (
    <>
      <p className="text-caption text-muted-foreground">{list.results.length} записей</p>
      <DataTable
        caption="Черновики ручных операций"
        columns={columns}
        rows={list.results}
        getRowId={(row) => row.externalId}
        selectedId={selectedId}
        onRowClick={(row) => onSelect(row.externalId)}
        empty={<EmptyState title="Черновиков нет" description="Ручная операция попадает сюда, пока её не провели." />}
        loadMore={loadMoreFromPaginated(list, FINANCE_PAGE_SIZE)}
      />
    </>
  )
}
