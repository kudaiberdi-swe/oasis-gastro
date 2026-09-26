import { ArrowLeft, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { Banner, Button, Combobox, Field, Input, KpiCard, MoneyInput, Select, Skeleton, StatusPill, Textarea, useToast } from "@/shared/components/ui"
import { useReveal } from "@/shared/hooks/use-reveal"
import { errorMessage } from "@/shared/lib/error-message"
import { formatAmount, formatTenge } from "@/shared/lib/format"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"
import { cn } from "@/shared/lib/utils"

import { useFinanceRecord, useFinanceReferences, type FinanceRecord, type FinanceReferences } from "../data/use-finance-records"
import { useBudgetExecution, useBudgetLines, useBudgetMutations, type BudgetExecution } from "../data/use-planning"
import { categoriesForRestaurant, formatBusinessDate } from "../model/modules"
import { budgetDraftOf, budgetLinesArgs, budgetPlanTotal, budgetSaveArgs, budgetVersionOf, formatExecution, validateBudget, type BudgetDraft, type BudgetLineDraft } from "../model/planning"
import { RecordAudit } from "./record-parts"
import { RecordEditorDialogs, useRecordEditor } from "./record-editor"

const MODULE = "budgets"
const BACK = "/office/budgets"

/** /office/budgets/:id — the budget editor (OFFICE-DESIGN §3.4): details, lines «Счёт / Статья · План · Факт · Отклонение · %», KPI. */
export function BudgetEditor({ externalId, defaultRestaurantExternalId }: { externalId: string | null; defaultRestaurantExternalId?: string }) {
  const navigate = useNavigate()
  const references = useFinanceReferences(MODULE)
  const record = useFinanceRecord(MODULE, externalId)
  const lines = useBudgetLines(externalId)
  const loading = references === undefined || (externalId !== null && (record === undefined || (record !== null && lines === undefined)))
  if (loading) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  if (externalId !== null && !record) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "empty", title: "Бюджет не найден", description: "Возможно, он относится к ресторану вне вашего доступа или ссылка устарела.", action: <Button variant="secondary" onClick={() => navigate(BACK)}>К списку</Button> }} />
      </div>
    )
  }
  return (
    <BudgetForm
      key={record ? `${record.externalId}:${record.status}` : "new"}
      record={record ?? null}
      lines={lines ?? []}
      references={references!}
      defaultRestaurantExternalId={defaultRestaurantExternalId}
      onBack={() => navigate(BACK)}
      onSaved={(id) => navigate(`${BACK}/${encodeURIComponent(id)}`)}
    />
  )
}

interface BudgetFormProps {
  record: FinanceRecord | null
  lines: NonNullable<ReturnType<typeof useBudgetLines>>
  references: FinanceReferences
  defaultRestaurantExternalId?: string
  onBack: () => void
  onSaved: (externalId: string) => void
}

const articleValue = (line: Pick<BudgetLineDraft, "kind" | "articleExternalId">) => (line.articleExternalId ? `${line.kind}:${line.articleExternalId}` : "")

