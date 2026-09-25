import { useState } from "react"

import { useCan } from "@/office/components/can"
import { Banner, Button, Combobox, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, StatusPill, Textarea, useToast } from "@/shared/components/ui"
import { useReveal } from "@/shared/hooks/use-reveal"
import { errorMessage } from "@/shared/lib/error-message"

import { usePositions, useScheduleMutations, useShiftTypes, type SaveEntryArgs, type ScheduleRow, type ScheduleShift } from "../data/use-workforce-w2"
import { dayLabel, formatShiftHours, minuteToTime, plannedHours, scheduleArgs, scheduleDraftOf, scheduleTimes, shiftBlockLayout, validateSchedule, type DraftErrors, type ScheduleDraft } from "../model/w2"
import { ReadOnlyField } from "./reference-parts"
import { TimeInput } from "./time-input"

// «Новая смена» / a shift of the week (W2-HR-04). A draft is edited in place; a published shift is read-only —
// the server only lets it be taken off («Снять смену») and replaced with a new one.

const NO_TYPE = "none"
const EMPLOYEE_POSITION = "employee"

export interface ScheduleShiftDialogProps {
  restaurantExternalId: string
  rows: ScheduleRow[]
  /** null — a new shift for `defaults`. */
  entry: ScheduleShift | null
  defaults?: { employeeId?: string; date?: string }
  canEdit: boolean
  onClose: () => void
}

