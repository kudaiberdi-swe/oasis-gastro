import { Check, Copy, DatabaseZap } from "lucide-react"
import { useEffect, useState } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { Banner, Button, DataTable, KpiCard, StatusPill, TonePill, useToast, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { cn } from "@/shared/lib/utils"

import { IIKO_SEED_COMMAND, useIntegrationOverview, type ImportRun } from "../data/use-iiko"
import { endpointLabel } from "../model/endpoints"
import { EndpointMatrix } from "./endpoint-matrix"
import { Panel } from "./panel"
import { PosAccessPanel } from "./pos-access-panel"
import { RestaurantLinks } from "./restaurant-links"

// «Обмен между точками / паритет iiko» (/office/data-exchange, W1-IIKO-07, OFFICE-DESIGN §3.6).
// View and branch mapping only: there is no button that starts an import or calls iiko — the import runs
// from scripts/iiko on a trusted machine (docs/06-IIKO-RUNBOOK.md); the screen shows the command.

export function DataExchangeWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <DataExchangeContent />
    </PlatformErrorBoundary>
  )
}

function DataExchangeContent() {
  const overview = useIntegrationOverview()
  const canProvision = useCan("office.employees.edit")
  const lastRun = overview?.lastRun ?? null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="flex flex-col gap-5 px-6 py-5 xl:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="flex items-center gap-2 text-caption font-semibold text-accent">
              <DatabaseZap aria-hidden className="size-4" />
              iiko Server → Convex
            </p>
            <h2 className="font-display text-title font-semibold text-foreground">Репликация и покрытие API</h2>
            <p className="text-body-sm text-muted-foreground">Ручное одностороннее зеркало. Изменяющие методы iiko заблокированы политикой интеграции.</p>
          </div>
          {overview === undefined ? null : lastRun ? (
            <div className="flex items-center gap-2">
              <span className="text-caption text-muted-foreground">Последний импорт</span>
              <StatusPill domain="job" status={lastRun.status} />
            </div>
          ) : (
            <TonePill tone="warning">Импорт ещё не выполнялся</TonePill>
          )}
        </div>

        {overview === undefined ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Операций Server API" value={overview.kpis.operations} />
              <KpiCard label="Зеркалируется" value={overview.kpis.mirrored} />
              <KpiCard label="Заблокировано one-way" value={overview.kpis.blockedOneWay} />
              <KpiCard label="Записей последнего запуска" value={overview.kpis.lastRunRecords} />
            </div>

            <LastRunPanel lastRun={lastRun} runs={overview.runs} />
            <RestaurantLinks />
            {canProvision ? <PosAccessPanel /> : null}
            <EndpointMatrix total={overview.kpis.operations} />
          </>
        )}
      </div>
    </div>
  )
}

// ── «Последний запуск» ─────────────────────────────────────────────────────────────────────────────

const COUNT_LABELS: Record<string, string> = { departments: "Подразделения", employees: "Сотрудники" }

function runRecords(run: ImportRun) {
  const byEndpoint = Object.values(run.countsByEndpoint ?? {}).reduce((sum, value) => sum + value, 0)
  return byEndpoint || (run.counts ? run.counts.departments + run.counts.employees : 0)
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} с`
  const minutes = Math.floor(seconds / 60)
  return seconds % 60 ? `${minutes} мин ${seconds % 60} с` : `${minutes} мин`
}

const RUN_COLUMNS: Column<ImportRun>[] = [
  { key: "startedAt", header: "Начат", cell: (run) => formatAlmatyDateTime(run.startedAt) },
  { key: "duration", header: "Длительность", cell: (run) => (run.completedAt ? formatDuration(run.completedAt - run.startedAt) : "—") },
  { key: "status", header: "Статус", cell: (run) => <StatusPill domain="job" status={run.status} /> },
  { key: "records", header: "Записей", numeric: true, cell: (run) => runRecords(run) },
]

function LastRunPanel({ lastRun, runs }: { lastRun: ImportRun | null; runs: ImportRun[] }) {
  if (!lastRun) {
    return (
      <Panel title="Последний запуск" description="Время запуска, счётчики по эндпоинтам и ошибки импорта">
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <p className="text-body-sm text-muted-foreground">Запустите импорт на доверенной машине с доступом к iiko. С этого экрана импорт не запускается.</p>
          <CommandBlock className="w-full max-w-xl" />
        </div>
      </Panel>
    )
  }

  const counts = Object.entries(lastRun.countsByEndpoint ?? {}).map(([key, value]) => ({ key, label: endpointLabel(key), value }))
  if (counts.length === 0 && lastRun.counts) for (const [key, value] of Object.entries(lastRun.counts)) counts.push({ key, label: COUNT_LABELS[key] ?? key, value })

  return (
    <Panel title="Последний запуск" description="Время запуска, счётчики по эндпоинтам и ошибки импорта">
      <div className="flex flex-col gap-4 p-4">
        {lastRun.error ? (
          <Banner tone="danger" title="Импорт завершился с ошибкой">
            {lastRun.error}
          </Banner>
        ) : null}
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Info label="Запуск" value={<code className="font-mono text-caption break-all">{lastRun.runExternalId}</code>} />
          <Info label="Начат" value={formatAlmatyDateTime(lastRun.startedAt)} />
          <Info label="Завершён" value={lastRun.completedAt ? formatAlmatyDateTime(lastRun.completedAt) : lastRun.status === "running" ? "Выполняется" : "—"} />
          <Info label="Длительность" value={lastRun.completedAt ? formatDuration(lastRun.completedAt - lastRun.startedAt) : "—"} />
        </dl>

        <div className="flex flex-col gap-2">
          <h3 className="text-body-sm font-semibold text-foreground">Записей по эндпоинтам</h3>
          {counts.length ? (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Записей по эндпоинтам">
              {counts.map((count) => (
                <li key={count.key} className="flex items-center justify-between gap-3 rounded-card border border-border px-3 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body-sm text-foreground">{count.label}</span>
                    {count.label !== count.key ? <code className="truncate font-mono text-caption text-muted-foreground">{count.key}</code> : null}
                  </span>
                  <span className="text-body-sm font-semibold tabular-nums text-foreground">{count.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-sm text-muted-foreground">Счётчиков нет.</p>
          )}
          <p className="text-caption text-muted-foreground">Причины пропуска записей — в столбце «Статус» матрицы ниже.</p>
        </div>

        {runs.length > 1 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-body-sm font-semibold text-foreground">Последние запуски</h3>
            <DataTable caption="Последние запуски" columns={RUN_COLUMNS} rows={runs} getRowId={(run) => run._id} />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted-foreground">Обновить зеркало — на доверенной машине с доступом к iiko:</p>
          <CommandBlock />
        </div>
      </div>
    </Panel>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card bg-muted px-3 py-2">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-body-sm font-semibold text-foreground">{value}</dd>
    </div>
  )
}

/** The import command in a code block with «Скопировать» — shown, never executed from the browser. */
function CommandBlock({ className }: { className?: string }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(IIKO_SEED_COMMAND)
      setCopied(true)
      toast("Команда скопирована", "success")
    } catch {
      toast("Не удалось скопировать — выделите команду вручную", "error")
    }
  }

  return (
    <div className={cn("flex items-center gap-3 rounded-card border border-border bg-muted py-2 pr-2 pl-3 text-left", className)}>
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-body-sm whitespace-nowrap text-foreground">{IIKO_SEED_COMMAND}</code>
      <Button size="sm" variant="secondary" onClick={() => void copy()}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Скопировано" : "Скопировать"}
      </Button>
    </div>
  )
}
