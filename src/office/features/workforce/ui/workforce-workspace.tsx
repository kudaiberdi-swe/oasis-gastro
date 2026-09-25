import { Plus, Search } from "lucide-react"
import { useId, useMemo, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { columnsFromConfig } from "@/office/engine/register-page"
import { statusTabs, type ColumnDef } from "@/office/engine/module-config"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import {
  Banner,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FilterTabs,
  Input,
  loadMoreFromPaginated,
  SegmentedControl,
  Select,
  type Column,
} from "@/shared/components/ui"

import {
  useEmployeesList,
  useUnprovisionedEmployees,
  useWorkforceBranches,
  useWorkforceMutations,
  WORKFORCE_PAGE_SIZE,
  type EmployeeRow,
  type UnprovisionedCandidate,
} from "../data/use-office-workforce"
import { useRestaurantFilter } from "../data/use-restaurant-filter"
import { formatRate, PAY_TYPE_LABEL, roleLabel } from "../model/modules"
import { CreateEmployeeDialog } from "./create-employee-dialog"
import { CredentialsResult } from "./credentials"
import { EmployeeEditor } from "./employee-editor"
import { ProvisionAccessFields, useProvisionAccessForm, type ProvisionAccessArgs } from "./provision-access-form"

// «Сотрудники» (W1-HR-01): /office/employees — the register (§3.5, lifecycle master) with the POS staff and
// the iiko candidates as a second level; /office/employees/:id — the HR card.

const CANDIDATE_LIMIT = 200

type View = "employees" | "iiko"

export function WorkforceWorkspace() {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={`${id ?? "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id ? <EmployeeEditor employeeId={id} /> : <EmployeesWorkspace />}
    </PlatformErrorBoundary>
  )
}

function EmployeesWorkspace() {
  const navigate = useNavigate()
  const canEdit = useCan("office.employees.edit")
  const [params, setParams] = useSearchParams()
  const view: View = params.get("view") === "iiko" ? "iiko" : "employees"
  const { candidates } = useUnprovisionedEmployees()
  const restaurants = useRestaurantFilter()
  const [creating, setCreating] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3 xl:px-8">
        <SegmentedControl
          aria-label="Список сотрудников"
          value={view}
          onValueChange={(next) => setParams(next === "iiko" ? { view: "iiko" } : {}, { replace: true })}
          options={[
            { value: "employees", label: "Сотрудники кассы" },
            { value: "iiko", label: `Из iiko${candidates.length ? ` (${candidates.length})` : ""}` },
          ]}
        />
        {canEdit ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            Новый сотрудник
          </Button>
        ) : null}
      </div>

      {view === "employees" ? <EmployeesRegister restaurants={restaurants} onCreate={canEdit ? () => setCreating(true) : undefined} /> : <CandidatesTab />}

      {creating ? (
        <CreateEmployeeDialog
          defaultRestaurantExternalId={restaurants.restaurantExternalId}
          onClose={() => setCreating(false)}
          onOpenCard={(employeeId) => navigate(`/office/employees/${employeeId}`)}
        />
      ) : null}
    </div>
  )
}

/** Columns per OFFICE-DESIGN §5 plus the POS code and role; the rate carries its unit (L-10). */
export const EMPLOYEE_COLUMNS: ColumnDef<EmployeeRow>[] = [
  { key: "personnelNumber", label: "Табельный №", kind: "text" },
  {
    key: "displayName",
    label: "ФИО",
    kind: "ref",
    display: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-foreground">{row.displayName}</span>
        {row.iikoEmployeeExternalId ? <span className="text-caption text-muted-foreground">из iiko</span> : null}
      </div>
    ),
  },
  { key: "positionExternalId", label: "Должность", kind: "text" },
  { key: "restaurants", label: "Ресторан", kind: "text", value: (row) => row.restaurants.map((restaurant) => restaurant.name).join(", ") },
  { key: "rate", label: "Ставка", kind: "text", value: (row) => formatRate(row.baseRate, row.payType) },
  { key: "payType", label: "Тип оплаты", kind: "text", value: (row) => (row.payType ? PAY_TYPE_LABEL[row.payType] : undefined) },
  { key: "code", label: "Код POS", kind: "text" },
  { key: "role", label: "Роль POS", kind: "text", value: (row) => roleLabel(row.role) },
  { key: "status", label: "Статус", kind: "status", value: (row) => (row.active ? "active" : "inactive") },
]

const MASTER_TABS = statusTabs("master")

function EmployeesRegister({ restaurants, onCreate }: { restaurants: ReturnType<typeof useRestaurantFilter>; onCreate?: () => void }) {
  const navigate = useNavigate()
  const panelId = useId()
  const [tab, setTab] = useState(MASTER_TABS[0].key)
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const status = tab === "active" || tab === "inactive" ? tab : undefined
  const list = useEmployeesList({ status, search, restaurantExternalId: restaurants.restaurantExternalId, enabled: !restaurants.loading })
  const columns = useMemo<Column<EmployeeRow>[]>(() => columnsFromConfig(EMPLOYEE_COLUMNS).map((column) => (column.key === "rate" || column.key === "code" ? { ...column, numeric: true } : column)), [])
  const loading = list.status === "LoadingFirstPage"
  const unfiltered = tab === "all" && !search.trim() && !restaurants.restaurantExternalId

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <FilterTabs aria-label="Статус сотрудников" value={tab} onValueChange={setTab} panelId={panelId} items={MASTER_TABS.map((item) => ({ value: item.key, label: item.label }))} />
      <div id={panelId} role="tabpanel" aria-label={MASTER_TABS.find((item) => item.key === tab)?.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative w-full sm:w-[420px]">
            <span className="sr-only">Поиск: сотрудники</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Поиск: ФИО, код или табельный №" className="pl-9" />
          </label>
          {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
          <span className="ml-auto text-caption text-muted-foreground">{loading ? "" : `${list.results.length} записей`}</span>
        </div>
        {loading ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <OfficeStatePage
            state={{
              kind: "empty",
              title: "Сотрудников пока нет",
              description: "Создайте сотрудника кассы или подключите его из iiko.",
              action: onCreate ? (
                <Button variant="secondary" onClick={onCreate}>
                  Новый сотрудник
                </Button>
              ) : undefined,
            }}
          />
        ) : (
          <DataTable
            caption="Сотрудники"
            columns={columns}
            rows={list.results}
            getRowId={(row) => row._id}
            onRowClick={(row) => navigate(`/office/employees/${row._id}`)}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
            loadMore={loadMoreFromPaginated(list, WORKFORCE_PAGE_SIZE)}
          />
        )}
      </div>
    </div>
  )
}

// ── «Из iiko»: provisioning POS access for imported iiko employees (unchanged flow) ─────────────

function CandidatesTab() {
  const { candidates, loading } = useUnprovisionedEmployees()
  const branches = useWorkforceBranches()
  const { provisionPosAccess } = useWorkforceMutations()
  const canEdit = useCan("office.employees.edit")
  const [provisioning, setProvisioning] = useState<UnprovisionedCandidate | null>(null)
  const [query, setQuery] = useState("")

  const filtered = query.trim()
    ? candidates.filter((candidate) => candidate.displayName.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")))
    : candidates

  const columns: Column<UnprovisionedCandidate>[] = [
    { key: "name", header: "Имя (из iiko)", cell: (candidate) => <span className="font-semibold text-foreground">{candidate.displayName}</span> },
    { key: "code", header: "Табельный №", cell: (candidate) => <span className="text-muted-foreground tabular-nums">{candidate.code ?? "—"}</span> },
    { key: "role", header: "Роль в iiko", cell: (candidate) => <span className="text-muted-foreground">{candidate.mainRoleCode ?? "—"}</span> },
    { key: "branch", header: "Филиал", cell: (candidate) => <span className="text-muted-foreground">{candidate.branches.map((branch) => branch.name).join(", ") || "—"}</span> },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: <span className="sr-only">Действия</span>,
            numeric: true,
            cell: (candidate: UnprovisionedCandidate) => (
              <Button size="sm" variant="secondary" onClick={() => setProvisioning(candidate)}>
                Подключить
              </Button>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-3 xl:px-8">
        <Input type="search" aria-label="Поиск по имени" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени…" className="w-full sm:w-72" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4 xl:px-8">
        <DataTable
          caption="Сотрудники из iiko без доступа к кассе"
          columns={columns}
          rows={loading ? undefined : filtered.slice(0, CANDIDATE_LIMIT)}
          getRowId={(candidate) => candidate._id}
          empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено</p>}
        />
        {!loading && filtered.length > CANDIDATE_LIMIT ? (
          <p className="pt-3 text-caption text-muted-foreground">
            Показаны первые {CANDIDATE_LIMIT} из {filtered.length} — уточните поиск
          </p>
        ) : null}
      </div>

      {provisioning ? <ProvisionDialog candidate={provisioning} branches={branches} onClose={() => setProvisioning(null)} onProvision={provisionPosAccess} /> : null}
    </div>
  )
}

function ProvisionDialog({
  candidate,
  branches,
  onClose,
  onProvision,
}: {
  candidate: UnprovisionedCandidate
  branches: { externalId: string; name: string }[]
  onClose: () => void
  onProvision: (args: ProvisionAccessArgs) => Promise<unknown>
}) {
  const form = useProvisionAccessForm({ candidate, onProvision })
  const [result, setResult] = useState<{ code: string; pin: string } | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const issued = await form.submit()
    if (issued) setResult(issued)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        {result ? (
          <CredentialsResult title={`Доступ выдан: ${candidate.displayName}`} code={result.code} pin={result.pin} onClose={onClose} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Подключить: {candidate.displayName}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} autoComplete="off" className="flex flex-col gap-4">
              <ProvisionAccessFields form={form} branches={branches} variant="dialog" />
              {form.error ? <Banner tone="danger" title={form.error} /> : null}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={onClose}>
                  Отмена
                </Button>
                <Button type="submit" disabled={form.submitting}>
                  {form.submitting ? "Сохранение…" : "Выдать доступ"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
