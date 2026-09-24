import { useState } from "react"

import {
  Banner,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  NumericCodeInput,
  SegmentedControl,
  Select,
  Switch,
  type Column,
} from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import {
  useSuggestedCredentials,
  useUnprovisionedEmployees,
  useWorkforceBranches,
  useWorkforceMutations,
  usePosEmployees,
  type EmployeeId,
  type PosEmployee,
  type UnprovisionedCandidate,
} from "../data/use-office-workforce"

const ROLES = ["cashier", "manager", "administrator"] as const
type Role = (typeof ROLES)[number]
const ROLE_LABEL: Record<string, string> = { cashier: "Кассир", manager: "Менеджер", administrator: "Администратор", kitchen: "Кухня" }
const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }))

const CANDIDATE_LIMIT = 200

export function WorkforceWorkspace() {
  const [tab, setTab] = useState<"employees" | "candidates">("employees")
  const { candidates } = useUnprovisionedEmployees()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3 xl:px-8">
        <SegmentedControl
          aria-label="Список сотрудников"
          value={tab}
          onValueChange={setTab}
          options={[
            { value: "employees", label: "Сотрудники кассы" },
            { value: "candidates", label: `Из iiko${candidates.length ? ` (${candidates.length})` : ""}` },
          ]}
        />
      </div>

      {tab === "employees" ? <EmployeesTab /> : <CandidatesTab />}
    </div>
  )
}

function EmployeesTab() {
  const { employees, loading } = usePosEmployees()
  const branches = useWorkforceBranches()
  const mutations = useWorkforceMutations()
  const [editing, setEditing] = useState<PosEmployee | null>(null)
  const [resetting, setResetting] = useState<PosEmployee | null>(null)

  const columns: Column<PosEmployee>[] = [
    {
      key: "name",
      header: "Сотрудник",
      sortValue: (employee) => employee.displayName,
      cell: (employee) => (
        <div>
          <p className="font-semibold text-foreground">{employee.displayName}</p>
          {employee.iikoEmployeeExternalId ? <p className="text-caption text-muted-foreground">из iiko</p> : null}
        </div>
      ),
    },
    { key: "code", header: "Код", cell: (employee) => <span className="text-muted-foreground tabular-nums">{employee.code}</span> },
    { key: "role", header: "Роль", cell: (employee) => ROLE_LABEL[employee.role] ?? employee.role },
    {
      key: "branches",
      header: "Филиалы",
      cell: (employee) => <span className="text-muted-foreground">{employee.restaurants.map((restaurant) => restaurant.name).join(", ") || "—"}</span>,
    },
    {
      key: "active",
      header: "Активен",
      cell: (employee) => (
        <Switch
          aria-label={`Активен: ${employee.displayName}`}
          checked={employee.active}
          onCheckedChange={() => mutations.setEmployeeActive({ employeeId: employee._id, active: !employee.active })}
        />
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Действия</span>,
      numeric: true,
      cell: (employee) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(employee)}>
            Изменить
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setResetting(employee)}>
            Сбросить PIN
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-4 xl:px-8">
      <DataTable
        caption="Сотрудники кассы"
        columns={columns}
        rows={loading ? undefined : employees}
        getRowId={(employee) => employee._id}
        empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Сотрудников пока нет</p>}
      />

      {editing ? <AssignmentDialog employee={editing} branches={branches} onClose={() => setEditing(null)} onSave={mutations.updateEmployeeAssignment} /> : null}
      {resetting ? <ResetPinDialog employee={resetting} onClose={() => setResetting(null)} onReset={mutations.resetPin} /> : null}
    </div>
  )
}