export function ScheduleShiftDialog({ restaurantExternalId, rows, entry, defaults, canEdit, onClose }: ScheduleShiftDialogProps) {
  // «Снять и создать новую» turns the dialog of a published shift into a new one with the same values.
  const [replacement, setReplacement] = useState<ScheduleDraft | null>(null)
  const readOnly = !canEdit || (entry !== null && entry.status !== "draft" && replacement === null)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* flex: the form's DialogBody scrolls, its buttons stay on screen (see DialogBody). */}
      <DialogContent className="flex max-w-2xl flex-col">
        {readOnly && entry ? (
          <PublishedShift entry={entry} rows={rows} canEdit={canEdit} onClose={onClose} onReplace={setReplacement} />
        ) : (
          <ShiftForm key={replacement ? "replacement" : "form"} restaurantExternalId={restaurantExternalId} rows={rows} entry={replacement ? null : entry} initial={replacement ?? scheduleDraftOf(entry, defaults)} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function employeeName(rows: ScheduleRow[], employeeId: string) {
  return rows.find((row) => row.employeeId === employeeId)?.employeeName ?? "Сотрудник"
}

function PublishedShift({ entry, rows, canEdit, onClose, onReplace }: { entry: ScheduleShift; rows: ScheduleRow[]; canEdit: boolean; onClose: () => void; onReplace: (draft: ScheduleDraft) => void }) {
  const { removeEntry } = useScheduleMutations()
  const toast = useToast()
  const [confirm, setConfirm] = useState<"remove" | "replace" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const layout = shiftBlockLayout(entry)
  const { weekday, day } = dayLabel(entry.businessDate)

  async function remove(mode: "remove" | "replace") {
    setBusy(true)
    setError(null)
    try {
      await removeEntry({ externalId: entry.externalId })
      setConfirm(null)
      if (mode === "replace") {
        toast("Смена снята — создайте новую", "success")
        onReplace(scheduleDraftOf(entry))
      } else {
        toast("Смена снята", "success")
        onClose()
      }
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось снять смену"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Смена {employeeName(rows, entry.employeeId)}</DialogTitle>
        <DialogDescription>
          {weekday} {day} · {layout.timeLabel}
          {layout.nextDay ? " (до следующего дня)" : ""}
        </DialogDescription>
      </DialogHeader>
      {entry.status === "published" ? (
        <Banner tone="info" title="Смена опубликована — только чтение">
          Сотрудник уже видит её в своём расписании. Чтобы изменить смену, снимите её и создайте новую.
        </Banner>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <ReadOnlyField label="Статус" value={<StatusPill domain="document" status={entry.status} />} />
        <ReadOnlyField label="Тип смены" value={entry.shiftTypeName ?? "—"} />
        <ReadOnlyField label="Время" value={`${layout.timeLabel}${layout.nextDay ? " +1" : ""}`} />
        <ReadOnlyField label="Перерыв" value={`${entry.breakMinutes} мин`} />
        <ReadOnlyField label="Плановые часы" value={formatShiftHours(entry.plannedHours)} />
        <ReadOnlyField label="Комментарий" value={entry.comment || "—"} />
      </div>
      {error && confirm === null ? (
        <Banner tone="danger" title="Не удалось выполнить действие">
          {error}
        </Banner>
      ) : null}
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
        {canEdit && entry.status === "published" ? (
          <>
            <Button variant="danger" onClick={() => setConfirm("remove")} disabled={busy}>
              Снять смену
            </Button>
            <Button onClick={() => setConfirm("replace")} disabled={busy}>
              Снять и создать новую
            </Button>
          </>
        ) : null}
      </DialogFooter>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Снять опубликованную смену?"
        description={confirm === "replace" ? "Смена станет неактивной, а форма откроется для новой смены с теми же данными." : "Смена станет неактивной и пропадёт из расписания сотрудника; в истории она сохранится."}
        confirmLabel="Снять смену"
        submitting={busy}
        error={confirm !== null ? error : null}
        onConfirm={() => remove(confirm ?? "remove")}
      />
    </>
  )
}

function ShiftForm({ restaurantExternalId, rows, entry, initial, onClose }: { restaurantExternalId: string; rows: ScheduleRow[]; entry: ScheduleShift | null; initial: ScheduleDraft; onClose: () => void }) {
  const canSeeShiftTypes = useCan("office.shift-types.view")
  const canSeePositions = useCan("office.positions.view")
  const shiftTypes = useShiftTypes("active", canSeeShiftTypes)
  const positions = usePositions("active", canSeePositions)
  const { saveEntry, removeEntry } = useScheduleMutations()
  const toast = useToast()
  const [draft, setDraft] = useState(initial)
  const [errors, setErrors] = useState<DraftErrors<keyof ScheduleDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | "remove" | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  // A save error shows at the top of the scrolled body: bring it into view (the removal's goes to its dialog).
  const errorRef = useReveal(confirmRemove ? null : error)
  const set = (patch: Partial<ScheduleDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof ScheduleDraft]
      return next
    })
  }

  const times = scheduleTimes(draft)
  const hours = times && /^\d+$/.test(draft.breakMinutes) ? plannedHours(times.start, times.end, Number(draft.breakMinutes)) : null

  function pickShiftType(value: string) {
    if (value === NO_TYPE) return set({ shiftTypeExternalId: "" })
    const type = shiftTypes?.find((row) => row.externalId === value)
    set(type ? { shiftTypeExternalId: value, start: minuteToTime(type.startMinute), end: minuteToTime(type.endMinute), breakMinutes: String(type.breakMinutes) } : { shiftTypeExternalId: value })
  }

  async function submit() {
    if (busy) return
    const found = validateSchedule(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy("save")
    setError(null)
    try {
      await saveEntry(scheduleArgs(restaurantExternalId, entry, draft) as SaveEntryArgs)
      toast(entry ? "Смена сохранена" : "Смена создана", "success")
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить смену"))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!entry) return
    setBusy("remove")
    setError(null)
    try {
      await removeEntry({ externalId: entry.externalId })
      toast("Смена удалена", "success")
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось удалить смену"))
    } finally {
      setBusy(null)
    }
  }

  const employeeOptions = rows.map((row) => ({ value: row.employeeId, label: row.employeeName, hint: row.positionName ?? `код ${row.employeeCode}` }))
  const typeOptions = [{ value: NO_TYPE, label: "Без типа" }, ...(shiftTypes ?? []).map((row) => ({ value: row.externalId, label: `${row.name} · ${row.timeLabel}` }))]
  if (draft.shiftTypeExternalId && !typeOptions.some((option) => option.value === draft.shiftTypeExternalId)) typeOptions.push({ value: draft.shiftTypeExternalId, label: entry?.shiftTypeName ?? "Неактивный тип" })
  const positionOptions = [{ value: EMPLOYEE_POSITION, label: "Как в карточке сотрудника" }, ...(positions ?? []).map((row) => ({ value: row.externalId, label: row.name }))]
  if (draft.positionExternalId && !positionOptions.some((option) => option.value === draft.positionExternalId)) positionOptions.push({ value: draft.positionExternalId, label: "Неактивная должность" })

  return (
    <>
      <DialogHeader>
        <DialogTitle>{entry ? "Смена" : "Новая смена"}</DialogTitle>
        <DialogDescription>{entry ? "Черновик — изменения увидит сотрудник после публикации недели." : "Смена создаётся черновиком; сервер проверит пересечения с другими сменами сотрудника."}</DialogDescription>
      </DialogHeader>
      <form
        aria-label={entry ? "Смена" : "Новая смена"}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="flex min-h-0 flex-col gap-4"
      >
        <DialogBody className="flex flex-col gap-4">
          {error ? (
            <Banner ref={errorRef} tabIndex={-1} tone="danger" title="Не удалось сохранить">
              {error}
            </Banner>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Сотрудник" error={errors.employeeId} className="sm:col-span-2">
              {(control) => (
                <Combobox
                  {...control}
                  value={draft.employeeId || undefined}
                  onValueChange={(employeeId) => set({ employeeId })}
                  options={employeeOptions}
                  disabled={entry !== null}
                  placeholder="Выберите сотрудника"
                  searchPlaceholder="ФИО или код"
                  emptyText="В ресторане нет активных сотрудников"
                />
              )}
            </Field>
            {canSeeShiftTypes ? (
              <Field label="Тип смены" hint="Подставит время и перерыв">
                {(control) => <Select {...control} value={draft.shiftTypeExternalId || NO_TYPE} onValueChange={pickShiftType} options={typeOptions} disabled={shiftTypes === undefined} />}
              </Field>
            ) : null}
            {canSeePositions ? (
              <Field label="Должность">
                {(control) => (
                  <Select
                    {...control}
                    value={draft.positionExternalId || EMPLOYEE_POSITION}
                    onValueChange={(value) => set({ positionExternalId: value === EMPLOYEE_POSITION ? "" : value })}
                    options={positionOptions}
                    disabled={positions === undefined}
                  />
                )}
              </Field>
            ) : null}
            <Field label="Дата" error={errors.date}>
              {(control) => <Input {...control} type="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} />}
            </Field>
            <Field label="Перерыв, мин" error={errors.breakMinutes}>
              {(control) => <Input {...control} inputMode="numeric" autoComplete="off" className="text-right tabular-nums" value={draft.breakMinutes} onChange={(event) => set({ breakMinutes: event.target.value.replace(/\D/g, "").slice(0, 3) })} />}
            </Field>
            <Field label="Начало" error={errors.start} hint="Время Алматы">
              {(control) => <TimeInput {...control} value={draft.start} onValueChange={(start) => set({ start })} />}
            </Field>
            <Field label="Окончание" error={errors.end} hint={times?.nextDay ? "На следующий день" : undefined}>
              {(control) => <TimeInput {...control} value={draft.end} onValueChange={(end) => set({ end })} />}
            </Field>
            <Field label="Комментарий" className="sm:col-span-2">
              {(control) => <Textarea {...control} value={draft.comment} onChange={(event) => set({ comment: event.target.value })} />}
            </Field>
          </div>
          <p className="text-body-sm text-muted-foreground">
            Плановые часы: <span className="font-semibold text-foreground">{hours === null ? "—" : formatShiftHours(hours)}</span>
          </p>
        </DialogBody>
        <DialogFooter>
          {entry ? (
            <Button type="button" variant="danger" onClick={() => setConfirmRemove(true)} disabled={busy !== null}>
              Удалить смену
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy !== null}>
            {busy === "save" ? "Сохранение…" : entry ? "Сохранить" : "Создать смену"}
          </Button>
        </DialogFooter>
      </form>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Удалить черновик смены?"
        description="Черновик ещё не опубликован — он будет удалён без следа в расписании сотрудника."
        confirmLabel="Удалить смену"
        submitting={busy === "remove"}
        error={confirmRemove ? error : null}
        onConfirm={() => remove()}
      />
    </>
  )
}
