import { useEffect, useState } from "react"

import { RightPanel } from "@/office/components/right-panel"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, Combobox, ConfirmDialog, Field, Input, StatusPill, useToast, type ComboboxOption } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { KIND_META, useRetailSettingMutations, type RetailSetting, type RetailSettingKind } from "../data/use-retail-settings"
import { hasErrors, saveSettingArgs, useSettingDraft, validateSettingDraft, type SettingErrors } from "../model/setting-draft"
import { CashOperationFields } from "./setting-fields/cash-operation"
import { DeletionFields } from "./setting-fields/deletion"
import { DiscountFields } from "./setting-fields/discount"
import type { AccountChoices } from "./setting-fields/field-kit"
import { OrderFields } from "./setting-fields/order"
import { PaymentFields } from "./setting-fields/payment"

export interface SettingFormProps {
  kind: RetailSettingKind
  /** null — «Новая настройка». */
  setting: RetailSetting | null
  canEdit: boolean
  canApprove: boolean
  /** Network user (scope `*`): may leave the restaurants empty for «Все рестораны». */
  network: boolean
  restaurants: ComboboxOption[]
  accounts: AccountChoices
  /** null when the user may not read «Статьи ДДС» — the field becomes free text. */
  cashflowCategories: ComboboxOption[] | null
  onClose: () => void
  /** Opens another version (the draft a save created) in the panel. */
  onOpen: (externalId: string) => void
}

type Busy = "save" | "publish" | null

/**
 * The form of one version in the right panel. «Сохранить черновик» (secondary) never touches the
 * working cash desks; «Опубликовать» (the one primary) puts the version in force from its start date.
 * Editing a published version saves the next version as a draft; an expired version is read-only.
 */