function BudgetForm({ record, lines, references, defaultRestaurantExternalId, onBack, onSaved }: BudgetFormProps) {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const { setBudgetLines, copyBudgetVersion } = useBudgetMutations()
  const execution = useBudgetExecution(record?.externalId ?? null)
  const toast = useToast()
  const [copying, setCopying] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [nextKey, setNextKey] = useState(1)
  const editor = useRecordEditor<BudgetDraft>({
    moduleId: MODULE,
    lifecycle: "approval",
    record,
    baseline: budgetDraftOf(record, defaultRestaurantExternalId ?? references.restaurants[0]?.externalId ?? "", lines),
    validate: validateBudget,
    toArgs: budgetSaveArgs,
    afterSave: async (budgetExternalId, draft) => {
      await setBudgetLines({ budgetExternalId, lines: budgetLinesArgs(draft) })
    },
    onSaved,
  })
  const { draft, set, errors, editable } = editor
  const errorRef = useReveal(editor.error)
  const restaurantName = references.restaurants.find((restaurant) => restaurant.externalId === draft.restaurantExternalId)?.name ?? "—"
  const version = record ? budgetVersionOf(record) : 1

  const accounts = references.accounts.map((account) => ({ value: `account:${account.externalId}`, label: `${account.code} · ${account.name}`, hint: "Счёт" }))
  const categories = categoriesForRestaurant(references.cashflowCategories, references.restaurants, draft.restaurantExternalId).map((row) => ({ value: `category:${row.externalId}`, label: row.name, hint: "Статья ДДС" }))
  const articleOptions = [...categories, ...accounts]
  const articleLabel = (line: Pick<BudgetLineDraft, "kind" | "articleExternalId">) => articleOptions.find((option) => option.value === articleValue(line))?.label ?? (line.articleExternalId || "—")

  const factOf = (line: BudgetLineDraft) => execution?.lines.find((row) => (line.kind === "account" ? row.accountExternalId : row.cashflowCategoryExternalId) === line.articleExternalId)?.fact
  const plan = budgetPlanTotal(draft.lines)
  const updateLine = (key: string, patch: Partial<BudgetLineDraft>) => set({ lines: draft.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) })
  const addLine = () => {
    set({ lines: [...draft.lines, { key: `new-${nextKey}`, kind: "category", articleExternalId: "", planAmount: null }] })
    setNextKey((value) => value + 1)
  }

  async function newVersion() {
    if (!record) return
    setCopying(true)
    setCopyError(null)
    try {
      const copy = await copyBudgetVersion({ externalId: record.externalId })
      toast(`Создана версия ${copy.budgetVersion} — черновик ${copy.number}`, "success")
      onSaved(copy.externalId)
    } catch (caught) {
      setCopyError(errorMessage(caught, "Не удалось создать новую версию"))
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form aria-label="Бюджет" noValidate onSubmit={(event) => event.preventDefault()} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title font-semibold">{record ? `Бюджет ${record.number}` : "Новый бюджет"}</h2>
              {record ? <StatusPill domain="document" status={record.status} /> : null}
            </div>
            <p className="text-body-sm text-muted-foreground">
              {[draft.name || null, restaurantName, `${formatBusinessDate(draft.periodStart)} — ${formatBusinessDate(draft.periodEnd)}`, `версия ${version}`].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft aria-hidden />К списку
            </Button>
            {record && record.status !== "draft" && canEdit ? (
              <Button variant="secondary" onClick={() => void newVersion()} disabled={copying}>
                {copying ? "Создание…" : "Новая версия"}
              </Button>
            ) : null}
            {editor.footer}
          </div>
        </header>

        {editor.note ? <p className="text-caption text-muted-foreground">{editor.note}</p> : null}
        {editor.error || copyError ? (
          <Banner ref={errorRef} tabIndex={-1} tone="danger" title="Не удалось выполнить действие">
            {editor.error ?? copyError}
          </Banner>
        ) : null}

        <BudgetKpi plan={editable ? plan : (record?.amount ?? plan)} execution={execution} saved={Boolean(record)} />

        <section aria-label="Реквизиты" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
          <h3 className="text-title-sm font-semibold">Реквизиты</h3>
          {editable ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Название" error={errors.name}>
                {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} autoComplete="off" placeholder="Например, операционный бюджет октября" />}
              </Field>
              {!record && references.restaurants.length > 1 ? (
                <Field label="Ресторан" error={errors.restaurantExternalId}>
                  {(control) => <Select {...control} value={draft.restaurantExternalId || undefined} onValueChange={(restaurantExternalId) => set({ restaurantExternalId })} options={restaurantSelectOptions(references.restaurants)} />}
                </Field>
              ) : (
                <ReadOnly label="Ресторан" value={restaurantName} />
              )}
              <Field label="Начало периода" error={errors.periodStart}>
                {(control) => <Input {...control} type="date" value={draft.periodStart} onChange={(event) => set({ periodStart: event.target.value })} />}
              </Field>
              <Field label="Конец периода" error={errors.periodEnd}>
                {(control) => <Input {...control} type="date" value={draft.periodEnd} onChange={(event) => set({ periodEnd: event.target.value })} />}
              </Field>
              <ReadOnly label="Версия" value={`${version}${record?.data.previousVersionExternalId ? " (копия предыдущей)" : ""}`} />
              <Field label="Комментарий">{(control) => <Textarea {...control} value={draft.comment} onChange={(event) => set({ comment: event.target.value })} />}</Field>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <ReadOnly label="Название" value={draft.name} />
              <ReadOnly label="Ресторан" value={restaurantName} />
              <ReadOnly label="Начало периода" value={formatBusinessDate(draft.periodStart)} />
              <ReadOnly label="Конец периода" value={formatBusinessDate(draft.periodEnd)} />
              <ReadOnly label="Версия" value={String(version)} />
              <ReadOnly label="Комментарий" value={draft.comment || "—"} />
            </div>
          )}
        </section>

        <section aria-label="Строки бюджета" className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-title-sm font-semibold">Строки бюджета</h3>
            {editable ? (
              <Button variant="secondary" size="sm" onClick={addLine}>
                <Plus aria-hidden />
                Добавить строку
              </Button>
            ) : null}
          </div>
          {errors.lines ? (
            <p role="alert" className="text-body-sm text-destructive">
              {errors.lines}
            </p>
          ) : null}
          {draft.lines.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{editable ? "Добавьте счета или статьи ДДС с планом на период." : "В бюджете нет строк."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <caption className="sr-only">План и факт по строкам бюджета</caption>
                <thead className="bg-muted text-caption text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Счёт / статья
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                      План, ₸
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                      Факт, ₸
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                      Отклонение, ₸
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      %
                    </th>
                    {editable ? <th scope="col" className="w-12 px-3 py-2" aria-label="Удалить" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {draft.lines.map((line) => {
                    const fact = factOf(line)
                    const deviation = fact === undefined || line.planAmount === null ? null : fact - line.planAmount
                    return (
                      <tr key={line.key} className="border-t border-border align-middle">
                        <td className="min-w-64 px-3 py-2">
                          {editable ? (
                            <Combobox
                              aria-label="Счёт или статья ДДС"
                              value={articleValue(line) || undefined}
                              onValueChange={(value) => {
                                const [kind, ...rest] = value.split(":")
                                updateLine(line.key, { kind: kind === "account" ? "account" : "category", articleExternalId: rest.join(":") })
                              }}
                              options={articleOptions}
                              placeholder="Выберите статью или счёт"
                              searchPlaceholder="Название или код"
                            />
                          ) : (
                            <span className="font-semibold">{articleLabel(line)}</span>
                          )}
                        </td>
                        <td className="w-40 px-3 py-2 text-right tabular-nums">
                          {editable ? <MoneyInput aria-label={`План: ${articleLabel(line)}`} value={line.planAmount} onValueChange={(planAmount) => updateLine(line.key, { planAmount })} /> : formatAmount(line.planAmount ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{execution === undefined && record ? <Skeleton className="ml-auto h-4 w-16" /> : fact === undefined ? "—" : formatAmount(fact)}</td>
                        <td className={cn("px-3 py-2 text-right tabular-nums", deviation !== null && deviation > 0 && "text-destructive")}>{deviation === null ? "—" : formatAmount(deviation)}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{fact === undefined || !line.planAmount ? "—" : formatExecution(Math.round((fact / line.planAmount) * 1000) / 10)}</td>
                        {editable ? (
                          <td className="px-3 py-2 text-right">
                            <Button variant="ghost" size="sm" aria-label={`Удалить строку ${articleLabel(line)}`} onClick={() => set({ lines: draft.lines.filter((row) => row.key !== line.key) })}>
                              <Trash2 aria-hidden />
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="px-3 py-2">Итого</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatAmount(plan)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{execution ? formatAmount(execution.fact) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{execution ? formatAmount(execution.fact - plan) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{execution && plan ? formatExecution(Math.round((execution.fact / plan) * 1000) / 10) : "—"}</td>
                    {editable ? <td /> : null}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="text-caption text-muted-foreground">Факт по счёту — обороты журнала ресторана за период в нормальную сторону счёта; по статье ДДС — проведённые платежи этой статьи.</p>
        </section>

        {record ? (
          <section className="rounded-card border border-border bg-card p-5">
            <RecordAudit record={record}>{editor.cancelAction}</RecordAudit>
          </section>
        ) : null}
      </form>
      <RecordEditorDialogs editor={editor} onClose={onBack} />
    </div>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-body-sm text-foreground">{value || "—"}</span>
    </div>
  )
}

/** KPI of the budget (L-11): План, Факт, Исполнение. */
function BudgetKpi({ plan, execution, saved }: { plan: number; execution: BudgetExecution | undefined; saved: boolean }) {
  if (saved && execution === undefined) {
    return (
      <div className="grid gap-4 md:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    )
  }
  const fact = execution?.fact ?? 0
  const over = execution ? fact > plan : false
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <KpiCard label="План" value={formatTenge(plan)} />
      <KpiCard label="Факт" value={execution ? formatTenge(fact) : "—"} hint={execution?.truncated ? "Посчитано по первым 20 000 строкам" : execution ? "За весь период бюджета" : "Появится после сохранения"} />
      <KpiCard label="Исполнение" value={execution && plan ? formatExecution(Math.round((fact / plan) * 1000) / 10) : "—"} hint={execution ? (over ? `Перерасход ${formatTenge(fact - plan)}` : "В пределах плана") : undefined} hintTone={over ? "danger" : "neutral"} />
    </div>
  )
}
