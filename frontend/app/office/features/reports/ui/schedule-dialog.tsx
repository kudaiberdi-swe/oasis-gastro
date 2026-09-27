import { Mail, X } from "lucide-react"
import { useId, useState, type FormEvent, type KeyboardEvent } from "react"

import { useCan } from "@/office/components/can"
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, SegmentedControl, Select, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, focusRingClass } from "@/shared/lib/utils"

import type { ReportConfig } from "../data/use-reports"
import { useReportScheduleActions, type ReportSchedule } from "../data/use-report-schedules"
import { formatPeriod } from "../model/format"
import {
  CADENCE_LABELS,
  DEFAULT_PERIOD,
  DEFAULT_TIME,
  isValidEmail,
  MAX_RECIPIENTS,
  nextRunAt,
  parseTimeOfDay,
  PERIOD_LABELS,
  periodFor,
  splitEmails,
  WEEKDAYS,
  type Cadence,
  type PeriodPreset,
  type ScheduleFormat,
} from "../model/schedules"

// «Рассылка отчёта» (W2-RPT-06): opened from the report viewer with the current report and filters, or
// from «Рассылки отчётов» to change a schedule. Time is Asia/Almaty; the first run and the data period
// are previewed with the server's own calendar. PDF waits for print templates (W3-ADM-10).

type ScheduleReport = { id: string; title: string }

export const SCHEDULE_CREATED = "Рассылка создана"

/** «Рассылка» in the viewer: hidden without `office.report-schedules.edit` (OFFICE-DESIGN §7). */
export function ScheduleButton({ report, config }: { report: ScheduleReport; config: ReportConfig | null }) {
  const canEdit = useCan("office.report-schedules.edit")
  const [open, setOpen] = useState(false)
  if (!canEdit) return null
  return (
    <>
      <Button variant="secondary" size="sm" disabled={!config} onClick={() => setOpen(true)}>
        <Mail aria-hidden />
        Рассылка
      </Button>
      {config ? <ScheduleDialog open={open} onOpenChange={setOpen} report={report} config={config} /> : null}
    </>
  )
}

type Draft = {
  name: string
  recipients: string[]
  format: Exclude<ScheduleFormat, "pdf">
  cadence: Cadence
  timeOfDay: string
  weekday: number
  dayOfMonth: number
  periodPreset: PeriodPreset
}

function initialDraft(report: ScheduleReport, schedule?: ReportSchedule): Draft {
  if (schedule) {
    return {
      name: schedule.name,
      recipients: schedule.recipients,
      format: schedule.format === "csv" ? "csv" : "xlsx",
      cadence: schedule.cadence,
      timeOfDay: schedule.timeOfDay,
      weekday: schedule.weekday ?? 1,
      dayOfMonth: schedule.dayOfMonth ?? 1,
      periodPreset: schedule.periodPreset,
    }
  }
  return { name: report.title, recipients: [], format: "xlsx", cadence: "daily", timeOfDay: DEFAULT_TIME, weekday: 1, dayOfMonth: 1, periodPreset: DEFAULT_PERIOD.daily }
}

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: ScheduleReport
  config: ReportConfig
  /** Editing an existing schedule (its report and config stay). */
  schedule?: ReportSchedule
}

const FORMAT_OPTIONS = [
  { value: "xlsx", label: "XLSX" },
  { value: "csv", label: "CSV" },
  { value: "pdf", label: "PDF", disabled: true },
] as const

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))

