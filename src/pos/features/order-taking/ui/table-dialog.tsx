import { useState, type FormEvent } from "react"
import { Minus, Plus } from "lucide-react"

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

export type TableSeatInput = { tableLabel: string; hallLabel?: string; guestCount?: number }

const MAX_GUESTS = 99

/**
 * Table, hall and guests (replaces window.prompt, W1-POS-10/15). «new» opens a new check at a table;
 * «move» moves the current check — the server refuses a table that already has an open check.
 */
export function TableDialog({
  open,
  onOpenChange,
  mode,
  current,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "new" | "move"
  current?: { tableLabel?: string; hallLabel?: string }
  onSubmit: (seat: TableSeatInput) => Promise<unknown> | void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">{open && <TableForm mode={mode} current={current} onBack={() => onOpenChange(false)} onSubmit={onSubmit} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function TableForm({
  mode,
  current,
  onBack,
  onSubmit,
  onDone,
}: {
  mode: "new" | "move"
  current?: { tableLabel?: string; hallLabel?: string }
  onBack: () => void
  onSubmit: (seat: TableSeatInput) => Promise<unknown> | void
  onDone: () => void
}) {
  const [tableLabel, setTableLabel] = useState("")
  const [hallLabel, setHallLabel] = useState(current?.hallLabel ?? "")
  const [guests, setGuests] = useState<number | null>(mode === "new" ? 1 : null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const moveTarget = tableLabel.trim()
  const unchanged = mode === "move" && moveTarget === (current?.tableLabel ?? "").trim() && hallLabel.trim() === (current?.hallLabel ?? "").trim()
  const blocked = mode === "move" && (!moveTarget || unchanged)

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (blocked || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({ tableLabel: moveTarget, hallLabel: hallLabel.trim() || undefined, guestCount: guests ?? undefined })
      onDone()
    } catch (caught) {
      setError(errorMessage(caught, mode === "move" ? "Не удалось перенести на стол" : "Не удалось открыть стол"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{mode === "new" ? "Новый стол" : "Перенести на стол"}</DialogTitle>
        <DialogDescription>
          {mode === "new" ? "Номер стола можно не указывать — например, для заказа навынос." : `Сейчас: ${current?.tableLabel || "без стола"}. Занятый стол касса не примет.`}
        </DialogDescription>
      </DialogHeader>
      <Field label={mode === "new" ? "Стол (необязательно)" : "Стол"}>
        {(control) => (
          <Input
            {...control}
            autoFocus
            value={tableLabel}
            maxLength={40}
            onChange={(event) => {
              setTableLabel(event.target.value)
              setError(null)
            }}
            placeholder="Например, Стол 7"
            className="h-[var(--control-h-pos)] text-body"
          />
        )}
      </Field>
      <Field label="Зал (необязательно)">
        {(control) => <Input {...control} value={hallLabel} maxLength={40} onChange={(event) => setHallLabel(event.target.value)} placeholder="Например, Терраса" className="h-[var(--control-h-pos)] text-body" />}
      </Field>
      {mode === "new" && (
        <div className="grid gap-1.5">
          <p className="text-body-sm font-medium text-muted-foreground" id="table-guests-label">
            Гостей
          </p>
          <div className="flex items-center gap-2" role="group" aria-labelledby="table-guests-label">
            <Button variant="secondary" size="icon" aria-label="Меньше гостей" onClick={() => setGuests((count) => Math.max(1, (count ?? 1) - 1))} disabled={(guests ?? 1) <= 1}>
              <Minus />
            </Button>
            <span className="w-10 text-center text-title-sm font-semibold tabular-nums" aria-live="polite">
              {guests ?? 1}
            </span>
            <Button variant="secondary" size="icon" aria-label="Больше гостей" onClick={() => setGuests((count) => Math.min(MAX_GUESTS, (count ?? 1) + 1))} disabled={(guests ?? 1) >= MAX_GUESTS}>
              <Plus />
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="secondary" size="lg" onClick={onBack} disabled={submitting}>
          Отмена
        </Button>
        <Button type="submit" size="lg" disabled={blocked || submitting}>
          {submitting ? "Сохранение…" : mode === "new" ? "Открыть стол" : "Перенести"}
        </Button>
      </DialogFooter>
    </form>
  )
}
