import { useState, type MouseEvent, type ReactNode } from "react"
import { Link, useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Button, Combobox, Field, Input, MoneyInput, SegmentedControl, Select, StatusPill, Textarea, type Column } from "@/shared/components/ui"
import { formatAmount, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useFinanceRecord, useFinanceReferences, useFinanceRestaurantFilter, type FinanceRecord, type FinanceReferences } from "../data/use-finance-records"
import { usePayablesSummary } from "../data/use-obligations"
import { APPROVAL_TABS, formatBusinessDate } from "../model/modules"
import {
  isOverdue,
  OBLIGATION_DIRECTION_LABELS,
  OBLIGATION_KIND_LABELS,
  OBLIGATION_KINDS,
  obligationDraftOf,
  obligationOf,
  obligationSaveArgs,
  obligationSourceHref,
  obligationSourceLabel,
  payObligationHref,
  validateObligation,
  type ObligationDirection,
  type ObligationDraft,
} from "../model/settlements"
import { FinanceRegister } from "./finance-register"
import { PayablesKpi } from "./payables-kpi"
import { FormSection, RecordAudit } from "./record-parts"
import { counterpartyName, ReadOnlyRows, RecordEditorPanel, RecordPanelFallback, useRecordEditor } from "./record-editor"

const MODULE = "accounts-payable"
const ALL = "all"

const linkClass = cn("rounded-control text-accent underline-offset-4 hover:underline", focusRingClass)

/** «Задолженность» (/office/accounts-payable/:id?, W2-FIN-09): what we owe and are owed, with its own KPI. */
export function AccountsPayableWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <AccountsPayable />
    </PlatformErrorBoundary>
  )
}

/** «Оплатить» is possible for a posted obligation with something open and a counterparty to pay. */
function payable(record: FinanceRecord) {
  return record.status === "posted" && record.amount > 0 && Boolean(record.counterpartyExternalId)
}

function DueCell({ record }: { record: FinanceRecord }) {
  const { dueDate, open } = obligationOf(record)
  if (!dueDate) return <span className="text-muted-foreground">—</span>
  const overdue = record.status === "posted" && isOverdue(dueDate, open)
  return (
    <div className="flex flex-col whitespace-nowrap">
      <span className={cn(overdue && "font-semibold text-destructive")}>{formatBusinessDate(dueDate)}</span>
      {overdue ? <span className="text-caption text-destructive">Просрочено</span> : null}
    </div>
  )
}

