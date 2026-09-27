import { useEffect, useState } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { SwitchRow } from "@/office/features/stock/ui/master-list"
import { MasterPanel, useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Chip, EmptyState, Field, Input, Select, Skeleton, StatusPill, Switch, TonePill, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatAmount, formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useCounterpartyDebt, useFinanceMutations, useFinanceRecord, useFinanceReferences, type FinanceRecord, type FinanceReferences } from "../data/use-finance-records"
import { counterpartyDraftOf, counterpartySaveArgs, MASTER_TABS, parseRoles, ROLE_LABELS, ROLES, validateCounterparty, type CounterpartyDraft, type DraftErrors } from "../model/modules"
import { FinanceRegister } from "./finance-register"
import { FormSection, MasterStatusAction, RecordAudit } from "./record-parts"

const MODULE = "counterparties"

/** «Контрагенты» (/office/counterparties/:id?, W1-FIN-04): master register + card. */
export function CounterpartiesWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Counterparties />
    </PlatformErrorBoundary>
  )
}

const text = (value: unknown) => (typeof value === "string" ? value : "")

export function RolePills({ roles }: { roles: unknown }) {
  const parsed = parseRoles(roles)
  if (!parsed.length) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {parsed.map((role) => (
        <TonePill key={role} tone={role === "supplier" ? "info" : role === "customer" ? "success" : "neutral"}>
          {ROLE_LABELS[role]}
        </TonePill>
      ))}
    </span>
  )
}

/** «Долг ₸» of one row: posted receipts of the counterparty's suppliers minus its payments. */
function DebtCell({ externalId }: { externalId: string }) {
  const debt = useCounterpartyDebt(externalId)
  if (debt === undefined) return <Skeleton className="ml-auto h-4 w-16" />
  if (!debt) return <span className="text-muted-foreground">—</span>
  return <span className={cn(debt.debt > 0 && "font-semibold")}>{formatAmount(debt.debt)}</span>
}

function Counterparties() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const selection = useMasterSelection(MODULE)
  const references = useFinanceReferences(MODULE)
  const record = useFinanceRecord(MODULE, selection.selectedId)
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const columns: Column<FinanceRecord>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    { key: "name", header: "Название", cell: (row) => <span className="font-semibold">{row.name}</span> },
    { key: "bin", header: "БИН", cell: (row) => <span className="whitespace-nowrap tabular-nums">{row.bin ?? (text(row.data.bin) || "—")}</span> },
    { key: "roles", header: "Тип", cell: (row) => <RolePills roles={row.data.roles} /> },
    { key: "contact", header: "Телефон", cell: (row) => text(row.data.contact) || <span className="text-muted-foreground">—</span> },
    { key: "debt", header: "Долг, ₸", numeric: true, cell: (row) => <DebtCell externalId={row.externalId} /> },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <FinanceRegister
        moduleId={MODULE}
        caption="Контрагенты"
        tabs={MASTER_TABS}
        columns={columns}
        searchPlaceholder="Поиск: контрагенты"
        createLabel={canEdit ? "Новый контрагент" : undefined}
        onCreate={selection.openNew}
        formOpen={formOpen}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        emptyTitle="Контрагентов пока нет"
        emptyDescription="Добавьте юридическое лицо с БИН, банковскими реквизитами и договором."
      />
      {selection.isNew && canEdit && references ? <CounterpartyForm key="new" record={null} references={references} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && record && references ? (
        <CounterpartyForm key={record.externalId} record={record} references={references} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} />
      ) : null}
      {selection.selectedId !== null && (!record || !references) ? (
        <RightPanel
          open
          onOpenChange={(next) => {
            if (!next) selection.close()
          }}
          title="Контрагент"
        >
          {record === null ? <EmptyState title="Контрагент не найден" description="Возможно, он относится к ресторану вне вашего доступа или ссылка устарела." /> : <OfficeStatePage state={{ kind: "loading" }} />}
        </RightPanel>
      ) : null}
    </div>
  )
}

