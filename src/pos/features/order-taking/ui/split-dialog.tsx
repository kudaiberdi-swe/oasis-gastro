import { useState } from "react"
import { Minus, Plus } from "lucide-react"

import { lineDetails, lineTotal, type OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Money } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

export type SplitRow = { clientLineId: string; quantity: number }

/** Why the split cannot be sent, or null: something must move and something must stay. */
export function splitProblem(lines: OrderDraftLine[], moving: Record<string, number>) {
  const moved = lines.reduce((sum, line) => sum + (moving[line.clientLineId] ?? 0), 0)
  if (moved === 0) return "Выберите порции для нового чека"
  const total = lines.reduce((sum, line) => sum + line.quantity, 0)
  if (moved >= total) return "В этом чеке должна остаться хотя бы одна порция"
  return null
}

/**
 * «Разделить чек» (W1-POS-05/15): portions chosen here go to a new held check at the same table
 * («Стол 7 /2»); lines already on the kitchen ticket keep their ticket.
 */
export function SplitDialog({
  open,
  onOpenChange,
  lines,
  onSplit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Active, saved lines of the check. */
  lines: OrderDraftLine[]
  onSplit: (rows: SplitRow[]) => Promise<unknown>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">{open && <SplitForm lines={lines} onBack={() => onOpenChange(false)} onSplit={onSplit} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function SplitForm({ lines, onBack, onSplit, onDone }: { lines: OrderDraftLine[]; onBack: () => void; onSplit: (rows: SplitRow[]) => Promise<unknown>; onDone: () => void }) {
  const [moving, setMoving] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const problem = splitProblem(lines, moving)
  const movedAmount = lines.reduce((sum, line) => sum + Math.round((lineTotal(line) / line.quantity) * (moving[line.clientLineId] ?? 0)), 0)

  function change(line: OrderDraftLine, delta: number) {
    setError(null)
    setMoving((current) => ({ ...current, [line.clientLineId]: Math.min(line.quantity, Math.max(0, (current[line.clientLineId] ?? 0) + delta)) }))
  }

  async function submit() {
    if (problem || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSplit(Object.entries(moving).filter(([, quantity]) => quantity > 0).map(([clientLineId, quantity]) => ({ clientLineId, quantity })))
      onDone()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось разделить чек"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Разделить чек</DialogTitle>
        <DialogDescription>Выберите, сколько порций перенести в новый отложенный чек. Остальное останется в этом.</DialogDescription>
      </DialogHeader>
      <ul className="flex max-h-[50vh] flex-col divide-y divide-border overflow-y-auto rounded-card border border-border" aria-label="Позиции для нового чека">
        {lines.map((line) => {
          const count = moving[line.clientLineId] ?? 0
          return (
            <li key={line.clientLineId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold">{line.name}</span>
                <span className="block text-body-sm text-muted-foreground">{[`в чеке ${line.quantity}`, lineDetails(line)].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="flex items-center gap-1">
                <Button variant="secondary" size="icon" aria-label={`Меньше в новый чек: ${line.name}`} onClick={() => change(line, -1)} disabled={count === 0}>
                  <Minus />
                </Button>
                <span className="w-8 text-center text-body font-semibold tabular-nums" aria-label={`В новый чек: ${line.name}`}>
                  {count}
                </span>
                <Button variant="secondary" size="icon" aria-label={`Больше в новый чек: ${line.name}`} onClick={() => change(line, 1)} disabled={count >= line.quantity}>
                  <Plus />
                </Button>
              </span>
            </li>
          )
        })}
      </ul>
      <div className="flex items-baseline justify-between">
        <span className="text-body-sm text-muted-foreground">В новый чек, без скидки и сбора</span>
        <Money value={movedAmount} />
      </div>
      {error && (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="secondary" size="lg" onClick={onBack} disabled={submitting}>
          Назад
        </Button>
        <Button size="lg" onClick={submit} disabled={Boolean(problem) || submitting} title={problem ?? undefined}>
          {submitting ? "Разделение…" : "Разделить"}
        </Button>
      </DialogFooter>
    </>
  )
}
