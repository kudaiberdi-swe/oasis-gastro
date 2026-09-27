import { useEffect, useMemo, useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { ReadOnlyRows, RecordPanelFallback } from "@/office/features/finance/ui/record-editor"
import { usePlatformScope } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { useReveal } from "@/shared/hooks/use-reveal"
import {
  Banner,
  Button,
  Combobox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  MoneyInput,
  SegmentedControl,
  Select,
  StatusPill,
  Textarea,
  useToast,
} from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity, formatTenge } from "@/shared/lib/format"

import { asGuestId, useGuestOptions, useReservation, useReservationMutations, useReservationReferences, useTables, type PaidOrder, type ReservationCard } from "../data/use-reservations"
import { formatPhone, isMasked, type DraftErrors } from "../model/loyalty-model"
import {
  CANCELLABLE,
  draftPeriod,
  NEXT_ACTION,
  paidOrderLabel,
  RECORD_TYPE_LABELS,
  reservationDay,
  reservationDraftOf,
  reservationSaveArgs,
  validateReservation,
  type ReservationDraft,
  type ReservationPrefill,
  type ReservationRecordType,
} from "../model/reservations"
import { FormSection } from "./guest-editor"

// The booking card (OFFICE-DESIGN §3.4 in the right panel, approval lifecycle §3.5): a draft is edited
// and saved; the one primary moves it on — «Отправить на согласование» → «Согласовать» → «Провести»;
// «Отменить» (danger) asks for a reason; «Провести» may link a paid check of the booking's day. Overlaps
// of a table are checked by the server and shown here. Without office.guests.pii the phone comes masked
// and is sent back as is — the server keeps the stored one (or the chosen guest's).

const NO_GUEST = "__no-guest__"
const NO_PAYMENT = "__none__"
const NO_CHECK = "__no-check__"
const HIDDEN_PHONE = "Номер скрыт — при сохранении останется прежний"

export interface ReservationEditorProps {
  /** null — a new booking. */
  externalId: string | null
  restaurantExternalId: string | undefined
  prefill?: ReservationPrefill
  onClose: () => void
  onSaved: (externalId: string) => void
}

export function ReservationEditor({ externalId, restaurantExternalId, prefill, onClose, onSaved }: ReservationEditorProps) {
  const card = useReservation(externalId)
  if (externalId && !card) return <RecordPanelFallback title="Бронь" missing={card === null} missingTitle="Бронь не найдена" onClose={onClose} />
  const restaurant = card?.restaurantExternalId ?? restaurantExternalId
  if (!restaurant) return <RecordPanelFallback title="Новая бронь" missing missingTitle="Нет доступного ресторана" onClose={onClose} />
  return <ReservationForm key={card ? `${card.externalId}:${card.version}` : "new"} card={card ?? null} restaurantExternalId={restaurant} prefill={prefill} onClose={onClose} onSaved={onSaved} />
}

