import { useRef, useState } from "react"

import { Button, Chip, Dialog, DialogContent, DialogHeader, DialogTitle, Field, Input, Money, MoneyInput, SegmentedControl } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/utils"
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
          <DialogTitle>
            Оплата — <Money value={total} size="lg" />
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            // The card-radius class also marks a payment row for tests/pos/pos-dialogs.test.tsx.
            <div key={row.id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <SegmentedControl
                  aria-label="Способ оплаты"
                  size="pos"
                  value={row.method}
                  onValueChange={(method) => setMethod(index, method)}
                  options={(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((method) => ({ value: method, label: PAYMENT_METHOD_LABEL[method] }))}
                />
                {rows.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeRow(index)}>
                    Убрать
                  </Button>
                )}
              </div>
              {/* Native number input (role spinbutton) kept for the amount; styled by the Input primitive. */}
              <Field label="Сумма">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    inputMode="numeric"
                    value={row.amount || ""}
                    onChange={(event) => updateRow(index, { amount: Math.max(0, Math.round(Number(event.target.value))), tendered: row.method === "cash" ? Math.max(0, Math.round(Number(event.target.value))) : row.tendered })}
                    className="h-[var(--control-h-pos)] text-right text-body font-semibold tabular-nums"
                  />
                )}
              </Field>
              {row.method === "cash" && (
                <>
                  <Field label="Получено от гостя">
                    {(control) => (
                      <MoneyInput
                        {...control}
                        value={row.tendered ?? row.amount}
                        onValueChange={(value) => updateRow(index, { tendered: Math.max(0, Math.round(value ?? 0)) })}
                        className="h-[var(--control-h-pos)] text-body font-semibold"
                      />
                    )}
                  </Field>
                  <div className="flex flex-wrap gap-1.5">
                    {cashPresets(row.amount).map((preset) => (
                      <Chip key={preset.label} active={(row.tendered ?? row.amount) === preset.tendered} onClick={() => updateRow(index, { tendered: preset.tendered })}>
                        {preset.label}
                      </Chip>
                    ))}
                  </div>
                  {(row.tendered ?? row.amount) > row.amount && (
                    <p className="font-display text-body font-semibold tabular-nums text-success">Сдача: {formatTenge((row.tendered ?? row.amount) - row.amount)}</p>
                  )}
                </>
              )}
            </div>
          ))}
          {remaining !== 0 && (
            <Button variant="link" className="h-auto self-start px-0" onClick={addRow} disabled={remaining <= 0}>
              {remaining > 0 ? `Разделить оплату (осталось ${formatTenge(remaining)})` : "Сумма превышена"}
            </Button>
          )}
          {error && <p className="text-body-sm font-semibold text-destructive">{error}</p>}
        </div>
        <Button size="lg" disabled={!canSubmit || submitting} onClick={() => onSubmit(rows.map(({ id: _id, ...row }) => row))}>
          {submitting ? "Оплата…" : "Подтвердить оплату"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
