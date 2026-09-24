import { useState } from "react"

import { Button } from "@/shared/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { errorMessage } from "@/shared/lib/error-message"
import { cn } from "@/shared/lib/utils"

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
const ROLE_LABEL: Record<string, string> = { cashier: "Кассир", manager: "Менеджер", administrator: "Администратор" }

const inputClass = "h-11 rounded-[var(--radius-control)] border border-border bg-background px-3 text-sm outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus:border-primary/50"

export function WorkforceWorkspace() {
  const [tab, setTab] = useState<"employees" | "candidates">("employees")
  const { candidates } = useUnprovisionedEmployees()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-1 border-b border-border px-5 py-3">
        <div className="flex gap-1 rounded-[var(--radius-control)] bg-muted p-1">
          <button type="button" onClick={() => setTab("employees")} className={cn("rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-sm font-bold", tab === "employees" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
            Сотрудники кассы
          </button>
          <button type="button" onClick={() => setTab("candidates")} className={cn("rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-sm font-bold", tab === "candidates" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
            Из iiko {candidates.length ? `(${candidates.length})` : ""}
          </button>
        </div>
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

  if (loading) return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Загрузка…</div>

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-5 py-2 text-left">Сотрудник</th>
            <th className="px-3 py-2 text-left">Код</th>
            <th className="px-3 py-2 text-left">Роль</th>
            <th className="px-3 py-2 text-left">Филиалы</th>
            <th className="px-3 py-2 text-center">Активен</th>
            <th className="px-3 py-2 text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => (
            <tr key={employee._id} className="border-t border-border/60 hover:bg-muted/40">
              <td className="px-5 py-2">
                <p className="font-semibold text-foreground">{employee.displayName}</p>
                {employee.iikoEmployeeExternalId ? <p className="text-xs text-muted-foreground">из iiko</p> : null}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{employee.code}</td>
              <td className="px-3 py-2">{ROLE_LABEL[employee.role] ?? employee.role}</td>
              <td className="px-3 py-2 text-muted-foreground">{employee.restaurants.map((restaurant) => restaurant.name).join(", ") || "—"}</td>
              <td className="px-3 py-2 text-center">
                <button
                  type="button"
                  onClick={() => mutations.setEmployeeActive({ employeeId: employee._id, active: !employee.active })}
                  className={cn("rounded-full px-2 py-0.5 text-xs font-bold", employee.active ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive")}
                >
                  {employee.active ? "Да" : "Нет"}
                </button>
              </td>
              <td className="px-3 py-2 text-right">
                <button type="button" onClick={() => setEditing(employee)} className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-xs font-bold text-primary hover:bg-primary/10">Изменить</button>{" "}
                <button type="button" onClick={() => setResetting(employee)} className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-xs font-bold text-muted-foreground hover:bg-muted">Сбросить PIN</button>
              </td>
            </tr>
          ))}
          {!employees.length && (
            <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">Сотрудников пока нет</td></tr>
          )}
        </tbody>
      </table>

      {editing ? (
        <AssignmentDialog
          employee={editing}
          branches={branches}
          onClose={() => setEditing(null)}
          onSave={mutations.updateEmployeeAssignment}
        />
      ) : null}
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

  if (loading) return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Загрузка…</div>

  const filtered = query.trim()
    ? candidates.filter((candidate) => candidate.displayName.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")))
    : candidates

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени…" className={cn(inputClass, "h-9 w-72")} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-2 text-left">Имя (из iiko)</th>
              <th className="px-3 py-2 text-left">Табельный №</th>
              <th className="px-3 py-2 text-left">Роль в iiko</th>
              <th className="px-3 py-2 text-left">Филиал</th>
              <th className="w-32" />
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((candidate) => (
              <tr key={candidate._id} className="border-t border-border/60 hover:bg-muted/40">
                <td className="px-5 py-2 font-semibold text-foreground">{candidate.displayName}</td>
                <td className="px-3 py-2 text-muted-foreground">{candidate.code ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{candidate.mainRoleCode ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{candidate.branches.map((branch) => branch.name).join(", ") || "—"}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="secondary" onClick={() => setProvisioning(candidate)}>Подключить</Button>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-muted-foreground">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
        {filtered.length > 200 ? <p className="px-5 py-3 text-xs text-muted-foreground">Показаны первые 200 из {filtered.length} — уточните поиск</p> : null}
      </div>

      {provisioning ? (
        <ProvisionDialog candidate={provisioning} branches={branches} onClose={() => setProvisioning(null)} onProvision={provisionPosAccess} />
      ) : null}
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
    <div className="flex flex-col gap-1.5">
      {branches.map((branch) => (
        <label key={branch.externalId} className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={selected.has(branch.externalId)} onChange={() => onToggle(branch.externalId)} />
          {branch.name}
        </label>
      ))}
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
  onProvision: (args: { iikoEmployeeExternalId: string; employeeCode: string; pin: string; role: (typeof ROLES)[number]; restaurantExternalIds: string[] }) => Promise<unknown>
}) {
  const suggested = useSuggestedCredentials(true)
  const [code, setCode] = useState("")
  const [pin, setPin] = useState("")
  const [role, setRole] = useState<(typeof ROLES)[number]>("cashier")
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
          <DialogHeader><DialogTitle>Доступ выдан: {candidate.displayName}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Сообщите сотруднику эти данные один раз — они больше нигде не показываются.</p>
          <div className="flex gap-4 rounded-[var(--radius-card)] border border-border bg-muted/40 p-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Код</p>
              <p className="font-display text-2xl font-semibold tabular-nums">{result.code}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">PIN</p>
              <p className="font-display text-2xl font-semibold tabular-nums">{result.pin}</p>
            </div>
          </div>
          <Button onClick={onClose}>Готово</Button>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Подключить: {candidate.displayName}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">Код сотрудника</span>
              <input value={effectiveCode} onChange={(event) => setCode(event.target.value)} className={inputClass} required pattern="\d{4,12}" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">PIN</span>
              <input value={effectivePin} onChange={(event) => setPin(event.target.value)} className={inputClass} required pattern="\d{4,6}" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Роль</span>
            <select value={role} onChange={(event) => setRole(event.target.value as (typeof ROLES)[number])} className={inputClass}>
              {ROLES.map((option) => <option key={option} value={option}>{ROLE_LABEL[option]}</option>)}
            </select>
          </label>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Филиалы</p>
            <BranchCheckboxes
              branches={branches}
              selected={selected}
              onToggle={(externalId) => setSelected((current) => {
                const next = new Set(current)
                if (next.has(externalId)) next.delete(externalId)
                else next.add(externalId)
                return next
              })}
            />
          </div>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="mt-1">{submitting ? "Сохранение…" : "Выдать доступ"}</Button>
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
  onSave: (args: { employeeId: EmployeeId; role: (typeof ROLES)[number]; restaurantExternalIds: string[] }) => Promise<unknown>
}) {
  const [role, setRole] = useState<(typeof ROLES)[number]>(employee.role as (typeof ROLES)[number])
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
      <DialogContent>
        <DialogHeader><DialogTitle>Назначение: {employee.displayName}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Роль</span>
            <select value={role} onChange={(event) => setRole(event.target.value as (typeof ROLES)[number])} className={inputClass}>
              {ROLES.map((option) => <option key={option} value={option}>{ROLE_LABEL[option]}</option>)}
            </select>
          </label>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Филиалы</p>
            <BranchCheckboxes
              branches={branches}
              selected={selected}
              onToggle={(externalId) => setSelected((current) => {
                const next = new Set(current)
                if (next.has(externalId)) next.delete(externalId)
                else next.add(externalId)
                return next
              })}
            />
          </div>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="mt-1">{submitting ? "Сохранение…" : "Сохранить"}</Button>
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
          <DialogHeader><DialogTitle>Новый PIN: {employee.displayName}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Сообщите сотруднику этот PIN один раз — он больше нигде не показывается.</p>
          <p className="font-display text-3xl font-semibold tabular-nums">{result}</p>
          <Button onClick={onClose}>Готово</Button>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Сбросить PIN: {employee.displayName}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Новый PIN</span>
            <input value={effectivePin} onChange={(event) => setPin(event.target.value)} className={inputClass} required pattern="\d{4,6}" />
          </label>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="mt-1">{submitting ? "Сохранение…" : "Сбросить"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
