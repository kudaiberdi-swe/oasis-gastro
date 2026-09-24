import { useRef, useState } from "react"

import { Button } from "@/shared/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { cn, focusRingClass, formatTenge } from "@/shared/lib/utils"
import type { PaymentMethod } from "@/shared/types/pos"
import { PAYMENT_METHOD_LABEL, QUICK_CASH_STEPS, roundUpTo } from "../model/order-receipt"

type PaymentRow = { method: PaymentMethod; amount: number; tendered?: number }
// A stable id per row so removing a middle row doesn't shift the next row's inputs (S-22).
type EditableRow = PaymentRow & { id: string }

const newRow = (row: PaymentRow): EditableRow => ({ id: crypto.randomUUID(), ...row })

/** Cash presets that say what they do: exact amount, then the rounded-up banknote totals. */
export function cashPresets(amount: number): Array<{ label: string; tendered: number }> {
  const presets = [{ label: "Без сдачи", tendered: amount }]
  for (const step of QUICK_CASH_STEPS) {
    const tendered = roundUpTo(amount, step)
    if (tendered > amount && !presets.some((preset) => preset.tendered === tendered)) presets.push({ label: formatTenge(tendered), tendered })
  }
  return presets
}

export function PaymentDialog({
  open,
  onOpenChange,
  total,
  submitting,
  error,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  total: number
  submitting: boolean
  error: string | null
  onSubmit: (payments: PaymentRow[]) => void
}) {
  const [rows, setRows] = useState<EditableRow[]>(() => [newRow({ method: "cash", amount: total, tendered: total })])
  const wasOpen = useRef(open)

  // Reset to a single cash row covering the live total each time the dialog opens —
  // `total` can change between order edits and the dialog's prior close.
  if (open && !wasOpen.current) setRows([newRow({ method: "cash", amount: total, tendered: total })])
  wasOpen.current = open

  const allocated = rows.reduce((sum, row) => sum + row.amount, 0)
  const remaining = total - allocated
  const canSubmit = remaining === 0 && rows.every((row) => row.amount > 0 && (row.method !== "cash" || (row.tendered ?? row.amount) >= row.amount))

  function updateRow(index: number, patch: Partial<PaymentRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function setMethod(index: number, method: PaymentMethod) {
    updateRow(index, { method, tendered: method === "cash" ? rows[index].amount : undefined })
  }

  function addRow() {
    if (remaining <= 0) return
    setRows((current) => [...current, newRow({ method: "card", amount: remaining })])
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index))
  }

  function handleClose(next: boolean) {
    if (!next) setRows([])
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display font-semibold">
            Оплата — <span className="tabular-nums text-accent">{formatTenge(total)}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={row.id} className="rounded-[var(--radius-card)] border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex gap-1.5">
                  {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setMethod(index, method)}
                      className={cn("rounded-full px-3 py-1.5 text-xs font-bold", row.method === method ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
                    >
                      {PAYMENT_METHOD_LABEL[method]}
                    </button>
                  ))}
                </div>
                {rows.length > 1 && (
                  <button type="button" onClick={() => removeRow(index)} className="text-xs font-semibold text-muted-foreground">
                    Убрать
                  </button>
                )}
              </div>
              <label className="mb-1 block text-xs text-muted-foreground">Сумма</label>
              <input
                type="number"
                value={row.amount || ""}
                onChange={(event) => updateRow(index, { amount: Math.max(0, Math.round(Number(event.target.value))), tendered: row.method === "cash" ? Math.max(0, Math.round(Number(event.target.value))) : row.tendered })}
                className={cn("h-11 w-full rounded-[var(--radius-control)] border border-border bg-card px-3 text-right text-lg font-bold", focusRingClass)}
              />
              {row.method === "cash" && (
                <>
                  <label className="mb-1 mt-2 block text-xs text-muted-foreground">Получено от гостя</label>
                  <input
                    type="number"
                    value={row.tendered ?? row.amount}
                    onChange={(event) => updateRow(index, { tendered: Math.max(0, Math.round(Number(event.target.value))) })}
                    className={cn("h-11 w-full rounded-[var(--radius-control)] border border-border bg-card px-3 text-right text-lg font-bold", focusRingClass)}
                  />
                  <div className="mt-2 flex gap-1.5">
                    {cashPresets(row.amount).map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => updateRow(index, { tendered: preset.tendered })}
                        className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  {(row.tendered ?? row.amount) > row.amount && (
                    <p className="font-display mt-2 text-sm font-semibold tabular-nums text-success">Сдача: {formatTenge((row.tendered ?? row.amount) - row.amount)}</p>
                  )}
                </>
              )}
            </div>
          ))}
          {remaining !== 0 && (
            <button type="button" onClick={addRow} disabled={remaining <= 0} className="text-sm font-semibold text-primary disabled:text-muted-foreground">
              {remaining > 0 ? `Разделить оплату (осталось ${formatTenge(remaining)})` : "Сумма превышена"}
            </button>
          )}
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
        </div>
        <Button size="lg" disabled={!canSubmit || submitting} onClick={() => onSubmit(rows.map(({ id: _id, ...row }) => row))}>
          {submitting ? "Оплата…" : "Подтвердить оплату"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