function ReservationForm({ card, restaurantExternalId, prefill, onClose, onSaved }: { card: ReservationCard | null; restaurantExternalId: string; prefill?: ReservationPrefill; onClose: () => void; onSaved: (externalId: string) => void }) {
  const canEdit = useCan("office.reservations.edit")
  const canApprove = useCan("office.reservations.approve")
  const canPost = useCan("office.reservations.post")
  const canCancel = useCan("office.reservations.cancel")
  const status = card?.status ?? "draft"
  const editable = canEdit && status === "draft"
  const scope = usePlatformScope()
  const tables = useTables(restaurantExternalId)
  // Payment types always; the day's paid checks only while «Провести» is possible.
  const references = useReservationReferences(restaurantExternalId, status === "approved" && card ? reservationDay(card.start) : undefined)
  const paymentOptions = (references?.paymentTypes ?? []).map((row) => ({ value: row.externalId, label: row.name }))
  const { saveReservation, transitionReservation } = useReservationMutations()
  const toast = useToast()

  const [baseline, setBaseline] = useState(() => reservationDraftOf(card, prefill))
  const [draft, setDraft] = useState(baseline)
  const [errors, setErrors] = useState<DraftErrors<keyof ReservationDraft>>({})
  const [error, setError] = useState<string | null>(null)
  // The buttons are in the footer, the banner at the top of a scrolled panel: bring it into view.
  const errorRef = useReveal(error)
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<"close" | "cancel" | "complete" | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [guestSearch, setGuestSearch] = useState("")
  const guestNeedle = useDebounced(guestSearch)
  const guestOptions = useGuestOptions(guestNeedle, editable)
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(baseline)
  const blocker = useUnsavedChanges(dirty)

  // Open the saved card only once the form is clean, so the unsaved-changes guard lets the navigation through.
  useEffect(() => {
    if (savedId && savedId !== card?.externalId) onSaved(savedId)
  }, [savedId, card?.externalId, onSaved])

  const activeTables = useMemo(() => (tables ?? []).filter((table) => table.active || draft.tableExternalIds.includes(table.externalId)), [tables, draft.tableExternalIds])
  const halls = useMemo(() => [...new Set([...activeTables.map((table) => table.hall), ...(draft.hall ? [draft.hall] : [])])].sort((a, b) => a.localeCompare(b, "ru")), [activeTables, draft.hall])
  const hallTables = activeTables.filter((table) => table.hall === draft.hall)
  const capacityOf = (id: string) => tables?.find((table) => table.externalId === id)?.capacity
  const tableLabel = (id: string) => tables?.find((table) => table.externalId === id)?.label ?? "—"
  const capacity = draft.tableExternalIds.reduce((sum, id) => sum + (capacityOf(id) ?? 0), 0)
  const period = draftPeriod(draft)

  const set = (patch: Partial<ReservationDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof ReservationDraft]
      return next
    })
  }

  const checked = () => {
    const found = validateReservation(draft, capacityOf, { phoneOnFile: Boolean(card) || Boolean(draft.guestId) })
    setErrors(found)
    return Object.keys(found).length === 0
  }

  /** The server's «Стол «…» уже забронирован…» goes under «Стол(ы)», everything else into the banner. */
  const fail = (caught: unknown, fallback: string) => {
    const message = errorMessage(caught, fallback)
    if (/забронирован|Вместимость|Выберите стол|Стол не найден/.test(message)) setErrors((current) => ({ ...current, [/Вместимость/.test(message) ? "guestCount" : "tableExternalIds"]: message }))
    setError(message)
  }

  async function persist() {
    if (card && !dirty) return { externalId: card.externalId, version: card.version }
    const saved = await saveReservation({ ...reservationSaveArgs(draft, restaurantExternalId, card), ...(draft.guestId ? { guestId: asGuestId(draft.guestId) } : {}) })
    setBaseline(draft)
    return saved
  }

  async function saveDraft() {
    if (!editable || busy || !checked()) return
    setBusy(true)
    setError(null)
    try {
      const saved = await persist()
      toast(card ? "Черновик брони сохранён" : "Бронь создана", "success")
      setSavedId(saved.externalId)
    } catch (caught) {
      fail(caught, "Не удалось сохранить бронь")
    } finally {
      setBusy(false)
    }
  }

  const next = NEXT_ACTION[status]
  const allowedNext = next && (next.action === "submit" ? canEdit : next.action === "approve" ? canApprove : canPost) ? next : null

  async function advance() {
    if (!allowedNext || busy) return
    if (status === "draft" && !checked()) return
    // «Провести» asks which paid check of the day closed the banquet (optional).
    if (allowedNext.action === "complete") {
      setDialogError(null)
      setConfirm("complete")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const target = status === "draft" ? await persist() : { externalId: card!.externalId, version: card!.version }
      await transitionReservation({ externalId: target.externalId, action: allowedNext.action, expectedVersion: target.version })
      toast(allowedNext.done, "success")
      setSavedId(target.externalId)
    } catch (caught) {
      fail(caught, allowedNext.failed)
    } finally {
      setBusy(false)
    }
  }

  async function complete(orderId: PaidOrder["orderId"] | undefined) {
    if (!card || !allowedNext || busy) return
    setBusy(true)
    setDialogError(null)
    try {
      await transitionReservation({ externalId: card.externalId, action: "complete", expectedVersion: card.version, ...(orderId ? { orderId } : {}) })
      toast(allowedNext.done, "success")
      setConfirm(null)
    } catch (caught) {
      setDialogError(errorMessage(caught, allowedNext.failed))
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
      await transitionReservation({ externalId: card.externalId, action: "cancel", expectedVersion: card.version, reason })
      toast("Бронь отменена", "success")
      setConfirm(null)
    } catch (caught) {
      setDialogError(errorMessage(caught, "Не удалось отменить бронь"))
    } finally {
      setBusy(false)
    }
  }

  const advanceButton = allowedNext ? (
    <Button onClick={() => void advance()} disabled={busy}>
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

  const note = !card || editable ? null : status === "pending-approval" ? "Бронь на согласовании; изменить её можно после отмены." : status === "approved" ? "Бронь согласована — стол закреплён за гостем." : status === "completed" ? "Бронь проведена." : status === "cancelled" ? "Бронь отменена, стол освобождён." : "Черновик меняет сотрудник с правом редактирования броней."

  const guestChoices = [
    { value: NO_GUEST, label: "Без карточки гостя" },
    ...(card?.guestId && !guestOptions.guests.some((guest) => guest._id === card.guestId) ? [{ value: card.guestId, label: card.guestName }] : []),
    ...guestOptions.guests.map((guest) => ({ value: guest._id, label: guest.name || "Без имени", hint: formatPhone(guest.phone) })),
  ]
  const pickGuest = (value: string) => {
    if (value === NO_GUEST) {
      set({ guestId: "" })
      return
    }
    const guest = guestOptions.guests.find((candidate) => candidate._id === value)
    if (!guest) return
    // A masked guest phone is sent as is with the guestId: the server takes the guest's number.
    set({ guestId: guest._id, guestName: guest.name || draft.guestName, phone: guest.phone })
  }
  const pickedMaskedGuest = Boolean(draft.guestId) && isMasked(draft.phone) && guestOptions.guests.some((guest) => guest._id === draft.guestId && guest.phone === draft.phone)
  // A saved draft keeps its own stored phone for a mask, even with another guest chosen.
  const maskedKeepsCardPhone = pickedMaskedGuest && Boolean(card) && draft.guestId !== (card?.guestId ?? "")
  const phoneHint = !isMasked(draft.phone) ? undefined : maskedKeepsCardPhone ? "Номер гостя скрыт — останется прежний номер брони; чтобы сменить, введите номер" : pickedMaskedGuest && !card ? "Номер скрыт — сохранится номер из карточки гостя" : HIDDEN_PHONE

  const paymentName = (id: string | undefined) => (id ? (paymentOptions.find((option) => option.value === id)?.label ?? "—") : "—")
  const title = card ? `${RECORD_TYPE_LABELS[card.recordType]} ${card.number}` : "Новая бронь"

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
        <form aria-label="Бронь" noValidate onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-4">
          {card ? (
            <div className="flex items-center gap-2">
              <StatusPill domain="document" status={card.status} />
              <span className="text-caption text-muted-foreground">{scope.restaurantName(card.restaurantExternalId)}</span>
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
              <FormSection title="Бронь">
                <div className="flex flex-col gap-1.5">
                  <span className="text-body-sm font-medium text-muted-foreground">Тип</span>
                  <SegmentedControl<ReservationRecordType>
                    aria-label="Тип брони"
                    value={draft.recordType}
                    onValueChange={(recordType) => set({ recordType })}
                    options={[
                      { value: "reservation", label: RECORD_TYPE_LABELS.reservation },
                      { value: "banquet", label: RECORD_TYPE_LABELS.banquet },
                    ]}
                  />
                </div>
                <Field label="Зал" error={errors.hall} hint={tables !== undefined && !halls.length ? "Столов пока нет — расставьте их на схеме зала" : undefined}>
                  {(control) => (
                    <Select
                      {...control}
                      value={draft.hall || undefined}
                      placeholder="Выберите зал"
                      onValueChange={(hall) => set({ hall, tableExternalIds: hall === draft.hall ? draft.tableExternalIds : [] })}
                      options={halls.map((hall) => ({ value: hall, label: hall }))}
                    />
                  )}
                </Field>
                <Field label="Стол(ы)" error={errors.tableExternalIds} hint={draft.tableExternalIds.length ? `Вместимость: ${formatQuantity(capacity)}` : undefined}>
                  {(control) => (
                    <Combobox
                      {...control}
                      multiple
                      value={draft.tableExternalIds}
                      onValueChange={(tableExternalIds) => set({ tableExternalIds })}
                      options={hallTables.map((table) => ({ value: table.externalId, label: table.label, hint: `мест: ${formatQuantity(table.capacity)}` }))}
                      placeholder={draft.hall ? "Выберите стол" : "Сначала выберите зал"}
                      searchPlaceholder="Поиск стола"
                      emptyText="В зале нет активных столов"
                      disabled={!draft.hall}
                    />
                  )}
                </Field>
              </FormSection>

              <FormSection title="Гость">
                {guestOptions.canView ? (
                  <Field label="Гость" hint="Найдите гостя в базе или впишите имя и телефон ниже">
                    {(control) => (
                      <Combobox
                        {...control}
                        value={draft.guestId || NO_GUEST}
                        onValueChange={pickGuest}
                        options={guestChoices}
                        onSearchChange={setGuestSearch}
                        searchPlaceholder="Имя, телефон или номер карты"
                        emptyText={guestOptions.loading ? "Загрузка…" : "Гости не найдены"}
                      />
                    )}
                  </Field>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Имя гостя" error={errors.guestName}>
                    {(control) => <Input {...control} value={draft.guestName} onChange={(event) => set({ guestName: event.target.value })} autoComplete="off" />}
                  </Field>
                  <div className="flex flex-col gap-1.5">
                    <Field label="Телефон" error={errors.phone} hint={phoneHint}>
                      {(control) => (
                        <Input {...control} type="tel" inputMode="tel" placeholder="+7 701 000 00 00" value={draft.phone} readOnly={isMasked(draft.phone)} onChange={(event) => set({ phone: event.target.value })} autoComplete="off" />
                      )}
                    </Field>
                    {isMasked(draft.phone) ? (
                      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => set({ phone: "" })}>
                        Ввести новый номер
                      </Button>
                    ) : null}
                  </div>
                </div>
              </FormSection>

              <FormSection title="Время и гости">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Дата" error={errors.date}>
                    {(control) => <Input {...control} type="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} />}
                  </Field>
                  <Field label="Начало" error={errors.startTime}>
                    {(control) => <Input {...control} type="time" step={900} value={draft.startTime} onChange={(event) => set({ startTime: event.target.value })} />}
                  </Field>
                  <Field label="Окончание" error={errors.endTime} hint={period?.nextDay ? "На следующий день" : undefined}>
                    {(control) => <Input {...control} type="time" step={900} value={draft.endTime} onChange={(event) => set({ endTime: event.target.value })} />}
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Гостей" error={errors.guestCount}>
                    {(control) => <Input {...control} inputMode="numeric" value={draft.guestCount} onChange={(event) => set({ guestCount: event.target.value.replace(/\D/g, "") })} autoComplete="off" />}
                  </Field>
                  <Field label="Повод">{(control) => <Input {...control} value={draft.occasion} placeholder="День рождения, юбилей…" onChange={(event) => set({ occasion: event.target.value })} />}</Field>
                </div>
              </FormSection>

              <FormSection title="Предоплата и меню">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Предоплата">{(control) => <MoneyInput {...control} value={draft.prepayment} onValueChange={(prepayment) => set({ prepayment, ...(prepayment ? {} : { prepaymentTypeExternalId: "" }) })} />}</Field>
                  <Field
                    label="Тип оплаты"
                    error={errors.prepaymentTypeExternalId}
                    hint={references !== undefined && !paymentOptions.length ? "Нет действующих типов оплат для ресторана" : undefined}
                  >
                    {(control) => (
                      <Select
                        {...control}
                        value={draft.prepaymentTypeExternalId || NO_PAYMENT}
                        onValueChange={(value) => set({ prepaymentTypeExternalId: value === NO_PAYMENT ? "" : value })}
                        options={[{ value: NO_PAYMENT, label: "—" }, ...paymentOptions]}
                        disabled={!draft.prepayment}
                      />
                    )}
                  </Field>
                </div>
                <p className="text-caption text-muted-foreground">Предоплата проводится при согласовании брони и возвращается сторно при отмене.</p>
                <Field label="Банкетное меню и пожелания">{(control) => <Textarea {...control} rows={4} value={draft.menu} onChange={(event) => set({ menu: event.target.value })} />}</Field>
              </FormSection>
            </>
          ) : card ? (
            <FormSection title="Бронь">
              <ReadOnlyRows
                rows={[
                  ["Тип", RECORD_TYPE_LABELS[card.recordType]],
                  ["Зал", card.hall],
                  ["Стол(ы)", card.tableExternalIds.map(tableLabel).join(", ")],
                  ["Гость", card.guestName],
                  ["Телефон", formatPhone(card.phone)],
                  ["Начало", formatAlmatyDateTime(card.start)],
                  ["Окончание", formatAlmatyDateTime(card.end)],
                  ["Гостей", formatQuantity(card.guestCount)],
                  ["Повод", card.occasion || "—"],
                  ["Предоплата", card.prepayment ? `${formatTenge(card.prepayment)} · ${paymentName(card.prepaymentTypeExternalId)}` : "—"],
                  ...(card.orderId ? ([["Чек", "Связан с оплаченным чеком"]] as [string, ReactNode][]) : []),
                  ["Банкетное меню и пожелания", card.menu ? <span className="whitespace-pre-line">{card.menu}</span> : "—"],
                  ...(card.cancelReason ? ([["Причина отмены", card.cancelReason]] as [string, ReactNode][]) : []),
                ]}
              />
            </FormSection>
          ) : null}

          {card ? (
            <FormSection title="Проведение и аудит">
              <ReadOnlyRows
                rows={[
                  ["Номер", <span className="font-semibold">{card.number}</span>],
                  ["Статус", <StatusPill domain="document" status={card.status} />],
                  ["Создано", `${formatAlmatyDateTime(card.createdAt)} · ${card.createdBy}`],
                  ["Изменено", formatAlmatyDateTime(card.updatedAt)],
                  ...(card.prepaymentPostedAt ? ([["Предоплата проведена", formatAlmatyDateTime(card.prepaymentPostedAt)]] as [string, ReactNode][]) : []),
                  ["Версия", `v${card.version}`],
                ]}
              />
              {canCancel && CANCELLABLE.includes(card.status) ? (
                <Button variant="danger" size="sm" className="self-start" onClick={() => setConfirm("cancel")} disabled={busy || dirty}>
                  {card.status === "draft" ? "Отменить черновик" : "Отменить бронь"}
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
        title="Отменить бронь?"
        description={card?.prepaymentPostedAt ? "Стол освободится; проведённая предоплата вернётся обратной проводкой." : "Стол освободится; бронь останется в истории со статусом «Отменён»."}
        confirmLabel="Отменить бронь"
        cancelLabel="Не отменять"
        reasonLabel="Причина отмены"
        submitting={busy}
        error={dialogError}
        onConfirm={(reason) => cancel(reason)}
      />
      {confirm === "complete" && card ? (
        <CompleteDialog card={card} paidOrders={references?.paidOrders} busy={busy} error={dialogError} onClose={() => (busy ? undefined : setConfirm(null))} onConfirm={(orderId) => void complete(orderId)} />
      ) : null}
      <UnsavedChangesDialog blocker={blocker} />
    </>
  )
}

/** «Провести»: optionally the paid check of the booking's day the banquet was closed with (the advance is offset there). */
function CompleteDialog({
  card,
  paidOrders,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  card: ReservationCard
  paidOrders: PaidOrder[] | undefined
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (orderId: PaidOrder["orderId"] | undefined) => void
}) {
  const [choice, setChoice] = useState<string>(NO_CHECK)
  const day = reservationDay(card.start).split("-").reverse().join(".")
  const options = [{ value: NO_CHECK, label: "Без чека" }, ...(paidOrders ?? []).map((order) => ({ value: order.orderId, label: paidOrderLabel(order) }))]
  const picked = paidOrders?.find((order) => order.orderId === choice)
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Провести {card.number}?</DialogTitle>
          <DialogDescription>Бронь станет проведённой. Можно связать её с оплаченным чеком банкета — предоплата засчитывается в этом чеке.</DialogDescription>
        </DialogHeader>
        <Field
          label="Оплаченный чек"
          hint={paidOrders === undefined ? undefined : paidOrders.length ? `Оплаченные чеки ресторана за ${day}` : `За ${day} оплаченных чеков нет — проведите без чека`}
        >
          {(control) => <Select {...control} value={choice} onValueChange={setChoice} options={options} disabled={paidOrders === undefined || busy} placeholder={paidOrders === undefined ? "Загрузка…" : "Выберите чек"} />}
        </Field>
        {error ? (
          <Banner tone="danger" title="Бронь не проведена">
            {error}
          </Banner>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => onConfirm(picked?.orderId)} disabled={busy}>
            {busy ? "Проведение…" : "Провести"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
