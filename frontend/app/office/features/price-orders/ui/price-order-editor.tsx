import { ArrowLeft } from "lucide-react"
import { useState, type ReactNode } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useProductPicker } from "@/office/features/nomenclature/data/use-nomenclature"
import { usePlatformScope } from "@/office/features/platform/data/use-platform"
import { useScaleByProduct } from "@/office/features/size-scales/data/use-size-scales"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, Combobox, ConfirmDialog, EmptyState, Field, Input, Switch, Textarea, TonePill, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { formatRestaurants, STATUS_LABELS, usePriceOrder, usePriceOrderMutations, type PriceOrder } from "../data/use-price-orders"
import { fromAlmatyInput, hasPriceOrderErrors, linesForProduct, savePriceOrderArgs, usePriceOrderDraft, validatePriceOrder, type PriceOrderErrors } from "../model/use-price-order-draft"
import { PriceOrderLinesTable } from "./price-order-lines-table"
import { ScheduleField } from "./schedule-field"

const BACK = "/office/price-orders"

/** /office/price-orders/:externalId — the price order on the Editor template (OFFICE-DESIGN §3.4). */
export function PriceOrderEditor({ externalId }: { externalId: string }) {
  const order = usePriceOrder(externalId)
  const navigate = useNavigate()
  const back = () => navigate(BACK)

  if (order === undefined) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  if (order === null) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <EmptyState
          title="Приказ не найден"
          description="Возможно, он относится к филиалу вне вашего доступа или ссылка устарела."
          action={
            <Button variant="secondary" onClick={back}>
              <ArrowLeft aria-hidden />К списку
            </Button>
          }
        />
      </div>
    )
  }
  // A status change (publish, cancel, the cron) re-reads the order into a fresh draft.
  return <PriceOrderForm key={`${order.externalId}:${order.status}`} order={order} onBack={back} />
}

