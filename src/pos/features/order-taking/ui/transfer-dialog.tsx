import { useState } from "react"

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, RadioGroup } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

export type TransferTarget = { terminalId: string; name: string; terminalNumber: number; shiftNumber: number }

/**
 * «Перенести на кассу» (W1-POS-05/15): a held check moves to another terminal of the restaurant with
 * an open shift; the manager PIN confirms it. An open check is put on hold first.
 */
export function TransferDialog({
  open,
  onOpenChange,
  targets,
  orderNumber,
  onTransfer,
  onManagerRequired,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** undefined while loading. */
  targets: TransferTarget[] | undefined
  orderNumber?: number
  onTransfer: (input: { targetTerminalId: string; reason: string; managerApprovalToken: string }) => Promise<unknown>
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {open && <TransferForm targets={targets} orderNumber={orderNumber} onBack={() => onOpenChange(false)} onTransfer={onTransfer} onDone={() => onOpenChange(false)} onManagerRequired={onManagerRequired} />}
      </DialogContent>
    </Dialog>
  )
}

function TransferForm({
  targets,
  orderNumber,
  onBack,
  onTransfer,
  onDone,
  onManagerRequired,
}: {
  targets: TransferTarget[] | undefined
  orderNumber?: number
  onBack: () => void
  onTransfer: (input: { targetTerminalId: string; reason: string; managerApprovalToken: string }) => Promise<unknown>
  onDone: () => void
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  const [targetId, setTargetId] = useState<string | undefined>(targets?.length === 1 ? targets[0].terminalId : undefined)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const target = targets?.find((candidate) => candidate.terminalId === targetId)

  async function submit() {
    if (!target || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const token = await onManagerRequired(`Перенос заказа${orderNumber !== undefined ? ` №${orderNumber}` : ""} на «${target.name}» требует подтверждения менеджера`)
      if (!token) return
      await onTransfer({ targetTerminalId: target.terminalId, reason: reason.trim() || "Перенос на другую кассу", managerApprovalToken: token })
      onDone()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось перенести заказ"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Перенести на кассу</DialogTitle>
        <DialogDescription>Чек будет отложен и появится среди открытых чеков выбранной кассы.</DialogDescription>
      </DialogHeader>
      {targets === undefined ? (
        <p className="text-body-sm text-muted-foreground">Загрузка касс…</p>
      ) : targets.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">Нет других касс этого ресторана с открытой сменой.</p>
      ) : (
        <div className="grid gap-1.5">
          <p id="transfer-target-label" className="text-body-sm font-medium text-muted-foreground">
            Касса
          </p>
          <RadioGroup
            aria-labelledby="transfer-target-label"
            value={targetId}
            onValueChange={(value) => {
              setTargetId(value)
              setError(null)
            }}
            options={targets.map((candidate) => ({ value: candidate.terminalId, label: candidate.name, description: `Касса ${candidate.terminalNumber} · смена №${candidate.shiftNumber}` }))}
          />
        </div>
      )}
      <Field label="Причина">
        {(control) => <Input {...control} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Например, гость пересел в другой зал" className="h-[var(--control-h-pos)] text-body" />}
      </Field>
      {error && (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="secondary" size="lg" onClick={onBack} disabled={submitting}>
          Назад
        </Button>
        <Button size="lg" onClick={submit} disabled={!target || submitting}>
          {submitting ? "Перенос…" : "Перенести"}
        </Button>
      </DialogFooter>
    </>
  )
}
