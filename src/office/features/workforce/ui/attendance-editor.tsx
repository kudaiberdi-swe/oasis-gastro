import { ArrowLeft } from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { usePlatformScope } from "@/office/features/platform/data/use-platform"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, Combobox, ConfirmDialog, EmptyState, Field, Input, Select, StatusPill, Textarea, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatHours } from "@/shared/lib/format"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useAttendanceMutations, useAttendanceRecord, usePosEmployees, type AttendanceAction, type AttendanceRecord } from "../data/use-office-workforce"
import {
  ATTENDANCE_SOURCE_LABEL,
  ATTENDANCE_TYPE_LABEL,
  ATTENDANCE_TYPE_OPTIONS,
  attendanceArgs,
  attendanceDraftOf,
  draftHours,
  formatBusinessDate,
  formatDeviation,
  isEditableStatus,
  needsCorrectionReason,
  validateAttendance,
  type AttendanceDraft,
  type AttendanceErrors,
  type AttendanceType,
} from "../model/modules"

/** /office/attendance/:id — a record of the attendance log (Editor §3.4); null creates a manual record. */
export function AttendanceEditor({ externalId }: { externalId: string | null }) {
  const record = useAttendanceRecord(externalId)
  const navigate = useNavigate()
  const back = () => navigate("/office/attendance")

  if (externalId && record === undefined) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  if (externalId && !record) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <EmptyState
          title="Запись не найдена"
          description="Возможно, она относится к ресторану вне вашего доступа или ссылка устарела."
          action={
            <Button variant="secondary" onClick={back}>
              <ArrowLeft aria-hidden />К списку
            </Button>
          }
        />
      </div>
    )
  }
  // A transition (submit, approve, cancel) or a correction changes the status and re-reads the record.
  return <AttendanceForm key={record ? `${record.externalId}:${record.status}` : "new"} record={record ?? null} onBack={back} />
}

const ACTION_DONE: Record<AttendanceAction, string> = { submit: "Отправлено на согласование", approve: "Явка согласована", cancel: "Запись отменена" }