function CandidatesTab() {
  const { candidates, loading } = useUnprovisionedEmployees()
  const branches = useWorkforceBranches()
  const { provisionPosAccess } = useWorkforceMutations()
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
    {
      key: "actions",
      header: <span className="sr-only">Действия</span>,
      numeric: true,
      cell: (candidate) => (
        <Button size="sm" variant="secondary" onClick={() => setProvisioning(candidate)}>
          Подключить
        </Button>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-3 xl:px-8">
        <Input
          type="search"
          aria-label="Поиск по имени"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по имени…"
          className="w-72"
        />
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

function BranchCheckboxes({
  branches,
  selected,
  onToggle,
}: {
  branches: { externalId: string; name: string }[]
  selected: Set<string>
  onToggle: (externalId: string) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-body-sm font-medium text-muted-foreground">Филиалы</legend>
      {branches.map((branch) => (
        <label key={branch.externalId} className="flex items-center gap-2 text-body-sm text-foreground">
          <Checkbox checked={selected.has(branch.externalId)} onCheckedChange={() => onToggle(branch.externalId)} />
          {branch.name}
        </label>
      ))}
    </fieldset>
  )
}

function toggleIn(current: Set<string>, externalId: string) {
  const next = new Set(current)
  if (next.has(externalId)) next.delete(externalId)
  else next.add(externalId)
  return next
}

function CredentialValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-caption font-medium text-muted-foreground">{label}</p>
      <p className="font-display text-display font-semibold tabular-nums text-foreground">{value}</p>
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
  onProvision: (args: { iikoEmployeeExternalId: string; employeeCode: string; pin: string; role: Role; restaurantExternalIds: string[] }) => Promise<unknown>
}) {
  const suggested = useSuggestedCredentials(true)
  const [code, setCode] = useState("")
  const [pin, setPin] = useState("")
  const [role, setRole] = useState<Role>("cashier")
  const [selected, setSelected] = useState<Set<string>>(() => new Set(candidate.branches.map((branch) => branch.externalId)))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ code: string; pin: string } | null>(null)

  const effectiveCode = code || suggested?.code || ""
  const effectivePin = pin || suggested?.pin || ""

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onProvision({ iikoEmployeeExternalId: candidate.externalId, employeeCode: effectiveCode, pin: effectivePin, role, restaurantExternalIds: [...selected] })
      setResult({ code: effectiveCode, pin: effectivePin })
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось выдать доступ"))
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Доступ выдан: {candidate.displayName}</DialogTitle>
            <DialogDescription>Сообщите сотруднику эти данные один раз — они больше нигде не показываются.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-6 rounded-card border border-border bg-muted p-4">
            <CredentialValue label="Код" value={result.code} />
            <CredentialValue label="PIN" value={result.pin} />
          </div>
          <DialogFooter>
            <Button onClick={onClose}>Готово</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Подключить: {candidate.displayName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Код сотрудника">
              {(control) => <NumericCodeInput {...control} name="employee-code" value={effectiveCode} onValueChange={setCode} maxLength={12} required pattern="\d{4,12}" />}
            </Field>
            <Field label="PIN">
              {(control) => <NumericCodeInput {...control} name="employee-pin" value={effectivePin} onValueChange={setPin} maxLength={6} required pattern="\d{4,6}" />}
            </Field>
          </div>
          <Field label="Роль">{(control) => <Select {...control} value={role} onValueChange={(value) => setRole(value as Role)} options={ROLE_OPTIONS} />}</Field>
          <BranchCheckboxes branches={branches} selected={selected} onToggle={(externalId) => setSelected((current) => toggleIn(current, externalId))} />
          {error && <Banner tone="danger" title={error} />}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохранение…" : "Выдать доступ"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AssignmentDialog({
  employee,
  branches,
  onClose,
  onSave,
}: {
  employee: PosEmployee
  branches: { externalId: string; name: string }[]
  onClose: () => void
  onSave: (args: { employeeId: EmployeeId; role: Role; restaurantExternalIds: string[] }) => Promise<unknown>
}) {
  const [role, setRole] = useState<Role>(employee.role as Role)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(employee.restaurants.map((restaurant) => restaurant.externalId)))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSave({ employeeId: employee._id, role, restaurantExternalIds: [...selected] })
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Назначение: {employee.displayName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Роль">{(control) => <Select {...control} value={role} onValueChange={(value) => setRole(value as Role)} options={ROLE_OPTIONS} />}</Field>
          <BranchCheckboxes branches={branches} selected={selected} onToggle={(externalId) => setSelected((current) => toggleIn(current, externalId))} />
          {error && <Banner tone="danger" title={error} />}
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

function ResetPinDialog({ employee, onClose, onReset }: { employee: PosEmployee; onClose: () => void; onReset: (args: { employeeId: EmployeeId; pin: string }) => Promise<unknown> }) {
  const suggested = useSuggestedCredentials(true)
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const effectivePin = pin || suggested?.pin || ""

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onReset({ employeeId: employee._id, pin: effectivePin })
      setResult(effectivePin)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сбросить PIN"))
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый PIN: {employee.displayName}</DialogTitle>
            <DialogDescription>Сообщите сотруднику этот PIN один раз — он больше нигде не показывается.</DialogDescription>
          </DialogHeader>
          <p className="font-display text-display font-semibold tabular-nums text-foreground">{result}</p>
          <DialogFooter>
            <Button onClick={onClose}>Готово</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Сбросить PIN: {employee.displayName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Новый PIN">
            {(control) => <NumericCodeInput {...control} name="employee-pin" value={effectivePin} onValueChange={setPin} maxLength={6} required pattern="\d{4,6}" />}
          </Field>
          {error && <Banner tone="danger" title={error} />}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохранение…" : "Сбросить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
