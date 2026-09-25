import { useState, type ReactNode } from "react"
import { useSearchParams } from "react-router"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Banner, Combobox, Field, Input, MoneyInput, SegmentedControl, Select, StatusPill, Textarea, type Column } from "@/shared/components/ui"
import { formatAmount, formatTenge } from "@/shared/lib/format"

import { useFinanceRecord, useFinanceReferences, useFinanceRestaurantFilter, type FinanceRecord, type FinanceReferences } from "../data/use-finance-records"
import { useOpenObligations, usePaymentAllocations, useSetPaymentAllocations } from "../data/use-obligations"
import { APPROVAL_TABS, formatBusinessDate } from "../model/modules"
import {
  obligationDirectionFor,
  PAYMENT_DIRECTION_LABELS,
  PAYMENT_METHOD_LABELS,
  paymentDirectionFor,
  paymentDraftOf,
  paymentSaveArgs,
  validatePayment,
  type Allocation,
  type ObligationDirection,
  type PaymentDirection,
  type PaymentDraft,
  type PaymentMethod,
} from "../model/settlements"
import { FinanceRegister } from "./finance-register"
import { PaymentAllocationTable } from "./payment-allocation-table"
import { FormSection, RecordAudit } from "./record-parts"
import { counterpartyName, ReadOnlyRows, RecordEditorPanel, RecordPanelFallback, useRecordEditor } from "./record-editor"

const MODULE = "payments"

/** «Платежи» (/office/payments/:id?, W2-FIN-10): incoming and outgoing payments, allocated to obligations. */
export function PaymentsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Payments />
    </PlatformErrorBoundary>
  )
}

type Prefill = { obligation: string; counterparty: string; restaurant: string; direction: ObligationDirection }

/** «Оплатить» in «Задолженность» opens /office/payments/new?obligation=…&counterparty=…&restaurant=…&direction=… */
function usePrefill(): Prefill | null {
  const [params] = useSearchParams()
  const obligation = params.get("obligation")
  const counterparty = params.get("counterparty")
  const restaurant = params.get("restaurant")
  const direction = params.get("direction")
  if (!obligation || !counterparty || !restaurant || (direction !== "payable" && direction !== "receivable")) return null
  return { obligation, counterparty, restaurant, direction }
}

function Payments() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const selection = useMasterSelection(MODULE)
  const references = useFinanceReferences(MODULE)
  const record = useFinanceRecord(MODULE, selection.selectedId)
  const restaurants = useFinanceRestaurantFilter()
  const prefill = usePrefill()
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const columns: Column<FinanceRecord>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatBusinessDate(row.businessDate)}</span>, sortValue: (row) => row.businessDate },
    {
      key: "counterparty",
      header: "Контрагент",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">{counterpartyName(references?.counterparties, row.counterpartyExternalId)}</span>
          <span className="truncate text-caption text-muted-foreground">{row.name}</span>
        </div>
      ),
    },
    { key: "direction", header: "Направление", cell: (row) => PAYMENT_DIRECTION_LABELS[row.data.direction === "incoming" ? "incoming" : "outgoing"] },
    { key: "method", header: "Счёт", cell: (row) => PAYMENT_METHOD_LABELS[row.data.method === "cash" ? "cash" : "bank"] },
    { key: "amount", header: "Сумма, ₸", numeric: true, cell: (row) => formatAmount(row.amount), sortValue: (row) => row.amount },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  const panelProps = { onClose: selection.close, onSaved: selection.select }
  return (
    <div className="flex min-h-0 flex-1">
      <FinanceRegister
        moduleId={MODULE}
        caption="Платежи"
        tabs={APPROVAL_TABS}
        columns={columns}
        searchPlaceholder="Поиск: платежи"
        createLabel={canEdit ? "Новый платёж" : undefined}
        onCreate={selection.openNew}
        formOpen={formOpen}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        emptyTitle="Платежей пока нет"
        emptyDescription="Создайте платёж контрагенту и распределите его по открытым обязательствам."
        restaurantExternalId={restaurants.loading ? undefined : restaurants.restaurantExternalId}
        toolbar={restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
      />
      {selection.isNew && canEdit && references ? (
        prefill ? (
          <PrefilledPayment key={`new-${prefill.obligation}`} prefill={prefill} references={references} {...panelProps} />
        ) : (
          <PaymentPanel key="new" record={null} references={references} allocations={[]} defaultRestaurantExternalId={restaurants.restaurantExternalId} {...panelProps} />
        )
      ) : null}
      {selection.selectedId !== null && record && references ? <SavedPayment key={record.externalId} record={record} references={references} {...panelProps} /> : null}
      {selection.selectedId !== null && (!record || !references) ? <RecordPanelFallback title="Платёж" missing={record === null} missingTitle="Платёж не найден" onClose={selection.close} /> : null}
    </div>
  )
}