function AccountsPayable() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const canPay = useCan("office.payments.edit")
  const selection = useMasterSelection(MODULE)
  const navigate = useNavigate()
  const references = useFinanceReferences(MODULE)
  const record = useFinanceRecord(MODULE, selection.selectedId)
  const restaurants = useFinanceRestaurantFilter()
  const summary = usePayablesSummary(restaurants.restaurantExternalId, !restaurants.loading)
  const [direction, setDirection] = useState<ObligationDirection | typeof ALL>(ALL)
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const pay = (event: MouseEvent, row: FinanceRecord) => {
    // The row itself leads to the source document.
    event.stopPropagation()
    navigate(payObligationHref({ ...row, direction: obligationOf(row).direction }))
  }

  const columns: Column<FinanceRecord>[] = [
    {
      key: "number",
      header: "Номер",
      cell: (row) => {
        const parsed = obligationOf(row)
        return (
          <div className="flex min-w-0 flex-col">
            <span className="font-semibold whitespace-nowrap">{row.number}</span>
            <span className="max-w-44 text-caption text-muted-foreground">{[obligationSourceLabel(parsed.sourceModuleId), parsed.sourceNumber].filter(Boolean).join(" ")}</span>
          </div>
        )
      },
    },
    { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatBusinessDate(row.businessDate)}</span>, sortValue: (row) => row.businessDate },
    {
      key: "counterparty",
      header: "Контрагент",
      cell: (row) => (
        // A bounded width: a long counterparty wraps and the obligation name truncates, so the table fits
        // at ~1500px and «Оплатить» in the last column is never cut off.
        <div className="flex w-56 max-w-full min-w-0 flex-col">
          <span className="font-semibold break-words">{row.counterpartyExternalId ? counterpartyName(references?.counterparties, row.counterpartyExternalId) : OBLIGATION_KIND_LABELS[obligationOf(row).kind]}</span>
          <span className="truncate text-caption text-muted-foreground">{row.name}</span>
        </div>
      ),
    },
    { key: "original", header: "Сумма, ₸", numeric: true, cell: (row) => formatAmount(obligationOf(row).original), sortValue: (row) => obligationOf(row).original },
    { key: "allocated", header: "Оплачено, ₸", numeric: true, cell: (row) => formatAmount(obligationOf(row).allocated) },
    { key: "open", header: "Остаток, ₸", numeric: true, cell: (row) => <span className={cn(row.amount > 0 && "font-semibold")}>{formatAmount(row.amount)}</span>, sortValue: (row) => row.amount },
    { key: "due", header: "Срок", cell: (row) => <DueCell record={row} />, sortValue: (row) => obligationOf(row).dueDate || null },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
    ...(canPay
      ? [
          {
            key: "pay",
            header: <span className="sr-only">Действия</span>,
            cell: (row: FinanceRecord) =>
              payable(row) ? (
                <Button variant="secondary" size="sm" onClick={(event) => pay(event, row)} aria-label={`Оплатить ${row.number}`}>
                  {obligationOf(row).direction === "payable" ? "Оплатить" : "Получить оплату"}
                </Button>
              ) : null,
          },
        ]
      : []),
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <FinanceRegister
        moduleId={MODULE}
        caption="Задолженность"
        tabs={APPROVAL_TABS}
        columns={columns}
        searchPlaceholder="Поиск: задолженность"
        createLabel={canEdit ? "Новое обязательство" : undefined}
        onCreate={selection.openNew}
        formOpen={formOpen}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        // The row is a link to the document the obligation came from; a manual one opens its card.
        onRowOpen={(row) => {
          const parsed = obligationOf(row)
          const href = obligationSourceHref(parsed.sourceModuleId, parsed.sourceExternalId)
          if (href) navigate(href)
          else selection.select(row.externalId)
        }}
        emptyTitle="Задолженности нет"
        emptyDescription="Обязательства появляются при проведении приходов, актов услуг и ведомостей; прочие можно завести вручную."
        restaurantExternalId={restaurants.loading ? undefined : restaurants.restaurantExternalId}
        kpis={<PayablesKpi summary={summary} />}
        filterRows={direction === ALL ? undefined : (row) => obligationOf(row).direction === direction}
        toolbar={
          <>
            <SegmentedControl<ObligationDirection | typeof ALL>
              aria-label="Вид задолженности"
              value={direction}
              onValueChange={setDirection}
              options={[
                { value: ALL, label: "Вся" },
                { value: "payable", label: OBLIGATION_DIRECTION_LABELS.payable },
                { value: "receivable", label: OBLIGATION_DIRECTION_LABELS.receivable },
              ]}
            />
            {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
          </>
        }
      />
      {selection.isNew && canEdit && references ? <ObligationPanel key="new" record={null} references={references} defaultRestaurantExternalId={restaurants.restaurantExternalId} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && record && references ? <ObligationPanel key={record.externalId} record={record} references={references} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && (!record || !references) ? <RecordPanelFallback title="Обязательство" missing={record === null} missingTitle="Обязательство не найдено" onClose={selection.close} /> : null}
    </div>
  )
}

interface ObligationPanelProps {
  record: FinanceRecord | null
  references: FinanceReferences
  defaultRestaurantExternalId?: string
  onClose: () => void
  onSaved: (externalId: string) => void
}

/**
 * Card of an obligation: Контрагент, Тип, Срок оплаты, Документ-основание, Распределено, Комментарий.
 * Document-created obligations are read-only and reversed with their document; manual ones go through approval.
 */
