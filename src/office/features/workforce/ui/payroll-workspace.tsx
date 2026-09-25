import { Plus, Search } from "lucide-react"
import { useId, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { statusTabs } from "@/office/engine/module-config"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { Banner, Button, Combobox, DataTable, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, FilterTabs, Input, MoneyInput, Select, StatusPill, Textarea, useToast, type Column } from "@/shared/components/ui"
import { almatyBusinessDate } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"
import { recordCount } from "@/shared/lib/plural"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { usePosEmployees } from "../data/use-office-workforce"
import { usePayrollMutations, usePayrollRules, usePayrollRuns, type PayrollRulesRow, type PayrollRunRow, type SaveAdjustmentArgs } from "../data/use-workforce-w2"
import { formatBusinessDate } from "../model/modules"
import { ADJUSTMENT_KINDS, ADJUSTMENT_LABEL, formatRuleValue, monthPeriod, periodLabel, type AdjustmentKind } from "../model/w2"
import { PayrollRulesPanel } from "./payroll-rules-panel"
import { PayrollRunEditor } from "./payroll-run-editor"

// «Начисления и удержания» (W2-HR-06): /office/payroll — runs of a restaurant (document lifecycle) and the
// KZ rules versions («Тип записи»); /office/payroll/<run> — the run card; /office/payroll/<rules> — rules panel.

const NEW_RULES = "rules-new"
const isRulesId = (id: string | undefined) => id === NEW_RULES || Boolean(id?.startsWith("payroll-rules-"))

type RecordType = "runs" | "rules"

const RUN_TABS = statusTabs("document").map((tab) => ({ value: tab.key, label: tab.label, statuses: tab.statuses }))
const RULE_TABS = [
  { value: "all", label: "Все", statuses: null },
  { value: "draft", label: "Черновики", statuses: ["draft"] },
  { value: "active", label: "Активные", statuses: ["active"] },
  { value: "inactive", label: "Неактивные", statuses: ["inactive"] },
]

export function PayrollWorkspace() {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={`${id && !isRulesId(id) ? id : "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id && !isRulesId(id) ? <PayrollRunEditor externalId={id} /> : <PayrollRegister rulesId={id ?? null} />}
    </PlatformErrorBoundary>
  )
}

/** Columns per OFFICE-DESIGN §5: every amount through formatTenge. */
export function runColumns(restaurantName: (externalId: string) => string | undefined): Column<PayrollRunRow>[] {
  return [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    { key: "period", header: "Период", cell: (row) => <span className="whitespace-nowrap tabular-nums">{periodLabel(row.from, row.to)}</span> },
    { key: "restaurant", header: "Ресторан", cell: (row) => restaurantName(row.restaurantExternalId) ?? row.restaurantExternalId },
    { key: "employees", header: "Сотрудников", numeric: true, cell: (row) => row.employeeCount },
    { key: "gross", header: "Начислено", numeric: true, cell: (row) => formatTenge(row.totals.gross) },
    { key: "withheld", header: "Удержано", numeric: true, cell: (row) => formatTenge(row.totals.employeeTaxes) },
    { key: "toPay", header: "К выплате", numeric: true, cell: (row) => <span className="font-semibold">{formatTenge(row.totals.toPay)}</span> },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]
}

export const RULE_COLUMNS: Column<PayrollRulesRow>[] = [
  { key: "version", header: "Версия", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.version}</span> },
  { key: "effectiveFrom", header: "Действует с", cell: (row) => formatBusinessDate(row.effectiveFrom) },
  { key: "mzp", header: "МЗП", numeric: true, cell: (row) => formatRuleValue("mzp", row.mzp) },
  { key: "mrp", header: "МРП", numeric: true, cell: (row) => formatRuleValue("mrp", row.mrp) },
  { key: "opv", header: "ОПВ", numeric: true, cell: (row) => formatRuleValue("opvRate", row.opvRate) },
  { key: "ipn", header: "ИПН", numeric: true, cell: (row) => `${formatRuleValue("ipnRate", row.ipnRate)} / ${formatRuleValue("ipnHighRate", row.ipnHighRate)}` },
  { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
]

function PayrollRegister({ rulesId }: { rulesId: string | null }) {
  const navigate = useNavigate()
  const scope = usePlatformScope()
  const [params, setParams] = useSearchParams()
  const canEdit = useCan("office.payroll.edit")
  const panelId = useId()
  const [tab, setTab] = useState("all")
  const [searchText, setSearchText] = useState("")
  const [adjusting, setAdjusting] = useState(false)
  const type: RecordType = rulesId || params.get("type") === "rules" ? "rules" : "runs"
  const requested = params.get("restaurant")
  const restaurantExternalId = scope.restaurants.some((restaurant) => restaurant.externalId === requested) ? requested! : scope.restaurants[0]?.externalId
  const runs = usePayrollRuns(type === "runs" ? restaurantExternalId : undefined)
  const rules = usePayrollRules(true)
  const tabs = type === "runs" ? RUN_TABS : RULE_TABS
  const active = tabs.find((candidate) => candidate.value === tab) ?? tabs[0]
  const needle = searchText.trim().toLocaleLowerCase("ru")
  const rulesSelected = rulesId && rulesId !== NEW_RULES ? rules?.find((row) => row.externalId === rulesId) : undefined
  const panelOpen = rulesId !== null

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { replace: true })
  }
  const setType = (next: RecordType) => {
    setTab("all")
    if (rulesId) navigate(`/office/payroll${next === "rules" ? "?type=rules" : ""}`)
    else update({ type: next === "rules" ? "rules" : null })
  }
  const openRules = (externalId: string) => navigate(`/office/payroll/${encodeURIComponent(externalId)}?type=rules`)
  const closeRules = () => navigate("/office/payroll?type=rules")

  if (scope.loading) return <OfficeStatePage state={{ kind: "loading" }} />

  const runRows = runs?.filter((row) => (!active.statuses || active.statuses.includes(row.status)) && (!needle || row.number.toLocaleLowerCase("ru").includes(needle)))
  const ruleRows = rules?.filter((row) => (!active.statuses || active.statuses.includes(row.status)) && (!needle || row.version.toLocaleLowerCase("ru").includes(needle)))
  const rows = type === "runs" ? runRows : ruleRows

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {scope.restaurants.length > 1 && type === "runs" ? (
              <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurantExternalId} onValueChange={(restaurant) => update({ restaurant })} options={restaurantSelectOptions(scope.restaurants)} />
            ) : null}
            <Select
              aria-label="Тип записи"
              className="w-full sm:w-56"
              value={type}
              onValueChange={(value) => setType(value as RecordType)}
              options={[
                { value: "runs", label: "Ведомости" },
                { value: "rules", label: "Правила РК" },
              ]}
            />
          </div>
          {canEdit && restaurantExternalId ? (
            <Button variant={panelOpen ? "secondary" : "primary"} onClick={() => setAdjusting(true)}>
              <Plus aria-hidden />
              Корректировка
            </Button>
          ) : null}
        </div>

        {type === "runs" && canEdit && restaurantExternalId ? <CalculatePanel restaurantExternalId={restaurantExternalId} onCalculated={(externalId) => navigate(`/office/payroll/${encodeURIComponent(externalId)}`)} /> : null}

        <FilterTabs aria-label={type === "runs" ? "Статус ведомостей" : "Статус правил"} value={active.value} onValueChange={setTab} panelId={panelId} items={tabs.map(({ value, label }) => ({ value, label }))} />
        <div id={panelId} role="tabpanel" aria-label={active.label} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative w-full sm:w-[420px]">
              <span className="sr-only">Поиск: начисления и удержания</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={type === "runs" ? "Поиск: номер ведомости" : "Поиск: версия правил"} className="pl-9" />
            </label>
            <span className="text-caption text-muted-foreground">{rows ? recordCount(rows.length) : ""}</span>
            {type === "rules" && canEdit ? (
              <Button variant="secondary" className="ml-auto" onClick={() => openRules(NEW_RULES)}>
                <Plus aria-hidden />
                Новая версия правил
              </Button>
            ) : null}
          </div>

          {type === "runs" && !restaurantExternalId ? (
            <EmptyState title="Нет доступных ресторанов" description="Ведомости рассчитываются по ресторану — попросите администратора выдать доступ." />
          ) : rows === undefined ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : type === "runs" ? (
            <DataTable
              caption="Ведомости"
              columns={runColumns(scope.restaurantName)}
              rows={runRows}
              getRowId={(row) => row.externalId}
              onRowClick={(row) => navigate(`/office/payroll/${encodeURIComponent(row.externalId)}`)}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">{active.statuses || needle ? "Ничего не найдено по выбранным фильтрам" : "Записей пока нет. Рассчитайте первую ведомость за период."}</p>}
            />
          ) : (
            <DataTable
              caption="Правила РК"
              columns={RULE_COLUMNS}
              rows={ruleRows}
              getRowId={(row) => row.externalId}
              selectedId={rulesId}
              onRowClick={(row) => openRules(row.externalId)}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">{active.statuses || needle ? "Ничего не найдено по выбранным фильтрам" : "Версий правил пока нет."}</p>}
            />
          )}
        </div>
      </div>

      {rulesId === NEW_RULES && canEdit ? <PayrollRulesPanel key="new" rules={null} template={rules?.[0]} onClose={closeRules} onSaved={openRules} /> : null}
      {rulesSelected ? <PayrollRulesPanel key={`${rulesSelected.externalId}:${rulesSelected.status}:${rulesSelected.updatedAt}`} rules={rulesSelected} onClose={closeRules} onSaved={openRules} /> : null}
      {rulesId && rulesId !== NEW_RULES && !rulesSelected ? (
        <RightPanel open onOpenChange={(next) => !next && closeRules()} title="Правила РК">
          {rules === undefined ? <OfficeStatePage state={{ kind: "loading" }} /> : <EmptyState title="Версия правил не найдена" description="Возможно, ссылка устарела." />}
        </RightPanel>
      ) : null}
      {adjusting && restaurantExternalId ? <AdjustmentDialog restaurantExternalId={restaurantExternalId} restaurants={scope.restaurants} onClose={() => setAdjusting(false)} /> : null}
    </div>
  )
}

/** «Расчёт периода» (as the bahandi panel, but for the chosen restaurant): secondary; the result is a draft. */
function CalculatePanel({ restaurantExternalId, onCalculated }: { restaurantExternalId: string; onCalculated: (externalId: string) => void }) {
  const { calculatePayroll } = usePayrollMutations()
  const toast = useToast()
  const [period, setPeriod] = useState(() => monthPeriod(almatyBusinessDate(Date.now())))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(period.from) && /^\d{4}-\d{2}-\d{2}$/.test(period.to) && period.from <= period.to

  async function calculate() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await calculatePayroll({ restaurantExternalId, from: period.from, to: period.to })
      toast(`Ведомость ${result.number}: начислено ${formatTenge(result.totals.gross)}`, "success")
      onCalculated(result.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось рассчитать ведомость"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Расчёт периода" className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-body-sm font-semibold text-foreground">Расчёт периода</h3>
        <p className="text-caption text-muted-foreground">Только по согласованным и закрытым на кассе явкам и корректировкам; результат создаётся черновиком. Повторный расчёт перезаписывает черновик.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Начало периода">{(control) => <Input {...control} type="date" className="w-44" value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} />}</Field>
        <Field label="Конец периода">{(control) => <Input {...control} type="date" className="w-44" value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} />}</Field>
        <Button variant="secondary" className="ml-auto" disabled={!valid || busy} onClick={() => void calculate()}>
          {busy ? "Расчёт…" : "Рассчитать ведомость"}
        </Button>
      </div>
      {error ? (
        <Banner tone="danger" title="Не удалось рассчитать ведомость">
          {error}
        </Banner>
      ) : null}
    </section>
  )
}

/** «+ Корректировка»: a bonus, penalty or advance of an employee; it goes into the nearest run of its period. */
function AdjustmentDialog({ restaurantExternalId: initialRestaurant, restaurants, onClose }: { restaurantExternalId: string; restaurants: { externalId: string; name: string }[]; onClose: () => void }) {
  const canSeeEmployees = useCan("office.employees.view")
  const { employees, loading } = usePosEmployees(canSeeEmployees)
  const { saveAdjustment } = usePayrollMutations()
  const toast = useToast()
  const [restaurantExternalId, setRestaurant] = useState(initialRestaurant)
  const [employeeId, setEmployeeId] = useState("")
  const [kind, setKind] = useState<AdjustmentKind>("bonus")
  const [businessDate, setBusinessDate] = useState(() => almatyBusinessDate(Date.now()))
  const [amount, setAmount] = useState<number | null>(null)
  const [comment, setComment] = useState("")
  const [errors, setErrors] = useState<Partial<Record<"employee" | "date" | "amount" | "comment", string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = employees
    .filter((employee) => employee.active && employee.restaurants.some((restaurant) => restaurant.externalId === restaurantExternalId))
    .map((employee) => ({ value: employee._id, label: employee.displayName, hint: `код ${employee.code}` }))

  async function submit() {
    if (busy) return
    const found: typeof errors = {}
    if (!employeeId) found.employee = "Выберите сотрудника"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) found.date = "Укажите дату"
    if (!amount || amount <= 0) found.amount = "Сумма больше нуля"
    if (comment.trim().length < 3) found.comment = "Укажите основание"
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    setError(null)
    try {
      await saveAdjustment({ restaurantExternalId, employeeId: employeeId as SaveAdjustmentArgs["employeeId"], businessDate, kind, amount: amount!, comment: comment.trim() })
      toast(`${ADJUSTMENT_LABEL[kind]}: ${formatTenge(amount!)} — войдёт в ведомость периода`, "success")
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить корректировку"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Корректировка</DialogTitle>
          <DialogDescription>Премия, штраф или аванс сотрудника. Учитывается в ближайшей ведомости за период с этой датой.</DialogDescription>
        </DialogHeader>
        <form
          aria-label="Корректировка"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {!canSeeEmployees ? <Banner tone="warning" title="Нет доступа к списку сотрудников">Для корректировки нужен просмотр раздела «Сотрудники».</Banner> : null}
          {restaurants.length > 1 ? (
            <Field label="Ресторан">
              {(control) => (
                <Select
                  {...control}
                  value={restaurantExternalId}
                  onValueChange={(value) => {
                    setRestaurant(value)
                    setEmployeeId("")
                  }}
                  options={restaurantSelectOptions(restaurants)}
                />
              )}
            </Field>
          ) : null}
          <Field label="Сотрудник" error={errors.employee}>
            {(control) => (
              <Combobox {...control} value={employeeId || undefined} onValueChange={setEmployeeId} options={options} disabled={!canSeeEmployees || loading} placeholder="Выберите сотрудника" searchPlaceholder="ФИО или код" emptyText="В ресторане нет активных сотрудников" />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Вид">{(control) => <Select {...control} value={kind} onValueChange={(value) => setKind(value as AdjustmentKind)} options={ADJUSTMENT_KINDS.map((value) => ({ value, label: ADJUSTMENT_LABEL[value] }))} />}</Field>
            <Field label="Дата" error={errors.date}>
              {(control) => <Input {...control} type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />}
            </Field>
            <Field label="Сумма" error={errors.amount} className="sm:col-span-2">
              {(control) => <MoneyInput {...control} value={amount} onValueChange={setAmount} />}
            </Field>
          </div>
          <Field label="Основание" error={errors.comment}>
            {(control) => <Textarea {...control} value={comment} onChange={(event) => setComment(event.target.value)} />}
          </Field>
          {error ? (
            <Banner tone="danger" title="Не удалось сохранить">
              {error}
            </Banner>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy || !canSeeEmployees}>
              {busy ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
