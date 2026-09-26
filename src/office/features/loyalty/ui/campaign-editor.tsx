import { useEffect, useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { ReadOnlyRows, RecordPanelFallback } from "@/office/features/finance/ui/record-editor"
import { usePlatformScope } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { useReveal } from "@/shared/hooks/use-reveal"
import { Banner, Button, Combobox, ConfirmDialog, Field, Input, SegmentedControl, Select, StatusPill, Textarea, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity } from "@/shared/lib/format"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useCampaign, useCampaignAudience, useCampaignMutations, useCampaignReferences, type CampaignCard } from "../data/use-campaigns"
import type { DraftErrors } from "../model/loyalty-model"
import {
  ALL_RESTAURANTS,
  audienceLine,
  CANCELLABLE,
  campaignDraftOf,
  campaignSaveArgs,
  CHANNEL_LABELS,
  formatCampaignPeriod,
  HOUR_OPTIONS,
  MAX_TEMPLATE,
  NEXT_ACTION,
  NO_CATEGORY,
  smsInfo,
  validateCampaign,
  type CampaignChannel,
  type CampaignDraft,
} from "../model/campaigns"
import { FormSection } from "./guest-editor"

// The campaign card (OFFICE-DESIGN §3.4 in the right panel, approval lifecycle §3.5): a draft is edited
// and saved; the one primary moves it on — «Отправить на согласование» → «Согласовать и запустить» →
// «Провести». Approval queues a message for each guest with consent in force; without a provider key
// they end in «Очередь интеграций» as «Не доставлено» — the card says so instead of promising delivery.

export interface CampaignEditorProps {
  /** null — a new campaign. */
  externalId: string | null
  onClose: () => void
  onSaved: (externalId: string) => void
}

export function CampaignEditor({ externalId, onClose, onSaved }: CampaignEditorProps) {
  const card = useCampaign(externalId)
  if (externalId && !card) return <RecordPanelFallback title="Кампания" missing={card === null} missingTitle="Кампания не найдена" onClose={onClose} />
  return <CampaignForm key={card ? `${card.externalId}:${card.version}` : "new"} card={card ?? null} onClose={onClose} onSaved={onSaved} />
}

