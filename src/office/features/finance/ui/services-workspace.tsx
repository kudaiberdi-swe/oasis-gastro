import { useState, type ReactNode } from "react"
import { Link } from "react-router"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Combobox, Field, Input, MoneyInput, SegmentedControl, Select, Skeleton, StatusPill, Textarea, type Column } from "@/shared/components/ui"
import { formatAmount, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { useFinanceRecord, useFinanceReferences, useFinanceRestaurantFilter, type FinanceRecord, type FinanceReferences } from "../data/use-finance-records"
import { accountLabel, DOCUMENT_TABS, formatBusinessDate } from "../model/modules"
import {
  obligationExternalId,
  obligationOf,
  SERVICE_DEFAULT_ACCOUNTS,
  SERVICE_DIRECTION_LABELS,
  serviceDraftOf,
  serviceSaveArgs,
  validateService,
  vatOf,
  VAT_RATES,
  type ServiceDirection,
  type ServiceDraft,
} from "../model/settlements"
import { FinanceRegister } from "./finance-register"
import { FormSection, RecordAudit } from "./record-parts"
import { counterpartyName, ReadOnlyRows, RecordEditorPanel, RecordPanelFallback, useRecordEditor } from "./record-editor"

const MODULE = "services"
const DEFAULT = "default"

const linkClass = cn("rounded-control text-accent underline-offset-4 hover:underline", focusRingClass)

/** «Акты услуг» (/office/services/:id?, W2-FIN-08): received and provided services, VAT and the obligation they create. */
export function ServicesWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Services />
    </PlatformErrorBoundary>
  )
}

/** The obligation a posted act created, when the user may see «Задолженность». */
function useServiceObligation(record: Pick<FinanceRecord, "externalId" | "status">) {
  const canView = useCan("office.accounts-payable.view")
  const settled = record.status === "posted" || record.status === "reversed"
  const obligation = useFinanceRecord("accounts-payable", canView && settled ? obligationExternalId(MODULE, record.externalId) : null)
  return { canView, settled, obligation }
}

/** «Оплачено ₸»: what payments settled against the act's obligation. */
function PaidCell({ record }: { record: FinanceRecord }) {
  const { canView, settled, obligation } = useServiceObligation(record)
  if (!canView || !settled) return <span className="text-muted-foreground">—</span>
  if (obligation === undefined) return <Skeleton className="ml-auto h-4 w-16" />
  if (!obligation) return <span className="text-muted-foreground">—</span>
  return <span>{formatAmount(obligationOf(obligation).allocated)}</span>
}

function Services() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const selection = useMasterSelection(MODULE)
  const references = useFinanceReferences(MODULE)
  const record = useFinanceRecord(MODULE, selection.selectedId)
  const restaurants = useFinanceRestaurantFilter()
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
    { key: "direction", header: "Направление", cell: (row) => SERVICE_DIRECTION_LABELS[row.data.serviceDirection === "provided" ? "provided" : "received"] },
    { key: "amount", header: "Сумма, ₸", numeric: true, cell: (row) => formatAmount(row.amount), sortValue: (row) => row.amount },
    { key: "paid", header: "Оплачено, ₸", numeric: true, cell: (row) => <PaidCell record={row} /> },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <FinanceRegister
        moduleId={MODULE}
        caption="Акты услуг"
        tabs={DOCUMENT_TABS}
        columns={columns}
        searchPlaceholder="Поиск: акты услуг"
        createLabel={canEdit ? "Новый акт" : undefined}
        onCreate={selection.openNew}
        formOpen={formOpen}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        emptyTitle="Актов услуг пока нет"
        emptyDescription="Проведите полученную или оказанную услугу — по ней появится задолженность и НДС."
        restaurantExternalId={restaurants.loading ? undefined : restaurants.restaurantExternalId}
        toolbar={restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
      />
      {selection.isNew && canEdit && references ? <ServicePanel key="new" record={null} references={references} defaultRestaurantExternalId={restaurants.restaurantExternalId} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && record && references ? <ServicePanel key={record.externalId} record={record} references={references} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && (!record || !references) ? <RecordPanelFallback title="Акт услуг" missing={record === null} missingTitle="Акт не найден" onClose={selection.close} /> : null}
    </div>
  )
}

