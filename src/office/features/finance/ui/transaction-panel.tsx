import { useEffect, useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, Combobox, ConfirmDialog, Field, Input, MoneyInput, Select, Textarea, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useFinanceMutations, type FinanceRecord, type FinanceReferences } from "../data/use-finance-records"
import { categoriesForRestaurant, formatBusinessDate, transactionDraftOf, transactionSaveArgs, validateTransaction, type DraftErrors, type TransactionDraft } from "../model/modules"
import { FormSection, RecordAudit } from "./record-parts"

const MODULE = "transactions"
const NONE = "none"

export interface TransactionPanelProps {
  record: FinanceRecord | null
  references: FinanceReferences
  defaultRestaurantExternalId?: string
  onClose: () => void
  onSaved: (externalId: string) => void
}

/**
 * Card of a manual operation (W1-FIN-05): Дебет, Кредит, Статья ДДС, Контрагент, Первичный документ,
 * Основание. A draft is saved and posted («Провести» is the one primary); a posted one is read-only
 * with «Сторно» (L-18).
 */
export function TransactionPanel({ record, references, defaultRestaurantExternalId, onClose, onSaved }: TransactionPanelProps) {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const canPost = useCan(`office.${MODULE}.post`)
  const canReverse = useCan(`office.${MODULE}.reverse`)
  const canCancel = useCan(`office.${MODULE}.cancel`)
  const editable = canEdit && (!record || record.status === "draft")
  const [baseline, setBaseline] = useState(() => transactionDraftOf(record, defaultRestaurantExternalId ?? references.restaurants[0]?.externalId ?? ""))
  const [draft, setDraft] = useState(baseline)
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(baseline)
  const [errors, setErrors] = useState<DraftErrors<keyof TransactionDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<"close" | "reverse" | "cancel" | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const { save, transition } = useFinanceMutations()
  const toast = useToast()
  const blocker = useUnsavedChanges(dirty)
  const set = (patch: Partial<TransactionDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof TransactionDraft]
      return next
    })
  }

  useEffect(() => {
    if (savedId && !dirty && savedId !== record?.externalId) onSaved(savedId)
  }, [savedId, dirty, record?.externalId, onSaved])

  const manualAccounts = references.accounts.filter((account) => account.allowManualEntries)
  const accountOptions = manualAccounts.map((account) => ({ value: account.externalId, label: `${account.code} · ${account.name}` }))
  const accountName = (externalId: string) => {
    const account = references.accounts.find((candidate) => candidate.externalId === externalId)
    return account ? `${account.code} · ${account.name}` : externalId || "—"
  }
  const categoryOptions = [{ value: NONE, label: "Не указана" }, ...categoriesForRestaurant(references.cashflowCategories, references.restaurants, draft.restaurantExternalId, record?.cashflowCategoryExternalId).map((row) => ({ value: row.externalId, label: row.name }))]
  const counterpartyOptions = [{ value: NONE, label: "Не указан" }, ...references.counterparties.map((row) => ({ value: row.externalId, label: row.name }))]
  const nameOf = (options: { value: string; label: string }[], value: string) => (value ? (options.find((option) => option.value === value)?.label ?? value) : "—")
  const restaurantName = references.restaurants.find((restaurant) => restaurant.externalId === draft.restaurantExternalId)?.name ?? draft.restaurantExternalId

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(errorMessage(caught, fallback))
    } finally {
      setBusy(false)
    }
  }

  const checked = () => {
    const found = validateTransaction(draft)
    setErrors(found)
    return Object.keys(found).length === 0
  }

  const saveDraft = () => {
    if (!editable || busy || !checked()) return
    void run(async () => {
      const saved = await save(transactionSaveArgs(draft, record))
      setBaseline(draft)
      toast("Черновик сохранён", "success")
      setSavedId(saved.externalId)
    }, "Не удалось сохранить операцию")
  }

  const post = () => {
    if (!editable || !canPost || busy || !checked()) return
    void run(async () => {
      let target = record && !dirty ? { externalId: record.externalId, version: record.version } : null
      if (!target) {
        const saved = await save(transactionSaveArgs(draft, record))
        setBaseline(draft)
        target = saved
      }
      await transition({ moduleId: MODULE, externalId: target.externalId, action: "post", expectedVersion: target.version })
      toast("Операция проведена", "success")
      setSavedId(target.externalId)
    }, "Не удалось провести операцию")
  }

  async function confirmTransition(action: "reverse" | "cancel", reason: string) {
    if (!record) return
    if (reason.trim().length < 3) {
      setDialogError("Опишите причину — хотя бы несколько слов")
      return
    }
    setBusy(true)
    setDialogError(null)
    try {
      await transition({ moduleId: MODULE, externalId: record.externalId, action, expectedVersion: record.version, reason })
      toast(action === "reverse" ? "Операция сторнирована" : "Черновик отменён", "success")
      setConfirm(null)
    } catch (caught) {
      setDialogError(errorMessage(caught, action === "reverse" ? "Не удалось сторнировать" : "Не удалось отменить"))
    } finally {
      setBusy(false)
    }
  }

  const footer: ReactNode = editable ? (
    <>
      <SaveStatus state={busy ? "saving" : dirty ? "dirty" : "clean"} />
      <Button variant={canPost ? "secondary" : "primary"} onClick={saveDraft} disabled={busy || (!dirty && Boolean(record))}>
        Сохранить черновик
      </Button>
      {canPost ? (
        <Button onClick={post} disabled={busy}>
          {busy ? "Проведение…" : "Провести"}
        </Button>
      ) : null}
    </>
  ) : record?.status === "posted" && canReverse ? (
    <Button variant="danger" onClick={() => setConfirm("reverse")} disabled={busy}>
      Сторно
    </Button>
  ) : undefined

  const title = record ? `Проводка ${record.number}` : "Новая операция"
  const readOnlyRows: [string, ReactNode][] = [
    ["Содержание", draft.name],
    ["Ресторан", restaurantName],
    ["Дата", formatBusinessDate(draft.businessDate)],
    ["Сумма", formatTenge(draft.amount ?? 0)],
  ]

  return (
    <>
      <RightPanel
        open
        onOpenChange={(next) => {
          if (next) return
          if (dirty) setConfirm("close")
          else onClose()
        }}
        title={title}
        footer={footer}
      >
        <form
          aria-label="Ручная операция"
          noValidate
          // Enter never posts: a posting is an explicit click on «Провести».
          onSubmit={(event) => event.preventDefault()}
          className="flex flex-col gap-4"
        >
          {record && !editable ? <p className="text-caption text-muted-foreground">{record.status === "posted" ? "Проведённая операция меняется только сторнированием." : "Операция закрыта для изменений."}</p> : null}
          {error ? (
            <Banner tone="danger" title="Не удалось выполнить действие">
              {error}
            </Banner>
          ) : null}
          <FormSection title="Основные реквизиты">
            {editable ? (
              <>
                <Field label="Содержание операции" error={errors.name}>
                  {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} autoComplete="off" placeholder="Например, инкассация в банк" />}
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
                        onValueChange={(restaurantExternalId) => set({ restaurantExternalId, cashflowCategoryExternalId: "" })}
                        options={restaurantSelectOptions(references.restaurants)}
                      />
                    )}
                  </Field>
                ) : (
                  <ReadOnlyRows rows={[["Ресторан", restaurantName || "—"]]} />
                )}
              </>
            ) : (
              <ReadOnlyRows rows={readOnlyRows} />
            )}
          </FormSection>
          <FormSection title="Параметры">
            {editable ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Дебет" error={errors.debitAccountExternalId} hint="Счета с разрешёнными ручными проводками">
                    {(control) => <Combobox {...control} value={draft.debitAccountExternalId || undefined} onValueChange={(debitAccountExternalId) => set({ debitAccountExternalId })} options={accountOptions} placeholder="Выберите счёт" searchPlaceholder="Код или название" />}
                  </Field>
                  <Field label="Кредит" error={errors.creditAccountExternalId}>
                    {(control) => <Combobox {...control} value={draft.creditAccountExternalId || undefined} onValueChange={(creditAccountExternalId) => set({ creditAccountExternalId })} options={accountOptions} placeholder="Выберите счёт" searchPlaceholder="Код или название" />}
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Статья ДДС">
                    {(control) => <Select {...control} value={draft.cashflowCategoryExternalId || NONE} onValueChange={(value) => set({ cashflowCategoryExternalId: value === NONE ? "" : value })} options={categoryOptions} />}
                  </Field>
                  <Field label="Контрагент">
                    {(control) => <Combobox {...control} value={draft.counterpartyExternalId || NONE} onValueChange={(value) => set({ counterpartyExternalId: !value || value === NONE ? "" : value })} options={counterpartyOptions} searchPlaceholder="Название контрагента" />}
                  </Field>
                </div>
                <Field label="Первичный документ" hint="Номер и дата документа-основания">
                  {(control) => <Input {...control} value={draft.documentReference} onChange={(event) => set({ documentReference: event.target.value })} autoComplete="off" />}
                </Field>
                <Field label="Основание">
                  {(control) => <Textarea {...control} value={draft.comment} onChange={(event) => set({ comment: event.target.value })} />}
                </Field>
              </>
            ) : (
              <ReadOnlyRows
                rows={[
                  ["Дебет", accountName(draft.debitAccountExternalId)],
                  ["Кредит", accountName(draft.creditAccountExternalId)],
                  ["Статья ДДС", nameOf(categoryOptions, draft.cashflowCategoryExternalId)],
                  ["Контрагент", nameOf(counterpartyOptions, draft.counterpartyExternalId)],
                  ["Первичный документ", draft.documentReference || "—"],
                  ["Основание", draft.comment || "—"],
                ]}
              />
            )}
          </FormSection>
          {record ? (
            <RecordAudit record={record}>
              {record.status === "draft" && canCancel ? (
                <Button variant="danger" size="sm" className="self-start" onClick={() => setConfirm("cancel")} disabled={busy}>
                  Отменить черновик
                </Button>
              ) : null}
            </RecordAudit>
          ) : null}
        </form>
      </RightPanel>
      <ConfirmDialog
        open={confirm === "close"}
        onOpenChange={(open) => setConfirm(open ? "close" : null)}
        title="Закрыть без сохранения?"
        description="Изменения не сохранены и будут потеряны."
        confirmLabel="Закрыть без сохранения"
        cancelLabel="Остаться"
        onConfirm={() => {
          setConfirm(null)
          onClose()
        }}
      />
      <ConfirmDialog
        open={confirm === "reverse" || confirm === "cancel"}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(null)
            setDialogError(null)
          }
        }}
        title={confirm === "cancel" ? "Отменить черновик?" : "Сторнировать операцию?"}
        description={confirm === "cancel" ? "Черновик останется в истории со статусом «Отменён»." : "Будет записана обратная проводка; сама операция останется в истории со статусом «Сторнирован»."}
        confirmLabel={confirm === "cancel" ? "Отменить черновик" : "Сторнировать"}
        reasonLabel={confirm === "cancel" ? "Причина отмены" : "Причина сторно"}
        submitting={busy}
        error={dialogError}
        onConfirm={(reason) => (confirm === "reverse" || confirm === "cancel" ? confirmTransition(confirm, reason) : undefined)}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  )
}

function ReadOnlyRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
