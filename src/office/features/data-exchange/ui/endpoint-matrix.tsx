import { useState } from "react"

import { DataTable, loadMoreFromPaginated, Select, TonePill, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"

import { ENDPOINT_PAGE_SIZE, useEndpointStates, type EndpointState } from "../data/use-iiko"
import { CLASSIFICATION, ENDPOINT_DOMAINS, KNOWN_ENDPOINTS, LAST_STATUS } from "../model/endpoints"
import { Panel } from "./panel"

const ALL = "all"

const DOMAIN_OPTIONS = [{ value: ALL, label: "Все домены" }, ...ENDPOINT_DOMAINS]

const COLUMNS: Column<EndpointState>[] = [
  { key: "method", header: "Метод", cell: (row) => <span className="font-semibold">{row.method ?? "GET"}</span> },
  { key: "path", header: "Путь", cell: (row) => <code className="font-mono text-caption break-all text-foreground">{row.path ?? row.endpointKey}</code> },
  { key: "operation", header: "Операция", cell: (row) => KNOWN_ENDPOINTS[row.endpointKey]?.operation ?? "—" },
  {
    key: "status",
    header: "Статус",
    cell: (row) => {
      const classification = CLASSIFICATION[row.classification ?? "mirrored"] ?? { label: row.classification, tone: "neutral" as const }
      const last = LAST_STATUS[row.lastStatus]
      return (
        <div className="flex min-w-48 flex-col gap-1">
          <div className="flex flex-wrap gap-1">
            <TonePill tone={classification.tone}>{classification.label}</TonePill>
            {row.lastStatus !== "ok" && last ? <TonePill tone={last.tone}>{last.label}</TonePill> : null}
          </div>
          <span className="text-caption text-muted-foreground">{formatAlmatyDateTime(row.lastRunAt)}</span>
          {row.message ? <span className="text-caption text-muted-foreground">{row.message}</span> : null}
        </div>
      )
    },
  },
  {
    key: "target",
    header: "Convex / UI",
    cell: (row) => {
      const known = KNOWN_ENDPOINTS[row.endpointKey]
      if (!known) return <span className="text-muted-foreground">—</span>
      return (
        <div className="flex flex-col">
          <code className="font-mono text-caption text-foreground">{known.target}</code>
          <span className="text-caption text-muted-foreground">{known.ui}</span>
        </div>
      )
    },
  },
  { key: "records", header: "Записей", numeric: true, cell: (row) => row.recordCount ?? "—" },
]

/** «Матрица endpoint parity»: one row per iiko Server API method known to the mirror, paginated on the server. */
export function EndpointMatrix({ total }: { total: number }) {
  const [domain, setDomain] = useState(ALL)
  const list = useEndpointStates(domain === ALL ? undefined : domain)
  const loading = list.status === "LoadingFirstPage"

  return (
    <Panel title="Матрица endpoint parity" description="Каждый метод iiko Server API, который читает зеркало, представлен одной строкой. Все методы — только чтение (GET)">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Select aria-label="Домен" className="w-full sm:w-56" value={domain} onValueChange={setDomain} options={DOMAIN_OPTIONS} />
        <span className="text-caption text-muted-foreground">{loading ? "" : domain === ALL ? `Показано ${list.results.length} из ${Math.max(total, list.results.length)}` : `Показано ${list.results.length}`}</span>
      </div>
      <DataTable
        caption="Матрица endpoint parity"
        className="rounded-none border-0"
        columns={COLUMNS}
        rows={loading ? undefined : list.results}
        getRowId={(row) => row.endpointKey}
        empty={
          <p className="px-4 py-10 text-center text-body-sm text-muted-foreground">
            {domain === ALL ? "Эндпоинтов пока нет — они появятся после первого импорта" : "В этом домене эндпоинтов нет"}
          </p>
        }
        loadMore={loadMoreFromPaginated(list, ENDPOINT_PAGE_SIZE)}
      />
    </Panel>
  )
}
