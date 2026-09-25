import { RotateCcw, X } from "lucide-react"
import { useId, useMemo, useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { Banner, Button, ConfirmDialog, DataTable, FilterTabs, loadMoreFromPaginated, Select, SkeletonRows, StatusPill, TonePill, useToast, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"

import { JOB_PAGE_SIZE, useIntegrationJob, useIntegrationJobMutations, useIntegrationJobs, useJobTabCounts, type IntegrationJobDetails, type IntegrationJobRow } from "../data/use-integration-jobs"
import { canCancelJob, canRetryJob, JOB_DIRECTION_LABELS, JOB_TABS, KNOWN_PROVIDERS, matchesSearch, providerLabel, type JobTab } from "../model/corporation"
import { Facts, SearchBox, WithErrorBoundary } from "./corporation-parts"

const ALL = "all"
/** Attempts before a job goes to dead-letter (convex/domains/integrations/internal.ts MAX_JOB_ATTEMPTS). */
const MAX_ATTEMPTS = 5

type Direction = "all" | "inbound" | "outbound"

const DIRECTION_OPTIONS: { value: Direction; label: string }[] = [
  { value: "all", label: "Все направления" },
  { value: "outbound", label: "Исходящие" },
  { value: "inbound", label: "Входящие" },
]

const COLUMNS: Column<IntegrationJobRow>[] = [
  {
    key: "provider",
    header: "Провайдер",
    cell: (row) => (
      <span className="font-semibold" title={row.provider}>
        {providerLabel(row.provider)}
      </span>
    ),
    sortValue: (row) => providerLabel(row.provider),
  },
  { key: "direction", header: "Направление", cell: (row) => JOB_DIRECTION_LABELS[row.direction] },
  { key: "operation", header: "Операция", cell: (row) => <span className="font-medium">{row.operation}</span>, sortValue: (row) => row.operation },
  {
    key: "key",
    header: "Ключ / ошибка",
    cell: (row) =>
      row.error ? (
        <span className="line-clamp-2 max-w-72 text-caption text-destructive" title={row.error}>
          {row.error}
        </span>
      ) : (
        <span className="block max-w-72 truncate font-mono text-caption text-muted-foreground" title={row.idempotencyKey}>
          {row.idempotencyKey}
        </span>
      ),
  },
  { key: "attempts", header: "Попытки", numeric: true, cell: (row) => row.attempts, sortValue: (row) => row.attempts },
  { key: "status", header: "Статус", cell: (row) => <StatusPill domain="job" status={row.status} /> },
  {
    key: "time",
    header: "Время",
    numeric: true,
    cell: (row) => <span className="whitespace-nowrap text-muted-foreground">{formatAlmatyDateTime(row.updatedAt)}</span>,
    sortValue: (row) => row.updatedAt,
  },
]

/** «Очередь интеграций» (/office/integration-jobs, W2-ADM-09): Register template, job card in the side panel. */
export function IntegrationJobsWorkspace() {
  return <WithErrorBoundary>{() => <IntegrationJobsContent />}</WithErrorBoundary>
}

function IntegrationJobsContent() {
  const [tab, setTab] = useState<JobTab>("all")
  const [provider, setProvider] = useState(ALL)
  const [direction, setDirection] = useState<Direction>("all")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const panelId = useId()
  const providerArg = provider === ALL ? undefined : provider
  const list = useIntegrationJobs({ status: tab === "all" ? undefined : tab, provider: providerArg })
  const counts = useJobTabCounts(providerArg)
  const loading = list.status === "LoadingFirstPage"
  // Search and direction filter the loaded pages (the server filters by status and provider).
  const rows = useMemo(
    () => list.results.filter((job) => (direction === "all" || job.direction === direction) && matchesSearch(search, job.idempotencyKey, job.error, job.operation, job.sourceExternalId, job.externalId)),
    [list.results, direction, search],
  )
  const providers = useMemo(() => [...new Set([...KNOWN_PROVIDERS, ...list.results.map((job) => job.provider), ...(providerArg ? [providerArg] : [])])], [list.results, providerArg])
  const selected = selectedId ? list.results.find((job) => job.externalId === selectedId) : undefined

  const tabs = JOB_TABS.map((item) => {
    const counter = item.value === "all" ? (loading ? undefined : { count: list.results.length, more: list.status !== "Exhausted" }) : counts[item.value]
    return {
      value: item.value,
      label: (
        <>
          {item.label}
          {counter ? <span className="text-muted-foreground tabular-nums">{counter.more ? `${counter.count}+` : counter.count}</span> : null}
        </>
      ),
    }
  })

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          <TonePill tone="success">Adapter runtime</TonePill>
          <span>Задания обрабатываются по расписанию; iiko только читается и из очереди не вызывается.</span>
        </div>
        <FilterTabs aria-label="Статус задания" value={tab} onValueChange={(value) => setTab(value as JobTab)} items={tabs} panelId={panelId} className="overflow-x-auto" />
        <div id={panelId} role="tabpanel" aria-label={JOB_TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox label="Поиск заданий" placeholder="Ключ, операция или текст ошибки" value={search} onChange={setSearch} />
            <Select
              aria-label="Провайдер"
              className="w-full sm:w-56"
              value={provider}
              onValueChange={setProvider}
              options={[{ value: ALL, label: "Все провайдеры" }, ...providers.map((value) => ({ value, label: providerLabel(value) }))]}
            />
            <Select aria-label="Направление" className="w-full sm:w-48" value={direction} onValueChange={(value) => setDirection(value as Direction)} options={DIRECTION_OPTIONS} />
          </div>
          {loading ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : list.results.length === 0 && list.status === "Exhausted" && tab === "all" && provider === ALL ? (
            <OfficeStatePage state={{ kind: "empty", title: "Заданий пока нет", description: "Здесь появятся исходящие и входящие задания обмена." }} />
          ) : (
            <DataTable
              caption="Очередь интеграций"
              columns={COLUMNS}
              rows={rows}
              getRowId={(row) => row.externalId}
              onRowClick={(row) => setSelectedId(row.externalId)}
              selectedId={selectedId}
              empty={
                <p className="px-4 py-10 text-center text-body-sm text-muted-foreground">
                  {list.status === "CanLoadMore" ? "На загруженных страницах заданий нет — покажите ещё" : "Нет заданий по выбранным фильтрам"}
                </p>
              }
              loadMore={loadMoreFromPaginated(list, JOB_PAGE_SIZE)}
            />
          )}
        </div>
      </div>
      {/* The card stays open after «Повторить» even when the job leaves the current tab. */}
      <JobPanel key={selectedId ?? "none"} externalId={selectedId} row={selected} onClose={() => setSelectedId(null)} />
    </div>
  )
}

function JobPanel({ externalId, row, onClose }: { externalId: string | null; row: IntegrationJobRow | undefined; onClose: () => void }) {
  const canEdit = useCan("office.integration-jobs.edit")
  const details = useIntegrationJob(externalId)
  const { retryIntegrationJob, cancelIntegrationJob } = useIntegrationJobMutations()
  const toast = useToast()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The list row is live; the card falls back to it until the masked details arrive.
  const status = details?.status ?? row?.status
  const showRetry = canEdit && status !== undefined && canRetryJob(status)
  const showCancel = canEdit && status !== undefined && canCancelJob(status)

  async function run(action: "retry" | "cancel") {
    if (!externalId) return
    setBusy(true)
    setError(null)
    try {
      if (action === "retry") {
        await retryIntegrationJob({ externalId })
        toast("Задание отправлено на повтор", "success")
      } else {
        await cancelIntegrationJob({ externalId })
        toast("Задание отменено", "success")
        setConfirmCancel(false)
      }
    } catch (caught) {
      setError(errorMessage(caught, action === "retry" ? "Не удалось повторить задание" : "Не удалось отменить задание"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <RightPanel
      open={externalId !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null)
          onClose()
        }
      }}
      title={(details ?? row) ? `${providerLabel((details ?? row)!.provider)} · ${(details ?? row)!.operation}` : "Задание"}
      footer={
        showRetry || showCancel ? (
          <>
            {showCancel ? (
              <Button variant="danger" disabled={busy} onClick={() => setConfirmCancel(true)}>
                <X aria-hidden />
                Отменить
              </Button>
            ) : null}
            {showRetry ? (
              <Button disabled={busy} onClick={() => void run("retry")}>
                <RotateCcw aria-hidden />
                Повторить
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {error && !confirmCancel ? (
        <div className="mb-4">
          <Banner tone="danger" title="Действие не выполнено">
            {error}
          </Banner>
        </div>
      ) : null}
      {details === undefined && externalId ? (
        <SkeletonRows rows={6} />
      ) : details === null ? (
        <p className="text-body-sm text-muted-foreground">Задание не найдено или недоступно.</p>
      ) : details ? (
        <JobDetails job={details} />
      ) : null}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setConfirmCancel(false)
            setError(null)
          }
        }}
        title="Отменить задание?"
        description="Задание не будет отправлено. Его можно будет вернуть в очередь повтором."
        confirmLabel="Отменить задание"
        cancelLabel="Не отменять"
        submitting={busy}
        error={confirmCancel ? error : null}
        onConfirm={() => run("cancel")}
      />
    </RightPanel>
  )
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h3 className="text-body-sm font-semibold text-foreground">{label}</h3>
      {value === undefined || value === null ? (
        <p className="text-body-sm text-muted-foreground">—</p>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-card border border-border bg-muted p-3 text-caption break-words whitespace-pre-wrap text-foreground">{JSON.stringify(value, null, 2)}</pre>
      )}
    </section>
  )
}

export function JobDetails({ job }: { job: IntegrationJobDetails }) {
  const waiting = job.status === "queued" || job.status === "retrying"
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <StatusPill domain="job" status={job.status} />
        <span className="text-caption text-muted-foreground">{JOB_DIRECTION_LABELS[job.direction]}</span>
      </div>
      <Facts
        items={[
          ["Провайдер", <span title={job.provider}>{providerLabel(job.provider)}</span>],
          ["Операция", job.operation],
          ["Ключ идемпотентности", <span className="font-mono text-caption break-all">{job.idempotencyKey}</span>],
          ...(job.sourceExternalId ? ([["Источник", <span className="break-all">{job.sourceExternalId}</span>]] as [string, ReactNode][]) : []),
          ["Создано", formatAlmatyDateTime(job.createdAt)],
        ]}
      />
      {job.error ? (
        <Banner tone="danger" title="Последняя ошибка">
          {job.error}
        </Banner>
      ) : null}
      <section aria-label="Попытки" className="flex flex-col gap-2">
        <h3 className="text-body-sm font-semibold text-foreground">Попытки</h3>
        <Facts
          items={[
            ["Выполнено", <span className="tabular-nums">{`${job.attempts} из ${MAX_ATTEMPTS}`}</span>],
            ["Последнее изменение", formatAlmatyDateTime(job.updatedAt)],
            ...(waiting ? ([["Следующая попытка", formatAlmatyDateTime(job.nextAttemptAt)]] as [string, ReactNode][]) : []),
          ]}
        />
      </section>
      <Json label="Данные задания" value={job.payload} />
      <Json label="Результат" value={job.result} />
      <p className="text-caption text-muted-foreground">Ключи с токенами, паролями и секретами скрыты сервером.</p>
    </div>
  )
}