function AttendanceForm({ record, onBack }: { record: AttendanceRecord | null; onBack: () => void }) {
  const canEdit = useCan("office.attendance.edit")
  const canApprove = useCan("office.attendance.post")
  const canCancel = useCan("office.attendance.cancel")
  const scope = usePlatformScope()
  const { save, transition } = useAttendanceMutations()
  const navigate = useNavigate()
  const toast = useToast()

  const defaultRestaurant = scope.restaurants.length === 1 ? scope.restaurants[0].externalId : undefined
  const [baseline, setBaseline] = useState<AttendanceDraft>(() => attendanceDraftOf(record, { restaurantExternalId: defaultRestaurant }))
  const [draft, setDraft] = useState<AttendanceDraft>(baseline)
  const [errors, setErrors] = useState<AttendanceErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | AttendanceAction | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const editable = canEdit && (record ? isEditableStatus(record.status) : true)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])
  const blocker = useUnsavedChanges(dirty && editable)
  const set = (patch: Partial<AttendanceDraft>) => setDraft((current) => ({ ...current, ...patch }))

  // The restaurants load after the first render: preselect the only one.
  useEffect(() => {
    if (!record && defaultRestaurant && !draft.restaurantExternalId) {
      setDraft((current) => ({ ...current, restaurantExternalId: defaultRestaurant }))
      setBaseline((current) => ({ ...current, restaurantExternalId: defaultRestaurant }))
    }
  }, [record, defaultRestaurant, draft.restaurantExternalId])

  // Navigate once the saved draft is the baseline, so the unsaved-changes guard does not stop it.
  useEffect(() => {
    if (createdId) navigate(`/office/attendance/${encodeURIComponent(createdId)}`, { replace: true })
  }, [createdId, navigate])

  const status = record?.status
  const reasonNeeded = needsCorrectionReason(record, draft)
  const hours = draftHours(draft)
  const primary: "submit" | "approve" | "save" = status === "draft" && canEdit ? "submit" : status === "pending-approval" && canApprove ? "approve" : "save"

  async function persist() {
    const found = validateAttendance(record, draft)
    setErrors(found)
    if (Object.keys(found).length > 0) return null
    const externalId = await save(attendanceArgs(record, draft))
    setBaseline(draft)
    return externalId
  }

  async function handleSave() {
    if (!editable || busy) return
    setBusy("save")
    setError(null)
    try {
      const externalId = await persist()
      if (externalId === null) return
      toast(record ? "Корректировка сохранена" : "Запись создана", "success")
      if (!record) setCreatedId(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить запись"))
    } finally {
      setBusy(null)
    }
  }

  async function run(action: AttendanceAction) {
    if (!record || busy) return
    setBusy(action)
    setError(null)
    try {
      if (action === "submit" && dirty) {
        const saved = await persist()
        if (saved === null) return
      }
      await transition({ externalId: record.externalId, action })
      setCancelling(false)
      toast(ACTION_DONE[action], "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось выполнить действие"))
    } finally {
      setBusy(null)
    }
  }

  const restaurantOptions = restaurantSelectOptions(scope.restaurants)
  const restaurantName = scope.restaurantName(draft.restaurantExternalId) ?? draft.restaurantExternalId
  const title = record ? `Явка ${record.number}` : "Новая запись явки"
  const meta = record ? [record.employeeName, restaurantName, ATTENDANCE_SOURCE_LABEL[record.source]].filter(Boolean).join(" · ") : "Ручная запись офиса — уходит на согласование"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title font-semibold">{title}</h2>
              {status ? <StatusPill domain="document" status={status} /> : null}
            </div>
            <p className="text-body-sm text-muted-foreground">{meta}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editable ? <SaveStatus state={busy === "save" ? "saving" : dirty ? "dirty" : "clean"} /> : null}
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft aria-hidden />К списку
            </Button>
            {editable ? (
              <Button variant={primary === "save" ? "primary" : "secondary"} onClick={() => void handleSave()} disabled={!dirty || busy !== null}>
                {busy === "save" ? "Сохранение…" : "Сохранить"}
              </Button>
            ) : null}
            {record && primary === "submit" ? (
              <Button onClick={() => void run("submit")} disabled={busy !== null}>
                {busy === "submit" ? "Отправка…" : "Отправить на согласование"}
              </Button>
            ) : null}
            {record && primary === "approve" ? (
              <Button onClick={() => void run("approve")} disabled={busy !== null || dirty}>
                {busy === "approve" ? "Согласование…" : "Согласовать"}
              </Button>
            ) : null}
            {record && (status === "draft" || status === "pending-approval") && canCancel ? (
              <Button variant="danger" onClick={() => setCancelling(true)} disabled={busy !== null}>
                Отменить запись
              </Button>
            ) : null}
          </div>
        </header>

        <StatusBanner record={record} />
        {primary === "approve" && dirty ? (
          <Banner tone="warning" title="Есть несохранённые изменения">
            Сохранённая корректировка вернёт запись в черновик — согласовать можно только сохранённую запись.
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="danger" title="Не удалось выполнить действие">
            {error}
          </Banner>
        ) : null}

        <section aria-label="Реквизиты" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
          <h3 className="text-title-sm font-semibold">Реквизиты</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {record ? <ReadOnlyField label="Номер" value={record.number} /> : null}
            {record ? <ReadOnlyField label="Дата" value={formatBusinessDate(record.businessDate)} /> : null}
            {record ? (
              <ReadOnlyField label="Ресторан" value={restaurantName} />
            ) : (
              <Field label="Ресторан" error={errors.restaurant}>
                {(control) => <Select {...control} value={draft.restaurantExternalId || undefined} onValueChange={(restaurantExternalId) => set({ restaurantExternalId, employeeId: "" })} options={restaurantOptions} placeholder="Выберите ресторан" />}
              </Field>
            )}
            {record ? <ReadOnlyField label="Сотрудник" value={`${record.employeeName} · код ${record.employeeCode}`} /> : <EmployeePicker draft={draft} error={errors.employee} onChange={(employeeId) => set({ employeeId })} />}
            {editable ? (
              <Field label="Приход" error={errors.clockIn} hint="Время Алматы">
                {(control) => <Input {...control} type="datetime-local" value={draft.clockIn} onChange={(event) => set({ clockIn: event.target.value })} />}
              </Field>
            ) : (
              <ReadOnlyField label="Приход" value={record ? formatAlmatyDateTime(record.clockIn) : "—"} />
            )}
            {editable ? (
              <Field label="Уход" error={errors.clockOut} hint="Пусто — сотрудник ещё на работе">
                {(control) => <Input {...control} type="datetime-local" value={draft.clockOut} onChange={(event) => set({ clockOut: event.target.value })} />}
              </Field>
            ) : (
              <ReadOnlyField label="Уход" value={record?.clockOut !== undefined ? formatAlmatyDateTime(record.clockOut) : "—"} />
            )}
            {editable ? (
              <Field label="Перерыв, мин" error={errors.breakMinutes}>
                {(control) => <Input {...control} inputMode="numeric" autoComplete="off" value={draft.breakMinutes} onChange={(event) => set({ breakMinutes: event.target.value.replace(/\D/g, "").slice(0, 3) })} />}
              </Field>
            ) : (
              <ReadOnlyField label="Перерыв" value={`${record?.breakMinutes ?? 0} мин`} />
            )}
            {editable ? (
              <Field label="Тип явки">
                {(control) => <Select {...control} value={draft.attendanceType} onValueChange={(value) => set({ attendanceType: value as AttendanceType })} options={ATTENDANCE_TYPE_OPTIONS} />}
              </Field>
            ) : (
              <ReadOnlyField label="Тип явки" value={record ? ATTENDANCE_TYPE_LABEL[record.attendanceType] : "—"} />
            )}
            <ReadOnlyField label="Часы" value={editable ? (hours === null ? "—" : formatHours(hours)) : record?.hours !== undefined ? formatHours(record.hours) : "—"} />
            <ReadOnlyField label="Отклонение" value={formatDeviation(record?.deviationMinutes) ?? <span className="text-muted-foreground">— появится с графиком смен</span>} />
            {editable ? (
              <Field
                label="Причина корректировки"
                className="md:col-span-2"
                error={errors.correctionReason}
                hint={reasonNeeded ? "Обязательна: изменено время записи с кассы" : "Обязательна, если меняется время записи с кассы"}
              >
                {(control) => <Textarea {...control} value={draft.correctionReason} onChange={(event) => set({ correctionReason: event.target.value })} />}
              </Field>
            ) : (
              <ReadOnlyField label="Причина корректировки" value={record?.correctionReason || "—"} className="md:col-span-2" />
            )}
          </div>
        </section>

        {record && record.source !== "office" ? <PosOriginal record={record} /> : null}
      </div>

      {editable ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-panel xl:px-8">
          <p className="text-caption text-muted-foreground">В табель идут согласованные и закрытые на кассе записи. Корректировка возвращает запись в черновик.</p>
          <Button variant="secondary" onClick={() => setDraft(baseline)} disabled={!dirty || busy !== null}>
            Отменить изменения
          </Button>
        </footer>
      ) : null}

      {record ? (
        <ConfirmDialog
          open={cancelling}
          onOpenChange={setCancelling}
          title={`Отменить запись ${record.number}?`}
          description="Отменённая запись не попадёт в табель и зарплату. Действие необратимо."
          confirmLabel="Отменить запись"
          cancelLabel="Не отменять"
          submitting={busy === "cancel"}
          error={cancelling ? error : null}
          onConfirm={() => run("cancel")}
        />
      ) : null}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