function DebtSummary({ externalId }: { externalId: string }) {
  const debt = useCounterpartyDebt(externalId)
  return (
    <FormSection title="Задолженность">
      {debt === undefined ? (
        <Skeleton className="h-12 w-full" />
      ) : !debt ? (
        <p className="text-body-sm text-muted-foreground">Нет данных</p>
      ) : (
        <dl className="grid grid-cols-3 gap-3 text-body-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted-foreground">Получено по накладным</dt>
            <dd className="tabular-nums">{formatTenge(debt.received)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted-foreground">Оплачено</dt>
            <dd className="tabular-nums">{formatTenge(debt.paid)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted-foreground">Долг</dt>
            <dd className={cn("font-semibold tabular-nums", debt.debt > 0 ? "text-destructive" : "text-foreground")}>{formatTenge(debt.debt)}</dd>
          </div>
        </dl>
      )}
    </FormSection>
  )
}

function CounterpartyForm({ record, references, canEdit, onClose, onSaved }: { record: FinanceRecord | null; references: FinanceReferences; canEdit: boolean; onClose: () => void; onSaved: (externalId: string) => void }) {
  const [baseline, setBaseline] = useState(() => counterpartyDraftOf(record, references.restaurants[0]?.externalId ?? ""))
  const [draft, setDraft] = useState(baseline)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const [errors, setErrors] = useState<DraftErrors<keyof CounterpartyDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const { save } = useFinanceMutations()
  const toast = useToast()
  const readOnly = !canEdit
  const set = (patch: Partial<CounterpartyDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof CounterpartyDraft]
      return next
    })
  }

  useEffect(() => {
    if (savedId && !dirty && savedId !== record?.externalId) onSaved(savedId)
  }, [savedId, dirty, record?.externalId, onSaved])

  async function submit() {
    if (readOnly || saving) return
    const found = validateCounterparty(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      const saved = await save(counterpartySaveArgs(draft, record))
      setBaseline(draft)
      toast("Контрагент сохранён", "success")
      setSavedId(saved.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить контрагента"))
    } finally {
      setSaving(false)
    }
  }

  const input = (key: "name" | "legalAddress" | "bankAccount" | "bankBic" | "contract" | "contact", label: string, extra: { placeholder?: string; hint?: string } = {}) => (
    <Field label={label} error={errors[key]} hint={extra.hint}>
      {(control) => <Input {...control} value={draft[key]} onChange={(event) => set({ [key]: event.target.value } as Partial<CounterpartyDraft>)} disabled={readOnly} autoComplete="off" placeholder={extra.placeholder} />}
    </Field>
  )
  const restaurantName = references.restaurants.find((restaurant) => restaurant.externalId === draft.restaurantExternalId)?.name ?? draft.restaurantExternalId
  const toggleRole = (role: (typeof ROLES)[number]) => set({ roles: draft.roles.includes(role) ? draft.roles.filter((candidate) => candidate !== role) : [...draft.roles, role] })

  return (
    <MasterPanel title={record ? record.name : "Новый контрагент"} formLabel="Контрагент" dirty={dirty} saving={saving} canEdit={canEdit} isNew={!record} error={error} onSubmit={() => void submit()} onClose={onClose}>
      <FormSection title="Основные реквизиты">
        {input("name", "Название")}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-body-sm font-medium text-foreground">Роли</legend>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((role) => (
              <Chip key={role} active={draft.roles.includes(role)} onClick={() => toggleRole(role)} disabled={readOnly}>
                {ROLE_LABELS[role]}
              </Chip>
            ))}
          </div>
          {errors.roles ? (
            <p role="alert" className="text-caption text-destructive">
              {errors.roles}
            </p>
          ) : null}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="БИН / ИИН" error={errors.bin} hint="12 цифр">
            {(control) => <Input {...control} inputMode="numeric" maxLength={12} value={draft.bin} onChange={(event) => set({ bin: event.target.value.replace(/\D/g, "") })} disabled={readOnly} autoComplete="off" />}
          </Field>
          {!record && references.restaurants.length > 1 ? (
            <Field label="Ресторан" error={errors.restaurantExternalId}>
              {(control) => (
                <Select
                  {...control}
                  value={draft.restaurantExternalId || undefined}
                  onValueChange={(restaurantExternalId) => set({ restaurantExternalId })}
                  options={restaurantSelectOptions(references.restaurants)}
                  disabled={readOnly}
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
        <SwitchRow label="Плательщик НДС">
          <Switch checked={draft.vatPayer} onCheckedChange={(vatPayer) => set({ vatPayer })} disabled={readOnly} aria-label="Плательщик НДС" />
        </SwitchRow>
      </FormSection>
      <FormSection title="Параметры">
        {input("legalAddress", "Юридический адрес")}
        <div className="grid gap-4 sm:grid-cols-2">
          {input("bankAccount", "IBAN", { placeholder: "KZ…", hint: "KZ и 18 символов" })}
          {input("bankBic", "БИК")}
        </div>
        {input("contract", "Основной договор", { placeholder: "№ и дата договора" })}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Отсрочка (дней)" error={errors.paymentDelayDays}>
            {(control) => <Input {...control} inputMode="numeric" value={draft.paymentDelayDays} onChange={(event) => set({ paymentDelayDays: event.target.value.replace(/\D/g, "") })} disabled={readOnly} autoComplete="off" />}
          </Field>
          {input("contact", "Контакты", { placeholder: "+7 701 000 00 00" })}
        </div>
      </FormSection>
      {record ? <DebtSummary externalId={record.externalId} /> : null}
      {record ? (
        <RecordAudit record={record}>
          <MasterStatusAction moduleId={MODULE} record={record} disabled={dirty} />
        </RecordAudit>
      ) : null}
    </MasterPanel>
  )
}