interface PanelBase {
  references: FinanceReferences
  onClose: () => void
  onSaved: (externalId: string) => void
}

/** A saved payment's card opens once its allocation table is loaded (the form compares against it). */
function SavedPayment({ record, ...rest }: PanelBase & { record: FinanceRecord }) {
  const allocations = usePaymentAllocations(record.externalId)
  if (allocations === undefined) return <RecordPanelFallback title={`Платёж ${record.number}`} missing={false} missingTitle="" onClose={rest.onClose} />
  return <PaymentPanel record={record} allocations={allocations} {...rest} />
}

/** «Оплатить»: a new draft with the obligation's counterparty, open remainder and allocation filled in. */
function PrefilledPayment({ prefill, references, onClose, onSaved }: PanelBase & { prefill: Prefill }) {
  const open = useOpenObligations({ counterpartyExternalId: prefill.counterparty, direction: prefill.direction, restaurantExternalId: prefill.restaurant })
  if (open === undefined) return <RecordPanelFallback title="Новый платёж" missing={false} missingTitle="" onClose={onClose} />
  const obligation = open.find((row) => row.externalId === prefill.obligation)
  const base = paymentDraftOf(null, prefill.restaurant)
  const initialDraft: PaymentDraft = {
    ...base,
    direction: paymentDirectionFor(prefill.direction),
    counterpartyExternalId: prefill.counterparty,
    ...(obligation ? { name: obligation.name, amount: obligation.open, allocations: [{ obligationExternalId: obligation.externalId, amount: obligation.open }] } : {}),
  }
  return (
    <PaymentPanel
      record={null}
      references={references}
      allocations={[]}
      defaultRestaurantExternalId={prefill.restaurant}
      initialDraft={initialDraft}
      notice={obligation ? undefined : "Обязательство уже погашено или сторнировано — выберите другое в распределении."}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}

interface PaymentPanelProps extends PanelBase {
  record: FinanceRecord | null
  allocations: Allocation[]
  defaultRestaurantExternalId?: string
  initialDraft?: PaymentDraft
  notice?: string
}

/** Card of a payment: Направление, Контрагент, Способ, Статья ДДС, Дата платежа, «Распределение», Комментарий. */
function PaymentPanel({ record, references, allocations, defaultRestaurantExternalId, initialDraft, notice, onClose, onSaved }: PaymentPanelProps) {
  const setAllocations = useSetPaymentAllocations()
  // Filled below from the open obligations; validate runs on a click and reads this render's value.
  let openRemainders: Record<string, number> = {}
  const editor = useRecordEditor<PaymentDraft>({
    moduleId: MODULE,
    lifecycle: "approval",
    record,
    baseline: paymentDraftOf(record, defaultRestaurantExternalId ?? references.restaurants[0]?.externalId ?? "", allocations),
    initialDraft,
    validate: (draft) => validatePayment(draft, openRemainders),
    toArgs: paymentSaveArgs,
    // The allocation table lives beside the record; a new payment without lines has nothing to write.
    afterSave: async (paymentExternalId, draft) => {
      if (record || draft.allocations.length) await setAllocations({ paymentExternalId, allocations: draft.allocations })
    },
    onSaved,
  })
  const { draft, set, errors, editable } = editor
  const obligationDirection = obligationDirectionFor(draft.direction)
  const open = useOpenObligations(draft.counterpartyExternalId ? { counterpartyExternalId: draft.counterpartyExternalId, direction: obligationDirection, restaurantExternalId: draft.restaurantExternalId } : null)
  const obligations = draft.counterpartyExternalId ? open : null
  openRemainders = Object.fromEntries((obligations ?? []).map((row) => [row.externalId, row.open]))

  const counterpartyOptions = references.counterparties.map((row) => ({ value: row.externalId, label: row.name }))
  const categoryOptions = references.cashflowCategories.filter((row) => !row.direction || row.direction === "both" || row.direction === draft.direction).map((row) => ({ value: row.externalId, label: row.name }))
  const categoryName = references.cashflowCategories.find((row) => row.externalId === draft.cashflowCategoryExternalId)?.name ?? "—"
  const restaurantName = references.restaurants.find((restaurant) => restaurant.externalId === draft.restaurantExternalId)?.name ?? draft.restaurantExternalId
  // Allocations belong to one counterparty, direction and restaurant: changing any of them clears the table.
  const reset = (patch: Partial<PaymentDraft>) => set({ ...patch, allocations: [] })

  const readOnlyMain: [string, ReactNode][] = [
    ["Направление", PAYMENT_DIRECTION_LABELS[draft.direction]],
    ["Назначение", draft.name],
    ["Контрагент", counterpartyName(references.counterparties, draft.counterpartyExternalId)],
    ["Ресторан", restaurantName || "—"],
    ["Дата платежа", formatBusinessDate(draft.businessDate)],
    ["Сумма", formatTenge(draft.amount ?? 0)],
  ]

  return (
    <RecordEditorPanel editor={editor} title={record ? `Платёж ${record.number}` : "Новый платёж"} formLabel="Платёж" onClose={onClose}>
      {notice ? (
        <Banner tone="warning" title="Обязательство не найдено">
          {notice}
        </Banner>
      ) : null}
      <FormSection title="Основные реквизиты">
        {editable ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-foreground">Направление</span>
              <SegmentedControl<PaymentDirection>
                aria-label="Направление платежа"
                value={draft.direction}
                onValueChange={(direction) => reset({ direction, cashflowCategoryExternalId: "" })}
                options={(Object.keys(PAYMENT_DIRECTION_LABELS) as PaymentDirection[]).map((value) => ({ value, label: PAYMENT_DIRECTION_LABELS[value] }))}
              />
            </div>
            <Field label="Назначение платежа" error={errors.name}>
              {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} autoComplete="off" placeholder="Например, оплата по счёту № 15" />}
            </Field>
            <Field label="Контрагент" error={errors.counterpartyExternalId}>
              {(control) => (
                <Combobox {...control} value={draft.counterpartyExternalId || undefined} onValueChange={(counterpartyExternalId) => reset({ counterpartyExternalId })} options={counterpartyOptions} placeholder="Не выбран" searchPlaceholder="Название контрагента" />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Дата платежа" error={errors.businessDate}>
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
                    onValueChange={(restaurantExternalId) => reset({ restaurantExternalId })}
                    options={references.restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name }))}
                  />
                )}
              </Field>
            ) : (
              <ReadOnlyRows rows={[["Ресторан", restaurantName || "—"]]} />
            )}
          </>
        ) : (
          <ReadOnlyRows rows={readOnlyMain} />
        )}
      </FormSection>
      <FormSection title="Параметры">
        {editable ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-foreground">Способ</span>
              <SegmentedControl<PaymentMethod>
                aria-label="Способ оплаты"
                value={draft.method}
                onValueChange={(method) => set({ method })}
                options={(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }))}
              />
            </div>
            <Field label="Статья ДДС" error={errors.cashflowCategoryExternalId} hint={categoryOptions.length ? undefined : "Нет активных статей этого направления — добавьте в «Статьи ДДС»"}>
              {(control) => <Combobox {...control} value={draft.cashflowCategoryExternalId || undefined} onValueChange={(cashflowCategoryExternalId) => set({ cashflowCategoryExternalId })} options={categoryOptions} placeholder="Выберите статью" searchPlaceholder="Название статьи" />}
            </Field>
            <Field label="Комментарий">
              {(control) => <Textarea {...control} value={draft.comment} onChange={(event) => set({ comment: event.target.value })} />}
            </Field>
          </>
        ) : (
          <ReadOnlyRows
            rows={[
              ["Способ", PAYMENT_METHOD_LABELS[draft.method]],
              ["Статья ДДС", categoryName],
              ["Комментарий", draft.comment || "—"],
            ]}
          />
        )}
      </FormSection>
      <FormSection title="Распределение">
        <PaymentAllocationTable obligations={obligations} allocations={draft.allocations} paymentAmount={draft.amount ?? 0} editable={editable} onChange={(next) => set({ allocations: next })} error={errors.allocations} />
      </FormSection>
      {record ? <RecordAudit record={record}>{editor.cancelAction}</RecordAudit> : null}
    </RecordEditorPanel>
  )
}