function PriceOrderForm({ order, onBack }: { order: PriceOrder; onBack: () => void }) {
  const canEdit = useCan("office.price-orders.edit")
  const canPost = useCan("office.price-orders.post")
  const canCancel = useCan("office.price-orders.cancel")
  const { draft, dirty, set, setSchedule, setLine, removeLine, addLines, reset, markSaved } = usePriceOrderDraft(order)
  const blocker = useUnsavedChanges(dirty)
  const scope = usePlatformScope()
  const products = useProductPicker(useCan("office.nomenclature.view"))
  const scales = useScaleByProduct(useCan("office.size-scales.view"))
  const { save, publish, cancel } = usePriceOrderMutations()
  const toast = useToast()
  const [errors, setErrors] = useState<PriceOrderErrors>({ lineRows: {} })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | "publish" | "cancel" | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const status = STATUS_LABELS[order.status]
  const readOnly = order.status !== "draft" || !canEdit
  const cancellable = (order.status === "scheduled" || order.status === "active") && canCancel

  const restaurantOptions = restaurantSelectOptions(scope.restaurants)
  for (const externalId of draft.restaurantExternalIds) if (!restaurantOptions.some((option) => option.value === externalId)) restaurantOptions.push({ value: externalId, label: externalId })
  const restaurantName = (externalId: string) => scope.restaurantName(externalId) ?? externalId

  function validate() {
    const found = validatePriceOrder(draft, { network: scope.network })
    setErrors(found)
    return !hasPriceOrderErrors(found)
  }

  async function persist() {
    await save(savePriceOrderArgs(order.externalId, draft))
    markSaved()
  }

  async function handleSave() {
    if (readOnly || busy || !validate()) return
    setBusy("save")
    setError(null)
    try {
      await persist()
      toast("Приказ сохранён", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить приказ"))
    } finally {
      setBusy(null)
    }
  }

  async function handlePublish() {
    if (order.status !== "draft" || busy || !validate()) return
    if (draft.lines.length === 0) {
      setErrors((current) => ({ ...current, lines: "Добавьте хотя бы одну позицию" }))
      return
    }
    setBusy("publish")
    setError(null)
    try {
      if (dirty) await persist()
      const next = await publish({ externalId: order.externalId })
      toast(`Приказ опубликован: ${STATUS_LABELS[next].label.toLocaleLowerCase("ru")}`, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось опубликовать приказ"))
    } finally {
      setBusy(null)
    }
  }

  async function handleCancel(reason: string) {
    setBusy("cancel")
    setCancelError(null)
    try {
      await cancel({ externalId: order.externalId, reason })
      setCancelling(false)
      toast("Приказ отменён", "success")
    } catch (caught) {
      setCancelError(errorMessage(caught, "Не удалось отменить приказ"))
    } finally {
      setBusy(null)
    }
  }

  function addProduct(productExternalId: string) {
    const row = products.rows.find((candidate) => candidate.externalId === productExternalId)
    if (!row) return
    const added = addLines(linesForProduct({ externalId: row.externalId, name: row.name, basePrice: row.basePrice }, scales.byProduct.get(row.externalId)?.options))
    if (added === 0) toast(`«${row.name}» уже в приказе`, "info")
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title font-semibold">Приказ {order.number}</h2>
              <TonePill tone={status.tone}>{status.label}</TonePill>
            </div>
            <p className="text-body-sm text-muted-foreground">{draft.name.trim() || order.name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly ? <SaveStatus state={busy === "save" ? "saving" : dirty ? "dirty" : "clean"} /> : null}
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft aria-hidden />К списку
            </Button>
            {!readOnly ? (
              <Button variant={canPost ? "secondary" : "primary"} onClick={() => void handleSave()} disabled={!dirty || busy !== null}>
                {busy === "save" ? "Сохранение…" : "Сохранить"}
              </Button>
            ) : null}
            {order.status === "draft" && canPost ? (
              <Button onClick={() => void handlePublish()} disabled={busy !== null}>
                {busy === "publish" ? "Публикация…" : "Опубликовать"}
              </Button>
            ) : null}
            {cancellable ? (
              <Button variant="danger" onClick={() => setCancelling(true)} disabled={busy !== null}>
                Отменить приказ
              </Button>
            ) : null}
          </div>
        </header>

        {order.status === "active" || order.status === "expired" ? (
          <Banner tone="info" title={order.status === "active" ? "Приказ действует — только чтение" : "Приказ истёк — только чтение"}>
            Изменить опубликованный приказ нельзя: {order.status === "active" ? "отмените его или создайте новый." : "создайте новый приказ."}
          </Banner>
        ) : null}
        {order.status === "scheduled" ? (
          <Banner tone="info" title="Приказ запланирован — только чтение">
            Он вступит в силу {formatAlmatyDateTime(order.effectiveFrom)}. Чтобы изменить цены, отмените его и создайте новый.
          </Banner>
        ) : null}
        {order.status === "cancelled" ? (
          <Banner tone="warning" title="Приказ отменён">
            {order.cancelReason ?? "Причина не указана."}
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="danger" title="Не удалось сохранить">
            {error}
          </Banner>
        ) : null}

        <section aria-label="Реквизиты" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
          <h3 className="text-title-sm font-semibold">Реквизиты</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <ReadOnlyField label="Номер" value={order.number} />
            {readOnly ? (
              <ReadOnlyField label="Название" value={draft.name} />
            ) : (
              <Field label="Название" error={errors.name}>
                {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} autoComplete="off" />}
              </Field>
            )}
            {readOnly ? (
              <ReadOnlyField label="Начало" value={formatAlmatyDateTime(order.effectiveFrom)} />
            ) : (
              <Field label="Начало" error={errors.effectiveFrom} hint="Время Алматы">
                {(control) => <Input {...control} type="datetime-local" value={draft.effectiveFrom} onChange={(event) => set({ effectiveFrom: event.target.value })} />}
              </Field>
            )}
            {readOnly ? (
              <ReadOnlyField label="Окончание" value={order.effectiveTo === null ? "Без окончания" : formatAlmatyDateTime(order.effectiveTo)} />
            ) : (
              <Field label="Окончание" error={errors.effectiveTo} hint="Пусто — без окончания">
                {(control) => (
                  <Input
                    {...control}
                    type="datetime-local"
                    min={fromAlmatyInput(draft.effectiveFrom) === null ? undefined : draft.effectiveFrom}
                    value={draft.effectiveTo}
                    onChange={(event) => set({ effectiveTo: event.target.value })}
                  />
                )}
              </Field>
            )}
            {readOnly ? (
              <ReadOnlyField label="Название на кассе" value={draft.posName || "—"} />
            ) : (
              <Field label="Название на кассе" hint="Например «Обеденное меню»">
                {(control) => <Input {...control} value={draft.posName} onChange={(event) => set({ posName: event.target.value })} autoComplete="off" />}
              </Field>
            )}
            {readOnly ? (
              <ReadOnlyField label="Филиалы" value={formatRestaurants(draft.restaurantExternalIds, restaurantName, 20)} />
            ) : (
              <Field label="Филиалы" error={errors.restaurants} hint={scope.network ? "Пусто — все филиалы сети" : undefined}>
                {(control) => (
                  <Combobox
                    {...control}
                    multiple
                    value={draft.restaurantExternalIds}
                    onValueChange={(restaurantExternalIds) => set({ restaurantExternalIds })}
                    options={restaurantOptions}
                    placeholder={scope.network ? "Все филиалы" : "Выберите филиалы"}
                    searchPlaceholder="Найти филиал"
                  />
                )}
              </Field>
            )}
            {readOnly ? (
              <ReadOnlyField label="Комментарий" value={draft.comment || "—"} className="md:col-span-2" />
            ) : (
              <Field label="Комментарий" className="md:col-span-2">
                {(control) => <Textarea {...control} value={draft.comment} onChange={(event) => set({ comment: event.target.value })} />}
              </Field>
            )}
          </div>
          {readOnly ? (
            <ReadOnlyField label="Заменяет предыдущее меню" value={draft.replacesPreviousMenu ? "Да" : "Нет"} />
          ) : (
            <label className="flex items-center gap-3 text-body-sm font-medium text-foreground">
              <Switch checked={draft.replacesPreviousMenu} onCheckedChange={(replacesPreviousMenu) => set({ replacesPreviousMenu })} />
              Заменяет предыдущее меню
              <span className="font-normal text-muted-foreground">— позиции вне приказа на кассе скрываются на время его действия</span>
            </label>
          )}
          <ScheduleField value={draft.schedule} onChange={setSchedule} readOnly={readOnly} error={errors.schedule} />
        </section>

        {errors.lines ? (
          <p role="alert" className="text-body-sm text-destructive">
            {errors.lines}
          </p>
        ) : null}
        <PriceOrderLinesTable
          lines={draft.lines}
          saved={order.lines}
          readOnly={readOnly}
          errors={errors.lineRows}
          productOptions={products.options}
          onAddProduct={addProduct}
          onChange={setLine}
          onRemove={removeLine}
        />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-panel xl:px-8">
        <p className="text-caption text-muted-foreground">OASIS Gastro активирует и завершает приказ автоматически по датам.</p>
        {!readOnly ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={!dirty || busy !== null}>
              Отменить изменения
            </Button>
            <Button variant="secondary" onClick={() => void handleSave()} disabled={!dirty || busy !== null}>
              Сохранить приказ
            </Button>
          </div>
        ) : null}
      </footer>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={(open) => {
          setCancelling(open)
          if (!open) setCancelError(null)
        }}
        title={`Отменить приказ ${order.number}?`}
        description="Цены вернутся к ценам филиала или базовым. Отменённый приказ нельзя вернуть — только создать новый."
        confirmLabel="Отменить приказ"
        cancelLabel="Не отменять"
        reasonLabel="Причина отмены"
        submitting={busy === "cancel"}
        error={cancelError}
        onConfirm={(reason) => handleCancel(reason)}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

function ReadOnlyField({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="flex flex-col gap-1.5">
        <span className="text-body-sm font-medium text-muted-foreground">{label}</span>
        <span className="text-body-sm text-foreground">{value}</span>
      </div>
    </div>
  )
}
