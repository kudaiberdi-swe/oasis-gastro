import { useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Combobox, Field, Input, MoneyInput, SegmentedControl, Select, StatusPill, Textarea, type Column } from "@/shared/components/ui"
import { formatAmount, formatTenge } from "@/shared/lib/format"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useFinanceRecord, useFinanceReferences, useFinanceRestaurantFilter, type FinanceRecord, type FinanceReferences } from "../data/use-finance-records"
import { useOpenObligations } from "../data/use-obligations"
import { useCashflowForecast } from "../data/use-planning"
import { APPROVAL_TABS, categoriesForRestaurant, formatBusinessDate } from "../model/modules"
import { almatyMonth, calendarDraftOf, calendarSaveArgs, FLOW_LABELS, PRIORITY_LABELS, validateCalendar, type CalendarDraft, type Flow, type Priority } from "../model/planning"
import { CashflowMonth } from "./cashflow-month"
import { FinanceRegister } from "./finance-register"
import { FormSection, RecordAudit } from "./record-parts"
import { counterpartyName, ReadOnlyRows, RecordEditorPanel, RecordPanelFallback, useRecordEditor } from "./record-editor"

const MODULE = "payment-calendar"
const NONE = "none"

/** «Платёжный календарь» (/office/payment-calendar/:id?, W3-FIN-12): planned receipts and payments, their approval and the cash forecast. */
export function PaymentCalendarWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <PaymentCalendar />
    </PlatformErrorBoundary>
  )
}

const plannedAtOf = (row: FinanceRecord) => (typeof row.data.plannedAt === "string" ? row.data.plannedAt : row.businessDate)

function PaymentCalendar() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const selection = useMasterSelection(MODULE)
  const references = useFinanceReferences(MODULE)
  const record = useFinanceRecord(MODULE, selection.selectedId)
  const restaurants = useFinanceRestaurantFilter()
  const [month, setMonth] = useState(() => almatyMonth())
  const forecast = useCashflowForecast(month, restaurants.restaurantExternalId, !restaurants.loading)
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null
  const categoryName = (externalId: string | undefined) => references?.cashflowCategories.find((row) => row.externalId === externalId)?.name ?? "—"

  const columns: Column<FinanceRecord>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatBusinessDate(plannedAtOf(row))}</span>, sortValue: plannedAtOf },
    {
      key: "counterparty",
      header: "Контрагент",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">{counterpartyName(references?.counterparties, row.counterpartyExternalId)}</span>
          <span className="truncate text-caption text-muted-foreground">
            {FLOW_LABELS[row.data.direction === "incoming" ? "incoming" : "outgoing"]} · {row.name}
          </span>
        </div>
      ),
    },
    { key: "category", header: "Статья", cell: (row) => categoryName(row.cashflowCategoryExternalId) },
    { key: "amount", header: "Сумма, ₸", numeric: true, cell: (row) => `${row.data.direction === "incoming" ? "+" : "−"}${formatAmount(row.amount)}`, sortValue: (row) => row.amount },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <FinanceRegister
        moduleId={MODULE}
        caption="Платёжный календарь"
        tabs={APPROVAL_TABS}
        columns={columns}
        searchPlaceholder="Поиск: платёжный календарь"
        createLabel={canEdit ? "Новая запись" : undefined}
        onCreate={selection.openNew}
        formOpen={formOpen}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        emptyTitle="Плановых платежей пока нет"
        emptyDescription="Запланируйте поступление или платёж — он появится в календаре месяца и в прогнозе остатка."
        restaurantExternalId={restaurants.loading ? undefined : restaurants.restaurantExternalId}
        toolbar={restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
        kpis={<CashflowMonth month={month} onMonthChange={setMonth} forecast={forecast} />}
      />
      {selection.isNew && canEdit && references ? <CalendarPanel key="new" record={null} references={references} defaultRestaurantExternalId={restaurants.restaurantExternalId} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && record && references ? <CalendarPanel key={record.externalId} record={record} references={references} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && (!record || !references) ? <RecordPanelFallback title="Плановый платёж" missing={record === null} missingTitle="Запись не найдена" onClose={selection.close} /> : null}
    </div>
  )
}

interface CalendarPanelProps {
  record: FinanceRecord | null
  references: FinanceReferences
  defaultRestaurantExternalId?: string
  onClose: () => void
  onSaved: (externalId: string) => void
}

