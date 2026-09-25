import { Download, Pencil, Play, Trash2 } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { WithErrorBoundary } from "@/office/features/corporation/ui/corporation-parts"
import { Button, ConfirmDialog, DataTable, Switch, TonePill, useToast, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"

import { useReportScheduleActions, useReportSchedules, type ReportSchedule } from "../data/use-report-schedules"
import { describeCadence, describeLastStatus, FORMAT_LABELS, PERIOD_LABELS, scheduleStatus } from "../model/schedules"
import { ScheduleDialog } from "./schedule-dialog"

// «Рассылки отчётов» (/office/report-schedules, W2-RPT-06, OFFICE-DESIGN §3.1): the user's own mailings.
// A schedule is created from the report viewer («Рассылка»); here it is paused, run now, changed or
// deleted, and the last generated file is downloaded. Sending waits for the messaging provider (W3), so
// a finished run says «Файл готов · ждёт отправки». Times are Asia/Almaty.

export const EMPTY_TITLE = "Рассылок пока нет"
export const EMPTY_DESCRIPTION = "Откройте отчёт и нажмите «Рассылка», чтобы создать расписание."

export function ReportSchedulesWorkspace() {
  return <WithErrorBoundary>{() => <ReportSchedulesContent />}</WithErrorBoundary>
}

function ReportSchedulesContent() {
  const canEdit = useCan("office.report-schedules.edit")
  const schedules = useReportSchedules()
  const [editing, setEditing] = useState<ReportSchedule | null>(null)
  const [removing, setRemoving] = useState<ReportSchedule | null>(null)

  const columns: Column<ReportSchedule>[] = [
    {
      key: "name",
      header: "Название",
      sortValue: (row) => row.name,
      cell: (row) => (
        <span className="flex min-w-40 flex-col">
          <span className="font-semibold">{row.name}</span>
          <span className="text-caption text-muted-foreground">
            {describeCadence(row)} · {PERIOD_LABELS[row.periodPreset]}
          </span>
        </span>
      ),
    },
    { key: "report", header: "Отчёт", sortValue: (row) => row.reportTitle, cell: (row) => row.reportTitle },
    { key: "recipients", header: "Получатели", cell: (row) => <Recipients recipients={row.recipients} /> },
    { key: "format", header: "Формат", cell: (row) => FORMAT_LABELS[row.format] },
    {
      key: "next",
      header: "Следующий запуск",
      numeric: true,
      sortValue: (row) => (row.active ? row.nextRunAt : null),
      cell: (row) => (row.active ? formatAlmatyDateTime(row.nextRunAt) : <span className="text-muted-foreground">—</span>),
    },
    { key: "last", header: "Последний запуск", sortValue: (row) => row.lastRunAt ?? null, cell: (row) => <LastRun schedule={row} /> },
    {
      key: "status",
      header: "Статус",
      cell: (row) => {
        const status = scheduleStatus(row.active)
        return <TonePill tone={status.tone}>{status.label}</TonePill>
      },
    },
    {
      key: "actions",
      header: <span className="sr-only">Действия</span>,
      cell: (row) => <RowActions schedule={row} canEdit={canEdit} onEdit={() => setEditing(row)} onRemove={() => setRemoving(row)} />,
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <p className="text-body-sm text-muted-foreground">
        Файлы формируются по расписанию (время — Алматы) с вашими правами на момент запуска. Отправка по email появится с подключением провайдера — пока последний файл можно скачать здесь.
      </p>
      {schedules === undefined ? (
        <OfficeStatePage state={{ kind: "loading" }} />
      ) : schedules.length === 0 ? (
        <OfficeStatePage
          state={{
            kind: "empty",
            title: EMPTY_TITLE,
            description: EMPTY_DESCRIPTION,
            action: (
              <Button asChild variant="secondary">
                <Link to="/office/reports">Открыть каталог отчётов</Link>
              </Button>
            ),
          }}
        />
      ) : (
        <DataTable caption="Рассылки отчётов" columns={columns} rows={schedules} getRowId={(row) => row.externalId} defaultSort={{ key: "next", direction: "asc" }} />
      )}
      {editing ? (
        <ScheduleDialog open onOpenChange={(open) => !open && setEditing(null)} report={{ id: editing.reportId, title: editing.reportTitle }} config={editing.config} schedule={editing} />
      ) : null}
      <RemoveScheduleDialog schedule={removing} onClose={() => setRemoving(null)} />
    </div>
  )
}

function Recipients({ recipients }: { recipients: string[] }) {
  const [first, ...rest] = recipients
  return (
    <span title={recipients.join(", ")} className="block max-w-60 truncate">
      {first}
      {rest.length ? <span className="text-muted-foreground"> и ещё {rest.length}</span> : null}
    </span>
  )
}

function LastRun({ schedule }: { schedule: ReportSchedule }) {
  const status = describeLastStatus(schedule.lastStatus)
  if (!schedule.lastRunAt && !status) return <span className="text-muted-foreground">Ещё не запускалась</span>
  return (
    <span className="flex flex-col items-start gap-1">
      {schedule.lastRunAt ? <span className="whitespace-nowrap tabular-nums">{formatAlmatyDateTime(schedule.lastRunAt)}</span> : null}
      {status ? (
        <span title={schedule.lastStatus}>
          <TonePill tone={status.tone}>{status.label}</TonePill>
        </span>
      ) : null}
    </span>
  )
}

function RowActions({ schedule, canEdit, onEdit, onRemove }: { schedule: ReportSchedule; canEdit: boolean; onEdit: () => void; onRemove: () => void }) {
  const { setActive, runNow } = useReportScheduleActions()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>, success: string, failure: string) {
    setBusy(true)
    try {
      await action()
      toast(success, "success")
    } catch (caught) {
      toast(errorMessage(caught, failure), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit ? (
        <label className="mr-2 inline-flex items-center gap-2 text-caption text-muted-foreground">
          <Switch
            aria-label={`Активна: ${schedule.name}`}
            checked={schedule.active}
            disabled={busy}
            onCheckedChange={(checked) =>
              void run(() => setActive({ externalId: schedule.externalId, active: checked }), checked ? "Рассылка включена" : "Рассылка отключена", "Не удалось изменить рассылку")
            }
          />
          <span aria-hidden>Активна</span>
        </label>
      ) : null}
      {canEdit ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Запустить сейчас: ${schedule.name}`}
          title="Запустить сейчас"
          disabled={busy}
          onClick={() => void run(() => runNow({ externalId: schedule.externalId }), "Рассылка запущена — файл появится через минуту", "Не удалось запустить рассылку")}
        >
          <Play aria-hidden />
        </Button>
      ) : null}
      {schedule.lastFileUrl ? (
        <Button asChild variant="ghost" size="icon-sm" title="Скачать последний">
          <a href={schedule.lastFileUrl} target="_blank" rel="noreferrer" download aria-label={`Скачать последний: ${schedule.name}`}>
            <Download aria-hidden />
          </a>
        </Button>
      ) : null}
      {canEdit ? (
        <Button variant="ghost" size="icon-sm" aria-label={`Изменить: ${schedule.name}`} title="Изменить" disabled={busy} onClick={onEdit}>
          <Pencil aria-hidden />
        </Button>
      ) : null}
      {canEdit ? (
        <Button variant="ghost" size="icon-sm" aria-label={`Удалить: ${schedule.name}`} title="Удалить" disabled={busy} onClick={onRemove}>
          <Trash2 aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}

function RemoveScheduleDialog({ schedule, onClose }: { schedule: ReportSchedule | null; onClose: () => void }) {
  const { remove } = useReportScheduleActions()
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <ConfirmDialog
      open={schedule !== null}
      onOpenChange={(open) => {
        if (!open && !submitting) {
          setError(null)
          onClose()
        }
      }}
      title="Удалить рассылку?"
      description={schedule ? `Рассылка «${schedule.name}» больше не будет запускаться, последний файл тоже удалится. Сам отчёт останется в каталоге.` : undefined}
      confirmLabel="Удалить"
      submitting={submitting}
      error={error}
      onConfirm={async () => {
        if (!schedule) return
        setSubmitting(true)
        try {
          await remove({ externalId: schedule.externalId })
          toast("Рассылка удалена", "success")
          setError(null)
          onClose()
        } catch (caught) {
          setError(errorMessage(caught, "Не удалось удалить рассылку"))
        } finally {
          setSubmitting(false)
        }
      }}
    />
  )
}