function StatusBanner({ record }: { record: AttendanceRecord | null }) {
  switch (record?.status) {
    case "active":
      return (
        <Banner tone="info" title="Сотрудник на смене">
          Запись закроется при отметке ухода на кассе или закрытии смены. Изменить её можно после закрытия.
        </Banner>
      )
    case "completed":
      return (
        <Banner tone="info" title="Закрыта на кассе">
          Запись уже идёт в табель. После корректировки она вернётся в черновик и потребует согласования.
        </Banner>
      )
    case "approved":
      return (
        <Banner tone="info" title="Явка согласована — только чтение">
          Согласованная запись идёт в табель и зарплату.
        </Banner>
      )
    case "cancelled":
      return (
        <Banner tone="warning" title="Запись отменена">
          Отменённая запись не учитывается в табеле.
        </Banner>
      )
    default:
      return null
  }
}

/** «Исходные данные POS» — what the cashier or the shift recorded, read-only; `original` appears after a correction. */
function PosOriginal({ record }: { record: AttendanceRecord }) {
  const original = record.original ?? { clockIn: record.clockIn, clockOut: record.clockOut }
  return (
    <section aria-label="Исходные данные POS" className="flex flex-col gap-4 rounded-card border border-border bg-muted p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-title-sm font-semibold">Исходные данные POS</h3>
        <p className="text-caption text-muted-foreground">{record.original ? "Время, отмеченное на кассе до корректировки офиса." : "Время не корректировалось."}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <ReadOnlyField label="Источник" value={ATTENDANCE_SOURCE_LABEL[record.source]} />
        <ReadOnlyField label="Приход" value={formatAlmatyDateTime(original.clockIn)} />
        <ReadOnlyField label="Уход" value={original.clockOut !== undefined ? formatAlmatyDateTime(original.clockOut) : "—"} />
      </div>
    </section>
  )
}

function EmployeePicker({ draft, error, onChange }: { draft: AttendanceDraft; error?: string; onChange: (employeeId: string) => void }) {
  const { employees } = usePosEmployees()
  const options = employees
    .filter((employee) => employee.active && employee.restaurants.some((restaurant) => restaurant.externalId === draft.restaurantExternalId))
    .map((employee) => ({ value: employee._id, label: employee.displayName, hint: `код ${employee.code}` }))
  return (
    <Field label="Сотрудник" error={error} hint={draft.restaurantExternalId ? undefined : "Сначала выберите ресторан"}>
      {(control) => (
        <Combobox
          {...control}
          value={draft.employeeId || undefined}
          onValueChange={onChange}
          options={options}
          disabled={!draft.restaurantExternalId}
          placeholder="Выберите сотрудника"
          searchPlaceholder="ФИО или код"
          emptyText="В этом ресторане нет активных сотрудников"
        />
      )}
    </Field>
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