export function SettingForm({ kind, setting, canEdit, canApprove, network, restaurants, accounts, cashflowCategories, onClose, onOpen }: SettingFormProps) {
  const { draft, dirty, set, setData, markSaved } = useSettingDraft(kind, setting)
  const blocker = useUnsavedChanges(dirty)
  const { save, publish } = useRetailSettingMutations()
  const toast = useToast()
  const [errors, setErrors] = useState<SettingErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)

  const isNew = setting === null
  const status = setting?.status
  const readOnly = !canEdit || status === "expired"
  const canPublish = canApprove && (status === "draft" || (canEdit && (isNew || status === "published")))
  // A published version publishes again only as a new version, i.e. after an edit.
  const publishDisabled = busy !== null || (status === "published" && !dirty)
  const saveDisabled = busy !== null || (!dirty && !isNew)
  const meta = KIND_META[kind]

  // Navigate to the saved version only once the draft is clean, so the leave-guard does not fire.
  useEffect(() => {
    if (pendingOpen && !dirty) {
      setPendingOpen(null)
      if (pendingOpen !== setting?.externalId) onOpen(pendingOpen)
    }
  }, [pendingOpen, dirty, setting?.externalId, onOpen])

  const restaurantOptions = [...restaurants]
  for (const externalId of draft.restaurantExternalIds) if (!restaurantOptions.some((option) => option.value === externalId)) restaurantOptions.push({ value: externalId, label: externalId })

  function validate() {
    const found = validateSettingDraft(draft, { network, isNew })
    setErrors(found)
    return !hasErrors(found)
  }

  async function persist() {
    const externalId = await save(saveSettingArgs(kind, setting?.externalId, draft))
    markSaved()
    return externalId
  }

  async function handleSave() {
    if (readOnly || busy || !validate()) return
    setBusy("save")
    setError(null)
    try {
      const externalId = await persist()
      toast(status === "published" ? "Создана новая версия — черновик" : "Черновик сохранён", "success")
      setPendingOpen(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить настройку"))
    } finally {
      setBusy(null)
    }
  }

  async function handlePublish() {
    if (!canPublish || publishDisabled || !validate()) return
    setBusy("publish")
    setError(null)
    let saved: string | null = null
    try {
      const externalId = setting && setting.status === "draft" && !dirty ? setting.externalId : (saved = await persist())
      await publish({ externalId })
      toast(`Опубликовано: ${draft.name.trim()}`, "success")
    } catch (caught) {
      const message = errorMessage(caught, "Не удалось опубликовать настройку")
      setError(message)
      // The draft is saved but not published: it opens in the panel, so the reason goes to a toast too.
      if (saved && saved !== setting?.externalId) toast(`Черновик сохранён, но не опубликован: ${message}`, "error")
    } finally {
      if (saved) setPendingOpen(saved)
      setBusy(null)
    }
  }

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose())
  const kindProps = { errors, readOnly, accounts }

  return (
    <>
      <RightPanel
        open
        onOpenChange={(next) => {
          if (!next) requestClose()
        }}
        title={setting ? setting.name : `Новая настройка · ${meta.title}`}
        footer={
          canEdit || canPublish ? (
            <>
              {!readOnly ? <SaveStatus state={busy === "save" ? "saving" : dirty ? "dirty" : "clean"} /> : null}
              {!readOnly ? (
                <Button variant={canPublish ? "secondary" : "primary"} onClick={() => void handleSave()} disabled={saveDisabled}>
                  {busy === "save" ? "Сохранение…" : status === "published" ? "Сохранить новую версию" : "Сохранить черновик"}
                </Button>
              ) : null}
              {canPublish ? (
                <Button onClick={() => void handlePublish()} disabled={publishDisabled}>
                  {busy === "publish" ? "Публикация…" : "Опубликовать"}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        <form
          aria-label={`Настройка · ${meta.title}`}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void handleSave()
          }}
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-2">
            {setting ? (
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill domain="document" status={setting.status} />
                <span className="text-caption text-muted-foreground">
                  {setting.code} · v{setting.version}
                </span>
              </div>
            ) : null}
            <p className="text-caption text-muted-foreground">Черновики не меняют работающую кассу; публикация вступает в силу с указанной даты.</p>
          </div>

          {status === "published" && canEdit ? (
            <Banner tone="info" title="Версия действует на кассах">
              Изменения сохранятся новой версией v{(setting?.version ?? 0) + 1} — черновиком. Текущая версия работает, пока новая не опубликована.
            </Banner>
          ) : null}
          {status === "expired" ? (
            <Banner tone="info" title="Версия истекла — только чтение">
              Истёкшую версию изменить нельзя. Откройте действующую версию этого кода или создайте новую настройку.
            </Banner>
          ) : null}
          {error ? (
            <Banner tone="danger" title="Не удалось сохранить">
              {error}
            </Banner>
          ) : null}

          <section aria-label="Основное" className="flex flex-col gap-4">
            <h3 className="text-title-sm font-semibold">Основное</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Код" error={errors.code} hint={isNew ? "Латиница, цифры и дефис; после создания не меняется" : undefined}>
                {(control) => <Input {...control} value={draft.code} onChange={(event) => set({ code: event.target.value })} disabled={readOnly || !isNew} autoComplete="off" placeholder="cash" />}
              </Field>
              <Field label="Название" error={errors.name}>
                {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" />}
              </Field>
              <Field label="Название в чеке" hint="Пусто — как название">
                {(control) => <Input {...control} value={draft.receiptName} onChange={(event) => set({ receiptName: event.target.value })} disabled={readOnly} autoComplete="off" />}
              </Field>
              <Field label="Порядок" error={errors.sortOrder}>
                {(control) => <Input {...control} inputMode="numeric" value={draft.sortOrder} onChange={(event) => set({ sortOrder: event.target.value })} disabled={readOnly} autoComplete="off" />}
              </Field>
              <Field label="Начало действия" error={errors.effectiveFrom} hint="С 00:00 по Алматы">
                {(control) => <Input {...control} type="date" value={draft.effectiveFrom} onChange={(event) => set({ effectiveFrom: event.target.value })} disabled={readOnly} />}
              </Field>
              <Field label="Окончание действия" error={errors.effectiveTo} hint="Пусто — без окончания">
                {(control) => <Input {...control} type="date" min={draft.effectiveFrom || undefined} value={draft.effectiveTo} onChange={(event) => set({ effectiveTo: event.target.value })} disabled={readOnly} />}
              </Field>
              <Field label="Рестораны" error={errors.restaurants} hint={network ? "Пусто — все рестораны сети" : undefined} className="sm:col-span-2">
                {(control) => (
                  <Combobox
                    {...control}
                    multiple
                    value={draft.restaurantExternalIds}
                    onValueChange={(restaurantExternalIds) => set({ restaurantExternalIds })}
                    options={restaurantOptions}
                    placeholder={network ? "Все рестораны" : "Выберите рестораны"}
                    searchPlaceholder="Найти ресторан"
                    disabled={readOnly}
                  />
                )}
              </Field>
            </div>
          </section>

          {draft.data.kind === "payment-type" ? <PaymentFields data={draft.data} onChange={setData} {...kindProps} /> : null}
          {draft.data.kind === "order-type" ? <OrderFields data={draft.data} onChange={setData} {...kindProps} /> : null}
          {draft.data.kind === "discount-type" ? <DiscountFields data={draft.data} onChange={setData} {...kindProps} /> : null}
          {draft.data.kind === "deletion-reason" ? <DeletionFields data={draft.data} onChange={setData} {...kindProps} /> : null}
          {draft.data.kind === "cash-operation-type" ? <CashOperationFields data={draft.data} onChange={setData} cashflowCategories={cashflowCategories} {...kindProps} /> : null}
        </form>
      </RightPanel>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Закрыть без сохранения?"
        description="Изменения настройки не сохранены и будут потеряны."
        confirmLabel="Закрыть без сохранения"
        cancelLabel="Остаться"
        onConfirm={() => {
          setConfirmClose(false)
          onClose()
        }}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  )
}