export function ScheduleDialog({ open, onOpenChange, ...props }: DialogProps) {
  // The form lives inside the content (unmounted while closed), so every opening starts afresh.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <ScheduleForm {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ScheduleForm({ report, config, schedule, onClose }: Omit<DialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const { save } = useReportScheduleActions()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(() => initialDraft(report, schedule))
  const [pending, setPending] = useState("")
  const [recipientsError, setRecipientsError] = useState<string | null>(null)
  const [timeError, setTimeError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const timing = { cadence: draft.cadence, timeOfDay: draft.timeOfDay, weekday: draft.weekday, dayOfMonth: draft.dayOfMonth }
  const validTime = parseTimeOfDay(draft.timeOfDay) !== null
  // The first slot the server will store and the data period of that run.
  const first = validTime ? nextRunAt(timing, Date.now()) : null
  const preview = first === null ? null : { first, period: periodFor(draft.periodPreset, first) }

  /** Adds the typed text as chips; returns the list or null when something is wrong. */
  function commitPending(text = pending): string[] | null {
    const candidates = splitEmails(text)
    if (!candidates.length) return draft.recipients
    const invalid = candidates.find((email) => !isValidEmail(email))
    if (invalid) {
      setRecipientsError(`Некорректный email: ${invalid}`)
      return null
    }
    const next = [...new Set([...draft.recipients, ...candidates])]
    if (next.length > MAX_RECIPIENTS) {
      setRecipientsError(`Не больше ${MAX_RECIPIENTS} получателей`)
      return null
    }
    setRecipientsError(null)
    setPending("")
    set("recipients", next)
    return next
  }

  function onRecipientKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === ";") {
      event.preventDefault()
      commitPending()
    } else if (event.key === "Backspace" && pending === "" && draft.recipients.length) {
      set("recipients", draft.recipients.slice(0, -1))
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const recipients = commitPending()
    if (!recipients) return
    if (!recipients.length) {
      setRecipientsError("Добавьте хотя бы одного получателя")
      return
    }
    if (!validTime) {
      setTimeError("Укажите время в формате ЧЧ:ММ")
      return
    }
    setSaving(true)
    try {
      const saved = await save({
        externalId: schedule?.externalId,
        reportId: schedule?.reportId ?? report.id,
        viewExternalId: schedule?.viewExternalId,
        name: draft.name.trim() || report.title,
        recipients,
        format: draft.format,
        cadence: draft.cadence,
        timeOfDay: draft.timeOfDay,
        weekday: draft.cadence === "weekly" ? draft.weekday : undefined,
        dayOfMonth: draft.cadence === "monthly" ? draft.dayOfMonth : undefined,
        periodPreset: draft.periodPreset,
        config: schedule?.config ?? config,
      })
      toast(`${schedule ? "Рассылка сохранена" : SCHEDULE_CREATED}. Следующий запуск — ${formatAlmatyDateTime(saved.nextRunAt)}`, "success")
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить рассылку"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Рассылка отчёта</DialogTitle>
        <DialogDescription>{report.title}. Рестораны и фильтры — как сейчас в отчёте, период данных считается на момент запуска. Время — Алматы.</DialogDescription>
      </DialogHeader>

      <Field label="Название">{(control) => <Input {...control} value={draft.name} maxLength={120} autoComplete="off" onChange={(event) => set("name", event.target.value)} />}</Field>

      <RecipientsField
        recipients={draft.recipients}
        pending={pending}
        error={recipientsError}
        onPendingChange={(value) => {
          setPending(value)
          if (recipientsError) setRecipientsError(null)
        }}
        onKeyDown={onRecipientKey}
        onBlur={() => void commitPending()}
        onRemove={(email) =>
          set(
            "recipients",
            draft.recipients.filter((item) => item !== email),
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Формат" hint="PDF появится с шаблонами печати">
          {() => (
            <SegmentedControl
              aria-label="Формат"
              value={draft.format}
              onValueChange={(value) => value !== "pdf" && set("format", value)}
              options={FORMAT_OPTIONS.map((option) => ({ ...option }))}
              className="w-full"
            />
          )}
        </Field>
        <Field label="Периодичность">
          {(control) => (
            <Select
              {...control}
              value={draft.cadence}
              onValueChange={(value) => setDraft((current) => ({ ...current, cadence: value as Cadence, periodPreset: DEFAULT_PERIOD[value as Cadence] }))}
              options={(Object.keys(CADENCE_LABELS) as Cadence[]).map((value) => ({ value, label: CADENCE_LABELS[value] }))}
            />
          )}
        </Field>
        <Field label="Время (Алматы)" error={timeError ?? undefined}>
          {(control) => (
            <Input
              {...control}
              type="time"
              step={60}
              value={draft.timeOfDay}
              onChange={(event) => {
                set("timeOfDay", event.target.value)
                setTimeError(null)
              }}
            />
          )}
        </Field>
        {draft.cadence === "weekly" ? (
          <Field label="День недели">
            {(control) => (
              <Select
                {...control}
                value={String(draft.weekday)}
                onValueChange={(value) => set("weekday", Number(value))}
                options={WEEKDAYS.map((day) => ({ value: String(day.value), label: day.label }))}
              />
            )}
          </Field>
        ) : draft.cadence === "monthly" ? (
          <Field label="День месяца" hint={draft.dayOfMonth > 28 ? "В коротких месяцах — последний день" : undefined}>
            {(control) => <Select {...control} value={String(draft.dayOfMonth)} onValueChange={(value) => set("dayOfMonth", Number(value))} options={DAY_OPTIONS} />}
          </Field>
        ) : (
          <div aria-hidden className="hidden sm:block" />
        )}
        <Field label="Период данных" className="sm:col-span-2">
          {(control) => (
            <Select
              {...control}
              value={draft.periodPreset}
              onValueChange={(value) => set("periodPreset", value as PeriodPreset)}
              options={(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((value) => ({ value, label: PERIOD_LABELS[value] }))}
            />
          )}
        </Field>
      </div>

      {preview ? (
        <p className="text-body-sm text-muted-foreground" aria-live="polite">
          Первый запуск — {formatAlmatyDateTime(preview.first)}, данные за {formatPeriod(preview.period.dateFrom, preview.period.dateTo)}.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Отмена
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Сохранение…" : schedule ? "Сохранить" : "Создать рассылку"}
        </Button>
      </DialogFooter>
    </form>
  )
}

type RecipientsProps = {
  recipients: string[]
  pending: string
  error: string | null
  onPendingChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onBlur: () => void
  onRemove: (email: string) => void
}

/** Email chips: Enter, comma or leaving the field adds the typed addresses; each chip has its own remove button. */
function RecipientsField({ recipients, pending, error, onPendingChange, onKeyDown, onBlur, onRemove }: RecipientsProps) {
  const id = useId()
  const messageId = `${id}-message`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-sm font-medium text-muted-foreground">
        Получатели
      </label>
      <div className={cn("flex min-h-[var(--control-h)] flex-wrap items-center gap-1.5 rounded-control border bg-card px-2 py-1.5", error ? "border-destructive" : "border-input")}>
        {recipients.length ? (
          <ul aria-label="Получатели рассылки" className="contents">
            {recipients.map((email) => (
              <li key={email} className="inline-flex h-7 items-center gap-1 rounded-control border border-border bg-muted pr-0.5 pl-2 text-caption text-foreground">
                {email}
                <button
                  type="button"
                  aria-label={`Убрать ${email}`}
                  onClick={() => onRemove(email)}
                  className={cn("grid size-6 place-items-center rounded-control text-muted-foreground hover:text-foreground", focusRingClass)}
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="off"
          aria-describedby={messageId}
          aria-invalid={error ? true : undefined}
          placeholder={recipients.length ? "" : "name@sandyq.kz"}
          value={pending}
          onChange={(event) => onPendingChange(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className={cn("h-7 min-w-40 flex-1 rounded-control bg-transparent px-1 text-body-sm text-foreground placeholder:text-muted-foreground", focusRingClass)}
        />
      </div>
      <p id={messageId} role={error ? "alert" : undefined} className={cn("text-caption", error ? "text-destructive" : "text-muted-foreground")}>
        {error ?? `Enter или запятая добавляют адрес. До ${MAX_RECIPIENTS} получателей, сейчас ${recipients.length}.`}
      </p>
    </div>
  )
}