/** Card: Поток, Плановая дата, Приоритет, Контрагент, Основание, Статья ДДС, Сумма, Комментарий. */
function CalendarPanel({ record, references, defaultRestaurantExternalId, onClose, onSaved }: CalendarPanelProps) {
  const canViewObligations = useCan("office.payments.view")
  const editor = useRecordEditor<CalendarDraft>({
    moduleId: MODULE,
    lifecycle: "approval",
    record,
    baseline: calendarDraftOf(record, defaultRestaurantExternalId ?? references.restaurants[0]?.externalId ?? ""),
    validate: validateCalendar,
    toArgs: calendarSaveArgs,
    onSaved,
  })
  const { draft, set, errors, editable } = editor
  const open = useOpenObligations(
    canViewObligations && editable && draft.counterpartyExternalId ? { counterpartyExternalId: draft.counterpartyExternalId, direction: draft.direction === "outgoing" ? "payable" : "receivable", restaurantExternalId: draft.restaurantExternalId } : null,
  )
  const counterpartyOptions = references.counterparties.map((row) => ({ value: row.externalId, label: row.name }))
  const categoryOptions = categoriesForRestaurant(references.cashflowCategories, references.restaurants, draft.restaurantExternalId, record?.cashflowCategoryExternalId)
    .filter((row) => !row.direction || row.direction === "both" || row.direction === draft.direction)
    .map((row) => ({ value: row.externalId, label: row.name }))
  const restaurantName = references.restaurants.find((restaurant) => restaurant.externalId === draft.restaurantExternalId)?.name ?? "—"
  const obligationOptions = [{ value: NONE, label: "Без обязательства" }, ...(open ?? []).map((row) => ({ value: row.externalId, label: `${row.number} · ${formatTenge(row.open)}`, hint: typeof row.dueDate === "string" ? `срок ${formatBusinessDate(row.dueDate)}` : undefined }))]
  const pickObligation = (value: string) => {
    const obligation = open?.find((row) => row.externalId === value)
    if (!obligation) return set({ obligationExternalId: "" })
    set({ obligationExternalId: obligation.externalId, amount: obligation.open, name: draft.name || obligation.name, ...(typeof obligation.dueDate === "string" ? { plannedAt: obligation.dueDate } : {}) })
  }

  const readOnly: [string, ReactNode][] = [
    ["Поток", FLOW_LABELS[draft.direction]],
    ["Что планируется", draft.name],
    ["Плановая дата", formatBusinessDate(draft.plannedAt)],
    ["Приоритет", PRIORITY_LABELS[draft.priority]],
    ["Сумма", formatTenge(draft.amount ?? 0)],
    ["Контрагент", counterpartyName(references.counterparties, draft.counterpartyExternalId)],
    ["Статья ДДС", references.cashflowCategories.find((row) => row.externalId === draft.cashflowCategoryExternalId)?.name ?? "—"],
    ["Основание", draft.sourceDocument || (draft.obligationExternalId ? "Обязательство" : "—")],
    ["Ресторан", restaurantName],
    ["Комментарий", draft.comment || "—"],
  ]

  return (
    <RecordEditorPanel editor={editor} title={record ? `Плановый платёж ${record.number}` : "Новый плановый платёж"} formLabel="Плановый платёж" onClose={onClose}>
      {editable ? (
        <>
          <FormSection title="Основные реквизиты">
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-foreground">Поток</span>
              <SegmentedControl<Flow>
                aria-label="Поток"
                value={draft.direction}
                onValueChange={(direction) => set({ direction, obligationExternalId: "", cashflowCategoryExternalId: "" })}
                options={(Object.keys(FLOW_LABELS) as Flow[]).map((value) => ({ value, label: FLOW_LABELS[value] }))}
              />
            </div>
            <Field label="Что планируется" error={errors.name}>
              {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} autoComplete="off" placeholder="Например, аренда за октябрь" />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Плановая дата" error={errors.plannedAt}>
                {(control) => <Input {...control} type="date" value={draft.plannedAt} onChange={(event) => set({ plannedAt: event.target.value })} />}
              </Field>
              <Field label="Сумма" error={errors.amount}>
                {(control) => <MoneyInput {...control} value={draft.amount} onValueChange={(amount) => set({ amount })} />}
              </Field>
            </div>
            <Field label="Приоритет">{(control) => <Select {...control} value={draft.priority} onValueChange={(priority) => set({ priority: priority as Priority })} options={(Object.keys(PRIORITY_LABELS) as Priority[]).map((value) => ({ value, label: PRIORITY_LABELS[value] }))} />}</Field>
            {!record && references.restaurants.length > 1 ? (
              <Field label="Ресторан" error={errors.restaurantExternalId}>
                {(control) => <Select {...control} value={draft.restaurantExternalId || undefined} onValueChange={(restaurantExternalId) => set({ restaurantExternalId, obligationExternalId: "", cashflowCategoryExternalId: "" })} options={restaurantSelectOptions(references.restaurants)} />}
              </Field>
            ) : (
              <ReadOnlyRows rows={[["Ресторан", restaurantName]]} />
            )}
          </FormSection>
          <FormSection title="Параметры">
            <Field label="Контрагент">
              {(control) => <Combobox {...control} value={draft.counterpartyExternalId || undefined} onValueChange={(counterpartyExternalId) => set({ counterpartyExternalId, obligationExternalId: "" })} options={counterpartyOptions} placeholder="Не выбран" searchPlaceholder="Название контрагента" />}
            </Field>
            {canViewObligations && draft.counterpartyExternalId ? (
              <Field label="Обязательство" hint="Плановый платёж по обязательству заменяет его срок в прогнозе">
                {(control) => <Select {...control} value={draft.obligationExternalId || NONE} onValueChange={pickObligation} options={obligationOptions} />}
              </Field>
            ) : null}
            <Field label="Основание" hint="Договор, счёт или другой документ">
              {(control) => <Input {...control} value={draft.sourceDocument} onChange={(event) => set({ sourceDocument: event.target.value })} autoComplete="off" />}
            </Field>
            <Field label="Статья ДДС">
              {(control) => <Combobox {...control} value={draft.cashflowCategoryExternalId || undefined} onValueChange={(cashflowCategoryExternalId) => set({ cashflowCategoryExternalId })} options={categoryOptions} placeholder="Выберите статью" searchPlaceholder="Название статьи" />}
            </Field>
            <Field label="Комментарий">{(control) => <Textarea {...control} value={draft.comment} onChange={(event) => set({ comment: event.target.value })} />}</Field>
          </FormSection>
        </>
      ) : (
        <FormSection title="Основные реквизиты">
          <ReadOnlyRows rows={readOnly} />
        </FormSection>
      )}
      {record ? <RecordAudit record={record}>{editor.cancelAction}</RecordAudit> : null}
    </RecordEditorPanel>
  )
}