function ObligationPanel({ record, references, defaultRestaurantExternalId, onClose, onSaved }: ObligationPanelProps) {
  const canPay = useCan("office.payments.edit")
  const parsed = record ? obligationOf(record) : null
  const reverseBlocked = parsed && !parsed.manual ? "Обязательство создано документом-основанием и сторнируется вместе с ним." : parsed && parsed.allocated > 0 ? "По обязательству есть оплаты — сначала сторнируйте платежи." : undefined
  const editor = useRecordEditor<ObligationDraft>({
    moduleId: MODULE,
    lifecycle: "approval",
    record,
    baseline: obligationDraftOf(record, defaultRestaurantExternalId ?? references.restaurants[0]?.externalId ?? ""),
    validate: validateObligation,
    toArgs: obligationSaveArgs,
    onSaved,
    reverseBlocked,
    cancelBlocked: Boolean(parsed && !parsed.manual),
  })
  const { draft, set, errors, editable } = editor
  const counterpartyOptions = references.counterparties.map((row) => ({ value: row.externalId, label: row.name }))
  const restaurantName = references.restaurants.find((restaurant) => restaurant.externalId === draft.restaurantExternalId)?.name ?? draft.restaurantExternalId
  const sourceHref = parsed ? obligationSourceHref(parsed.sourceModuleId, parsed.sourceExternalId) : null
  const source: ReactNode = !parsed ? "—" : sourceHref ? (
    <Link to={sourceHref} className={linkClass}>
      {[obligationSourceLabel(parsed.sourceModuleId), parsed.sourceNumber].filter(Boolean).join(" ")}
    </Link>
  ) : (
    [obligationSourceLabel(parsed.sourceModuleId), parsed.sourceNumber].filter(Boolean).join(" ")
  )
  const overdue = Boolean(record && parsed && record.status === "posted" && isOverdue(parsed.dueDate, parsed.open))

  return (
    <RecordEditorPanel editor={editor} title={record ? `Обязательство ${record.number}` : "Новое обязательство"} formLabel="Обязательство" onClose={onClose}>
      <FormSection title="Основные реквизиты">
        {editable ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-foreground">Тип</span>
              <SegmentedControl<ObligationDirection>
                aria-label="Тип задолженности"
                value={draft.direction}
                onValueChange={(direction) => set({ direction })}
                options={(Object.keys(OBLIGATION_DIRECTION_LABELS) as ObligationDirection[]).map((value) => ({ value, label: OBLIGATION_DIRECTION_LABELS[value] }))}
              />
            </div>
            <Field label="Содержание" error={errors.name}>
              {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} autoComplete="off" placeholder="Например, штраф по договору аренды" />}
            </Field>
            <Field label="Контрагент" error={errors.counterpartyExternalId}>
              {(control) => (
                <Combobox {...control} value={draft.counterpartyExternalId || undefined} onValueChange={(counterpartyExternalId) => set({ counterpartyExternalId })} options={counterpartyOptions} placeholder="Не выбран" searchPlaceholder="Название контрагента" />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Дата" error={errors.businessDate}>
                {(control) => <Input {...control} type="date" value={draft.businessDate} onChange={(event) => set({ businessDate: event.target.value })} />}
              </Field>
              <Field label="Сумма" error={errors.amount}>
                {(control) => <MoneyInput {...control} value={draft.amount} onValueChange={(amount) => set({ amount })} />}
              </Field>
            </div>
            {!record && references.restaurants.length > 1 ? (
              <Field label="Ресторан" error={errors.restaurantExternalId}>
                {(control) => (
                  <Select
                    {...control}
                    value={draft.restaurantExternalId || undefined}
                    onValueChange={(restaurantExternalId) => set({ restaurantExternalId })}
                    options={restaurantSelectOptions(references.restaurants)}
                  />
                )}
              </Field>
            ) : (
              <ReadOnlyRows rows={[["Ресторан", restaurantName || "—"]]} />
            )}
          </>
        ) : (
          <ReadOnlyRows
            rows={[
              ["Тип", OBLIGATION_DIRECTION_LABELS[draft.direction]],
              ["Содержание", draft.name],
              ["Контрагент", counterpartyName(references.counterparties, draft.counterpartyExternalId)],
              ["Ресторан", restaurantName || "—"],
              ["Дата", formatBusinessDate(draft.businessDate)],
              ["Документ-основание", source],
            ]}
          />
        )}
      </FormSection>
      <FormSection title="Параметры">
        {editable ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Вид">
                {(control) => <Select {...control} value={draft.kind} onValueChange={(kind) => set({ kind: kind as ObligationDraft["kind"] })} options={OBLIGATION_KINDS.map((kind) => ({ value: kind, label: OBLIGATION_KIND_LABELS[kind] }))} />}
              </Field>
              <Field label="Срок оплаты" error={errors.dueDate}>
                {(control) => <Input {...control} type="date" value={draft.dueDate} onChange={(event) => set({ dueDate: event.target.value })} />}
              </Field>
            </div>
            <Field label="Комментарий">
              {(control) => <Textarea {...control} value={draft.comment} onChange={(event) => set({ comment: event.target.value })} />}
            </Field>
          </>
        ) : (
          <ReadOnlyRows
            rows={[
              ["Вид", OBLIGATION_KIND_LABELS[draft.kind]],
              ["Срок оплаты", draft.dueDate ? <span className={cn(overdue && "font-semibold text-destructive")}>{formatBusinessDate(draft.dueDate)}{overdue ? " · просрочено" : ""}</span> : "—"],
              ["Комментарий", draft.comment || "—"],
            ]}
          />
        )}
      </FormSection>
      {record && parsed && record.status !== "draft" ? (
        <FormSection title="Расчёты">
          <ReadOnlyRows
            rows={[
              ["Сумма", formatTenge(parsed.original)],
              ["Распределено", formatTenge(parsed.allocated)],
              ["Остаток", <span className={cn(parsed.open > 0 && "font-semibold")}>{formatTenge(parsed.open)}</span>],
            ]}
          />
          {canPay && payable(record) ? (
            <Button variant="secondary" size="sm" className="self-start" asChild>
              <Link to={payObligationHref({ ...record, direction: parsed.direction })}>{parsed.direction === "payable" ? "Оплатить" : "Получить оплату"}</Link>
            </Button>
          ) : null}
        </FormSection>
      ) : null}
      {record ? <RecordAudit record={record}>{editor.cancelAction}</RecordAudit> : null}
    </RecordEditorPanel>
  )
}