/** «Расчёты» of a posted act: its obligation, what is paid and what is open. */
function Settlement({ record }: { record: FinanceRecord }) {
  const { canView, obligation } = useServiceObligation(record)
  if (!canView) return null
  return (
    <FormSection title="Расчёты">
      {obligation === undefined ? (
        <Skeleton className="h-12 w-full" />
      ) : !obligation ? (
        <p className="text-body-sm text-muted-foreground">Обязательство по акту не найдено.</p>
      ) : (
        <ReadOnlyRows
          rows={[
            [
              "Обязательство",
              <Link to={`/office/accounts-payable/${encodeURIComponent(obligation.externalId)}`} className={linkClass}>
                {obligation.number}
              </Link>,
            ],
            ["Оплачено", formatTenge(obligationOf(obligation).allocated)],
            ["Остаток", <span className={cn(obligation.amount > 0 && "font-semibold")}>{formatTenge(obligation.amount)}</span>],
          ]}
        />
      )}
    </FormSection>
  )
}

interface ServicePanelProps {
  record: FinanceRecord | null
  references: FinanceReferences
  defaultRestaurantExternalId?: string
  onClose: () => void
  onSaved: (externalId: string) => void
}

/** Card of a service act: Вид акта, Контрагент, Дебет, Кредит, НДС %, Договор, Срок оплаты, Содержание услуги; «в т. ч. НДС». */
function ServicePanel({ record, references, defaultRestaurantExternalId, onClose, onSaved }: ServicePanelProps) {
  const editor = useRecordEditor<ServiceDraft>({
    moduleId: MODULE,
    lifecycle: "document",
    record,
    baseline: serviceDraftOf(record, defaultRestaurantExternalId ?? references.restaurants[0]?.externalId ?? ""),
    validate: validateService,
    toArgs: serviceSaveArgs,
    onSaved,
  })
  const { draft, set, errors, editable } = editor
  const account = (externalId: string) => references.accounts.find((row) => row.externalId === externalId)
  const defaults = SERVICE_DEFAULT_ACCOUNTS[draft.serviceDirection]
  const accountName = (externalId: string, defaultId: string) => {
    const id = externalId || defaultId
    return account(id) ? accountLabel(account(id)) : id
  }
  const accountOptions = (defaultId: string) => [{ value: DEFAULT, label: `По умолчанию — ${accountName("", defaultId)}` }, ...references.accounts.map((row) => ({ value: row.externalId, label: accountLabel(row) }))]
  const counterpartyOptions = references.counterparties.map((row) => ({ value: row.externalId, label: row.name }))
  const restaurantName = references.restaurants.find((restaurant) => restaurant.externalId === draft.restaurantExternalId)?.name ?? draft.restaurantExternalId
  const amount = draft.amount ?? 0
  // A saved act shows the server's VAT; the draft — the same formula.
  const vat = record && !editor.dirty && typeof record.data.vatAmount === "number" ? record.data.vatAmount : vatOf(amount, draft.vatRate)
  const total = (
    <p className="rounded-control bg-muted px-3 py-2 text-body-sm tabular-nums text-foreground">
      Итого {formatTenge(amount)} · в т. ч. НДС {draft.vatRate} %: {formatTenge(vat)} · без НДС {formatTenge(amount - vat)}
    </p>
  )

  const readOnlyMain: [string, ReactNode][] = [
    ["Вид акта", SERVICE_DIRECTION_LABELS[draft.serviceDirection]],
    ["Название", draft.name],
    ["Контрагент", counterpartyName(references.counterparties, draft.counterpartyExternalId)],
    ["Ресторан", restaurantName || "—"],
    ["Дата", formatBusinessDate(draft.businessDate)],
    ["Сумма с НДС", formatTenge(amount)],
    ["НДС", `${draft.vatRate} %`],
  ]

  return (
    <RecordEditorPanel editor={editor} title={record ? `Акт ${record.number}` : "Новый акт услуг"} formLabel="Акт услуг" onClose={onClose}>
      <FormSection title="Основные реквизиты">
        {editable ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-foreground">Вид акта</span>
              <SegmentedControl<ServiceDirection>
                aria-label="Вид акта"
                value={draft.serviceDirection}
                onValueChange={(serviceDirection) => set({ serviceDirection })}
                options={(Object.keys(SERVICE_DIRECTION_LABELS) as ServiceDirection[]).map((value) => ({ value, label: SERVICE_DIRECTION_LABELS[value] }))}
              />
            </div>
            <Field label="Название" error={errors.name}>
              {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} autoComplete="off" placeholder="Например, аренда помещения за сентябрь" />}
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
              <Field label="Сумма с НДС" error={errors.amount}>
                {(control) => <MoneyInput {...control} value={draft.amount} onValueChange={(value) => set({ amount: value })} />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="НДС">
                {(control) => <Select {...control} value={String(draft.vatRate)} onValueChange={(value) => set({ vatRate: Number(value) })} options={VAT_RATES.map((rate) => ({ value: String(rate), label: rate ? `${rate} %` : "Без НДС" }))} />}
              </Field>
              {!record && references.restaurants.length > 1 ? (
                <Field label="Ресторан" error={errors.restaurantExternalId}>
                  {(control) => (
                    <Select
                      {...control}
                      value={draft.restaurantExternalId || undefined}
                      onValueChange={(restaurantExternalId) => set({ restaurantExternalId })}
                      options={references.restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name }))}
                    />
                  )}
                </Field>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <span className="text-body-sm font-medium text-muted-foreground">Ресторан</span>
                  <span className="flex h-11 items-center text-body-sm text-foreground">{restaurantName || "—"}</span>
                </div>
              )}
            </div>
            {total}
          </>
        ) : (
          <>
            <ReadOnlyRows rows={readOnlyMain} />
            {total}
          </>
        )}
      </FormSection>
      <FormSection title="Параметры">
        {editable ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Дебет">
                {(control) => (
                  <Combobox
                    {...control}
                    value={draft.debitAccountExternalId || DEFAULT}
                    onValueChange={(value) => set({ debitAccountExternalId: !value || value === DEFAULT ? "" : value })}
                    options={accountOptions(defaults.debit)}
                    searchPlaceholder="Код или название"
                  />
                )}
              </Field>
              <Field label="Кредит" error={errors.creditAccountExternalId}>
                {(control) => (
                  <Combobox
                    {...control}
                    value={draft.creditAccountExternalId || DEFAULT}
                    onValueChange={(value) => set({ creditAccountExternalId: !value || value === DEFAULT ? "" : value })}
                    options={accountOptions(defaults.credit)}
                    searchPlaceholder="Код или название"
                  />
                )}
              </Field>
            </div>
            <p className="text-caption text-muted-foreground">НДС проводится отдельной строкой: {draft.serviceDirection === "received" ? "к зачёту" : "к уплате"}.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Договор">
                {(control) => <Input {...control} value={draft.contract} onChange={(event) => set({ contract: event.target.value })} autoComplete="off" placeholder="№ и дата договора" />}
              </Field>
              <Field label="Срок оплаты" error={errors.dueDate}>
                {(control) => <Input {...control} type="date" value={draft.dueDate} onChange={(event) => set({ dueDate: event.target.value })} />}
              </Field>
            </div>
            <Field label="Содержание услуги">
              {(control) => <Textarea {...control} value={draft.description} onChange={(event) => set({ description: event.target.value })} />}
            </Field>
          </>
        ) : (
          <ReadOnlyRows
            rows={[
              ["Дебет", accountName(draft.debitAccountExternalId, defaults.debit)],
              ["Кредит", accountName(draft.creditAccountExternalId, defaults.credit)],
              ["Договор", draft.contract || "—"],
              ["Срок оплаты", draft.dueDate ? formatBusinessDate(draft.dueDate) : "—"],
              ["Содержание услуги", draft.description || "—"],
            ]}
          />
        )}
      </FormSection>
      {record && record.status !== "draft" && record.status !== "cancelled" ? <Settlement record={record} /> : null}
      {record ? <RecordAudit record={record}>{editor.cancelAction}</RecordAudit> : null}
    </RecordEditorPanel>
  )
}