function CampaignForm({ card, onClose, onSaved }: { card: CampaignCard | null; onClose: () => void; onSaved: (externalId: string) => void }) {
  const canEdit = useCan("office.campaigns.edit")
  const canApprove = useCan("office.campaigns.approve")
  const canPost = useCan("office.campaigns.post")
  const canCancel = useCan("office.campaigns.cancel")
  const status = card?.status ?? "draft"
  const editable = canEdit && status === "draft"
  const scope = usePlatformScope()
  const references = useCampaignReferences()
  const { saveCampaign, transitionCampaign } = useCampaignMutations()
  const toast = useToast()

  const [baseline, setBaseline] = useState(() => campaignDraftOf(card, scope.restaurants.slice(0, 1).map((row) => row.externalId)))
  const [draft, setDraft] = useState(baseline)
  const [errors, setErrors] = useState<DraftErrors<keyof CampaignDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const errorRef = useReveal(error)
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<"close" | "cancel" | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(baseline)
  const blocker = useUnsavedChanges(dirty)

  useEffect(() => {
    if (savedId && savedId !== card?.externalId) onSaved(savedId)
  }, [savedId, card?.externalId, onSaved])

  const audienceArgs = useDebounced(
    JSON.stringify({ channel: draft.channel, restaurantExternalIds: draft.restaurantExternalIds, ...(draft.categoryExternalId ? { categoryExternalId: draft.categoryExternalId } : {}) }),
  )
  const audience = useCampaignAudience(editable || status === "pending-approval" ? (JSON.parse(audienceArgs) as { channel: CampaignChannel; categoryExternalId?: string; restaurantExternalIds: string[] }) : null)

  const set = (patch: Partial<CampaignDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof CampaignDraft]
      return next
    })
  }

  const checked = () => {
    const found = validateCampaign(draft)
    setErrors(found)
    return Object.keys(found).length === 0
  }

  async function persist() {
    if (card && !dirty) return { externalId: card.externalId, version: card.version }
    const saved = await saveCampaign(campaignSaveArgs(draft, card))
    setBaseline(draft)
    return saved
  }

  async function saveDraft() {
    if (!editable || busy || !checked()) return
    setBusy(true)
    setError(null)
    try {
      const saved = await persist()
      toast(card ? "Черновик кампании сохранён" : "Кампания создана", "success")
      setSavedId(saved.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить кампанию"))
    } finally {
      setBusy(false)
    }
  }

  const next = NEXT_ACTION[status]
  const allowedNext = next && (next.action === "submit" ? canEdit : next.action === "approve" ? canApprove : canPost) ? next : null

  async function advance() {
    if (!allowedNext || busy) return
    if (status === "draft" && !checked()) return
    setBusy(true)
    setError(null)
    try {
      const target = status === "draft" ? await persist() : { externalId: card!.externalId, version: card!.version }
      await transitionCampaign({ externalId: target.externalId, action: allowedNext.action, expectedVersion: target.version })
      toast(allowedNext.done, "success")
      setSavedId(target.externalId)
    } catch (caught) {
      setError(errorMessage(caught, allowedNext.failed))
    } finally {
      setBusy(false)
    }
  }

  async function cancel(reason: string) {
    if (!card) return
    if (reason.trim().length < 3) {
      setDialogError("Опишите причину — хотя бы несколько слов")
      return
    }
    setBusy(true)
    setDialogError(null)
    try {
      await transitionCampaign({ externalId: card.externalId, action: "cancel", expectedVersion: card.version, reason })
      toast("Кампания отменена", "success")
      setConfirm(null)
    } catch (caught) {
      setDialogError(errorMessage(caught, "Не удалось отменить кампанию"))
    } finally {
      setBusy(false)
    }
  }

  const advanceButton = allowedNext ? (
    <Button onClick={() => void advance()} disabled={busy || (status === "approved" && (card?.enqueueState !== "done" || card.jobsPending))}>
      {busy ? allowedNext.busy : allowedNext.idle}
    </Button>
  ) : null
  const footer: ReactNode = editable ? (
    <>
      <SaveStatus state={busy ? "saving" : dirty ? "dirty" : "clean"} />
      <Button variant={advanceButton ? "secondary" : "primary"} onClick={() => void saveDraft()} disabled={busy || (!dirty && Boolean(card))}>
        Сохранить черновик
      </Button>
      {advanceButton}
    </>
  ) : (
    (advanceButton ?? undefined)
  )

  const note =
    !card || editable
      ? null
      : status === "pending-approval"
        ? "Кампания на согласовании; изменить её можно после отмены."
        : status === "approved"
          ? card.enqueueState === "done"
            ? card.jobsPending
              ? "Сообщения в очереди и уходят в окно отправки. Провести кампанию можно, когда очередь опустеет."
              : "Все сообщения обработаны — кампанию можно провести."
            : "Аудитория ставится в очередь…"
          : status === "completed"
            ? "Кампания проведена."
            : status === "cancelled"
              ? "Кампания отменена; сообщения, что ещё ждали отправки, сняты с очереди."
              : "Черновик меняет сотрудник с правом редактирования кампаний."

  const categoryOptions = [{ value: NO_CATEGORY, label: "Все гости" }, ...(references?.categories ?? []).map((row) => ({ value: row.externalId, label: row.name }))]
  const restaurantOptions = [...(scope.network ? [{ value: ALL_RESTAURANTS, label: "Все рестораны сети" }] : []), ...restaurantSelectOptions(scope.restaurants)]
  const pickRestaurants = (values: string[]) => {
    // «Все рестораны сети» excludes the individual ones and the other way round.
    const added = values.find((value) => !draft.restaurantExternalIds.includes(value))
    set({ restaurantExternalIds: added === ALL_RESTAURANTS ? [ALL_RESTAURANTS] : values.filter((value) => value !== ALL_RESTAURANTS) })
  }
  const restaurantNames = (ids: string[]) => (ids.includes(ALL_RESTAURANTS) ? "Все рестораны сети" : ids.map((id) => scope.restaurantName(id) ?? id).join(", "))
  const categoryName = (id: string | undefined) => (id ? (references?.categories.find((row) => row.externalId === id)?.name ?? "—") : "Все гости")
  const sms = smsInfo(draft.template)
  const counter = draft.channel === "sms" ? `${formatQuantity(sms.length)} символов · ${formatQuantity(sms.parts)} SMS` : `${formatQuantity(draft.template.length)} из ${formatQuantity(MAX_TEMPLATE)} символов`
  const title = card ? `Кампания ${card.number}` : "Новая кампания"

  return (
    <>
      <RightPanel
        open
        onOpenChange={(open) => {
          if (open) return
          if (dirty) setConfirm("close")
          else onClose()
        }}
        title={title}
        footer={footer}
      >
        <form aria-label="Кампания" noValidate onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-4">
          {card ? (
            <div className="flex items-center gap-2">
              <StatusPill domain="document" status={card.status} />
              <span className="text-caption text-muted-foreground">{CHANNEL_LABELS[card.channel]}</span>
            </div>
          ) : null}
          {note ? <p className="text-caption text-muted-foreground">{note}</p> : null}
          {error ? (
            <Banner ref={errorRef} tabIndex={-1} tone="danger" title="Не удалось выполнить действие">
              {error}
            </Banner>
          ) : null}

          {editable ? (
            <>
              <FormSection title="Кампания">
                <Field label="Название" error={errors.name}>
                  {(control) => <Input {...control} value={draft.name} placeholder="Комбо выходного дня" onChange={(event) => set({ name: event.target.value })} autoComplete="off" />}
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-body-sm font-medium text-muted-foreground">Канал</span>
                  <SegmentedControl<CampaignChannel>
                    aria-label="Канал"
                    value={draft.channel}
                    onValueChange={(channel) => set({ channel })}
                    options={[
                      { value: "sms", label: CHANNEL_LABELS.sms },
                      { value: "email", label: CHANNEL_LABELS.email },
                    ]}
                  />
                </div>
              </FormSection>

              <FormSection title="Аудитория">
                <Field label="Аудитория (категория)">
                  {(control) => <Select {...control} value={draft.categoryExternalId || NO_CATEGORY} onValueChange={(value) => set({ categoryExternalId: value === NO_CATEGORY ? "" : value })} options={categoryOptions} />}
                </Field>
                <Field label="Рестораны" error={errors.restaurantExternalIds} hint="Гости по ресторану первого визита">
                  {(control) => (
                    <Combobox
                      {...control}
                      multiple
                      value={draft.restaurantExternalIds}
                      onValueChange={pickRestaurants}
                      options={restaurantOptions}
                      placeholder="Выберите рестораны"
                      searchPlaceholder="Поиск ресторана"
                      emptyText="Нет доступных ресторанов"
                    />
                  )}
                </Field>
                <Banner tone="info" title={audienceLine(audience)}>
                  Только активные гости с действующим согласием на обработку персональных данных и на {draft.channel === "sms" ? "SMS" : "email"}. Гости из кассы без подтверждённого согласия не получают рассылок.
                </Banner>
              </FormSection>

              <FormSection title="Время отправки">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Дата запуска" error={errors.date}>
                    {(control) => <Input {...control} type="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} />}
                  </Field>
                  <Field label="Время запуска" error={errors.time} hint="Время Алматы">
                    {(control) => <Input {...control} type="time" step={900} value={draft.time} onChange={(event) => set({ time: event.target.value })} />}
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Не раньше часа">
                    {(control) => <Select {...control} value={draft.quietHoursStart} onValueChange={(quietHoursStart) => set({ quietHoursStart })} options={HOUR_OPTIONS.slice(0, 24)} />}
                  </Field>
                  <Field label="Не позже часа" error={errors.quietHoursEnd}>
                    {(control) => <Select {...control} value={draft.quietHoursEnd} onValueChange={(quietHoursEnd) => set({ quietHoursEnd })} options={HOUR_OPTIONS.slice(1)} />}
                  </Field>
                </div>
                <p className="text-caption text-muted-foreground">Сообщения вне окна ждут его начала: запуск в 22:00 при окне 09:00–20:00 уйдёт в 09:00 следующего дня.</p>
              </FormSection>

              <FormSection title="Текст рассылки">
                {draft.channel === "email" ? (
                  <Field label="Тема письма" error={errors.subject}>
                    {(control) => <Input {...control} value={draft.subject} onChange={(event) => set({ subject: event.target.value })} autoComplete="off" />}
                  </Field>
                ) : null}
                <Field label="Сообщение" error={errors.template} hint={counter}>
                  {(control) => <Textarea {...control} rows={5} maxLength={MAX_TEMPLATE} value={draft.template} onChange={(event) => set({ template: event.target.value })} />}
                </Field>
              </FormSection>
            </>
          ) : card ? (
            <FormSection title="Кампания">
              <ReadOnlyRows
                rows={[
                  ["Название", card.name],
                  ["Канал", CHANNEL_LABELS[card.channel]],
                  ["Аудитория", categoryName(card.categoryExternalId)],
                  ["Рестораны", restaurantNames(card.restaurantExternalIds)],
                  ["Запуск", formatAlmatyDateTime(card.scheduledAt)],
                  ["Окно отправки", formatCampaignPeriod(card).window],
                  ...(card.subject ? ([["Тема письма", card.subject]] as [string, ReactNode][]) : []),
                  ["Сообщение", <span className="whitespace-pre-line">{card.template}</span>],
                  ...(status === "pending-approval" ? ([["Получателей", audienceLine(audience)]] as [string, ReactNode][]) : []),
                  ...(card.cancelReason ? ([["Причина отмены", card.cancelReason]] as [string, ReactNode][]) : []),
                ]}
              />
            </FormSection>
          ) : null}

          {card && (status === "approved" || status === "completed" || (status === "cancelled" && card.audienceCount > 0)) ? (
            <FormSection title="Отправка">
              <ReadOnlyRows
                rows={[
                  ["Поставлено в очередь", formatQuantity(card.audienceCount)],
                  ["Отправлено", formatQuantity(card.sentCount)],
                  ["Ошибок", card.failedCount ? <span className="text-destructive">{formatQuantity(card.failedCount)}</span> : "0"],
                ]}
              />
              {card.failedCount ? <p className="text-caption text-muted-foreground">Причины ошибок и повтор — в разделе «Очередь интеграций». Без ключа провайдера сообщения не отправляются.</p> : null}
            </FormSection>
          ) : null}

          {card ? (
            <FormSection title="Проведение и аудит">
              <ReadOnlyRows
                rows={[
                  ["Номер", <span className="font-semibold">{card.number}</span>],
                  ["Статус", <StatusPill domain="document" status={card.status} />],
                  ["Создано", `${formatAlmatyDateTime(card.createdAt)} · ${card.createdBy}`],
                  ...(card.approvedAt ? ([["Согласовано", formatAlmatyDateTime(card.approvedAt)]] as [string, ReactNode][]) : []),
                  ["Изменено", formatAlmatyDateTime(card.updatedAt)],
                  ["Версия", `v${card.version}`],
                ]}
              />
              {canCancel && CANCELLABLE.includes(card.status) ? (
                <Button variant="danger" size="sm" className="self-start" onClick={() => setConfirm("cancel")} disabled={busy || dirty}>
                  {card.status === "draft" ? "Отменить черновик" : "Отменить кампанию"}
                </Button>
              ) : null}
            </FormSection>
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
        open={confirm === "cancel"}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(null)
            setDialogError(null)
          }
        }}
        title="Отменить кампанию?"
        description={card?.status === "approved" ? "Сообщения, которые ещё ждут отправки, будут сняты с очереди. Уже отправленные не отзываются." : "Кампания останется в истории со статусом «Отменён»."}
        confirmLabel="Отменить кампанию"
        cancelLabel="Не отменять"
        reasonLabel="Причина отмены"
        submitting={busy}
        error={dialogError}
        onConfirm={(reason) => cancel(reason)}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  )
}
