import { useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { Button, ConfirmDialog, StatusPill, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"

import { useFinanceMutations, type FinanceModuleId, type FinanceRecord } from "../data/use-finance-records"
import { formatBusinessDate } from "../model/modules"

/** A titled block of the record card: «Основные реквизиты / Параметры / Проведение и аудит» (OFFICE-DESIGN §3.5). */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-body-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

/** «Проведение и аудит»: number, status, dates and version of a saved record. */
export function RecordAudit({ record, children }: { record: FinanceRecord; children?: ReactNode }) {
  const rows: [string, ReactNode][] = [
    ["Номер", <span className="font-semibold">{record.number}</span>],
    ["Статус", <StatusPill domain="document" status={record.status} />],
    ["Дата записи", formatBusinessDate(record.businessDate)],
    ["Создано", formatAlmatyDateTime(record.createdAt)],
    ["Изменено", formatAlmatyDateTime(record.updatedAt)],
    ...(record.postedAt ? ([["Проведено", formatAlmatyDateTime(record.postedAt)]] as [string, ReactNode][]) : []),
    ...(record.reversedAt ? ([["Сторнировано", formatAlmatyDateTime(record.reversedAt)]] as [string, ReactNode][]) : []),
    ["Версия", `v${record.version}`],
  ]
  return (
    <FormSection title="Проведение и аудит">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-body-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </FormSection>
  )
}

/** Master records: «Отключить» (with confirmation) / «Включить»; hidden without the edit right. */
export function MasterStatusAction({ moduleId, record, disabled }: { moduleId: FinanceModuleId; record: FinanceRecord; disabled?: boolean }) {
  const canEdit = useCan(`office.${moduleId}.edit`)
  const { transition } = useFinanceMutations()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!canEdit) return null
  const active = record.status === "active"

  async function run(action: "activate" | "deactivate") {
    setBusy(true)
    setError(null)
    try {
      await transition({ moduleId, externalId: record.externalId, action, expectedVersion: record.version })
      toast(action === "activate" ? "Запись включена" : "Запись отключена", "success")
      setConfirming(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось изменить статус"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {active ? (
        <Button variant="danger" size="sm" className="self-start" disabled={busy || disabled} onClick={() => setConfirming(true)}>
          Отключить
        </Button>
      ) : (
        <Button variant="secondary" size="sm" className="self-start" disabled={busy || disabled} onClick={() => void run("activate")}>
          Включить
        </Button>
      )}
      {error && !confirming ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Отключить запись?"
        description="Отключённая запись пропадёт из списков выбора в новых документах; история сохранится."
        confirmLabel="Отключить"
        submitting={busy}
        error={error}
        onConfirm={() => run("deactivate")}
      />
    </div>
  )
}
