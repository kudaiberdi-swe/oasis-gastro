import { useState } from "react"

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity } from "@/shared/lib/format"

import { useGuestMutations, type GuestAccount, type GuestCard, type LoyaltyProgram } from "../data/use-office-loyalty"

/** Programs a correction can go to: the guest's accounts first, then published programs without one. */
export function adjustablePrograms(accounts: GuestAccount[], programs: LoyaltyProgram[] | undefined) {
  const name = (externalId: string) => programs?.find((program) => program.externalId === externalId)?.name ?? externalId
  const options = accounts.map((account) => ({
    value: account.programExternalId,
    label: `${name(account.programExternalId)} · ${formatQuantity(account.balance)} б.`,
  }))
  for (const program of programs ?? []) {
    if (program.status === "published" && !options.some((option) => option.value === program.externalId))
      options.push({
        value: program.externalId,
        label: `${program.name} · новый счёт`,
      })
  }
  return options
}

/** Parses «+100», «−50», «-50»; null unless a non-zero whole number. */
export function parseAdjustment(value: string): number | null {
  const clean = value.replace(/\s/g, "").replace("−", "-").replace(/^\+/, "")
  if (!/^-?\d+$/.test(clean)) return null
  const amount = Number(clean)
  return amount === 0 ? null : amount
}

/** «Корректировка» of a program account (adjustBalance, office.loyalty-programs.approve): ± whole points and a reason. */
export function BalanceAdjustDialog({ open, onOpenChange, card, programs }: { open: boolean; onOpenChange: (open: boolean) => void; card: GuestCard; programs: LoyaltyProgram[] | undefined }) {
  const options = adjustablePrograms(card.accounts, programs)
  const { adjustBalance } = useGuestMutations()
  const toast = useToast()
  const [program, setProgram] = useState<string | undefined>(options[0]?.value)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<{
    program?: string
    amount?: string
    reason?: string
  }>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = program ?? options[0]?.value

  function close() {
    setAmount("")
    setReason("")
    setErrors({})
    setError(null)
    onOpenChange(false)
  }

  async function apply() {
    const points = parseAdjustment(amount)
    const found = {
      ...(!selected ? { program: "Выберите программу" } : {}),
      ...(points === null ? { amount: "Ненулевое целое число, например +100 или −50" } : {}),
      ...(reason.trim().length < 3 ? { reason: "Укажите причину корректировки" } : {}),
    }
    setErrors(found)
    if (Object.keys(found).length || points === null || !selected) return
    setBusy(true)
    setError(null)
    try {
      const result = await adjustBalance({
        guestId: card.guest._id,
        programExternalId: selected,
        amount: points,
        reason: reason.trim(),
      })
      toast(`Баланс: ${formatQuantity(result.balance)} б.`, "success")
      close()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось скорректировать баланс"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Корректировка баланса</DialogTitle>
          <DialogDescription>Изменение записывается в историю гостя и в аудит. Баланс не может стать отрицательным.</DialogDescription>
        </DialogHeader>
        {options.length ? (
          <Field label="Программа" error={errors.program}>
            {(control) => <Select {...control} value={selected} onValueChange={setProgram} options={options} />}
          </Field>
        ) : (
          <p className="text-body-sm text-muted-foreground">Нет опубликованных программ — корректировать нечего.</p>
        )}
        <Field label="Баллы (± целое число)" error={errors.amount}>
          {(control) => <Input {...control} inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="+100" autoComplete="off" />}
        </Field>
        <Field label="Причина" error={errors.reason}>
          {(control) => <Input {...control} value={reason} onChange={(event) => setReason(event.target.value)} autoComplete="off" />}
        </Field>
        {error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void apply()} disabled={busy || !options.length}>
            {busy ? "Сохранение…" : "Применить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
