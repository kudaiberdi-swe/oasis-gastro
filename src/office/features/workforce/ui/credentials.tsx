import { useState } from "react"

import { Banner, Button, Combobox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, NumericCodeInput } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { useSuggestedCredentials, type EmployeeId } from "../data/use-office-workforce"
import { PIN_PATTERN } from "../model/modules"

// Code and PIN fields for the office (L-15): text inputs with inputmode="numeric", autocomplete="off" and
// names that do not look like a login, so the browser never offers the office e-mail or password here.

type Control = { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }

export function EmployeeCodeInput({ control, value, onValueChange }: { control: Control; value: string; onValueChange: (value: string) => void }) {
  return <NumericCodeInput {...control} name="pos-employee-code" autoComplete="off" value={value} onValueChange={onValueChange} maxLength={12} required />
}

export function PinInput({ control, value, onValueChange }: { control: Control; value: string; onValueChange: (value: string) => void }) {
  return <NumericCodeInput {...control} name="pos-employee-pin" autoComplete="off" value={value} onValueChange={onValueChange} maxLength={6} required />
}

/** Restaurants as removable chips (OFFICE-DESIGN §3.2), not a column of checkboxes. */
export function RestaurantsField({
  options,
  value,
  onValueChange,
  error,
}: {
  options: { externalId: string; name: string }[]
  value: string[]
  onValueChange: (value: string[]) => void
  error?: string
}) {
  const choices = options.map((option) => ({ value: option.externalId, label: option.name }))
  for (const externalId of value) if (!choices.some((choice) => choice.value === externalId)) choices.push({ value: externalId, label: externalId })
  return (
    <Field label="Рестораны" error={error} hint="Сотрудник входит на кассы этих ресторанов">
      {(control) => <Combobox {...control} multiple value={value} onValueChange={onValueChange} options={choices} placeholder="Выберите рестораны" searchPlaceholder="Название ресторана" />}
    </Field>
  )
}

export function CredentialValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-caption font-medium text-muted-foreground">{label}</p>
      <p className="font-display text-display font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

/** Shown once after provisioning, creating or a PIN reset; the PIN is stored only as a hash. */
export function CredentialsResult({ title, code, pin, onClose, secondary }: { title: string; code?: string; pin: string; onClose: () => void; secondary?: React.ReactNode }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Сообщите сотруднику эти данные один раз — они больше нигде не показываются.</DialogDescription>
      </DialogHeader>
      <div className="flex gap-6 rounded-card border border-border bg-muted p-4">
        {code ? <CredentialValue label="Код" value={code} /> : null}
        <CredentialValue label="PIN" value={pin} />
      </div>
      <DialogFooter>
        {secondary}
        <Button onClick={onClose}>Готово</Button>
      </DialogFooter>
    </>
  )
}

export function ResetPinDialog({
  employee,
  onClose,
  onReset,
}: {
  employee: { _id: EmployeeId; displayName: string }
  onClose: () => void
  onReset: (args: { employeeId: EmployeeId; pin: string }) => Promise<unknown>
}) {
  const suggested = useSuggestedCredentials(true)
  const [pin, setPin] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const effectivePin = pin ?? suggested?.pin ?? ""

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!PIN_PATTERN.test(effectivePin)) {
      setError("PIN — от 4 до 6 цифр")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onReset({ employeeId: employee._id, pin: effectivePin })
      setResult(effectivePin)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сбросить PIN"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        {result ? (
          <CredentialsResult title={`Новый PIN: ${employee.displayName}`} pin={result} onClose={onClose} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Сбросить PIN: {employee.displayName}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} autoComplete="off" className="flex flex-col gap-4">
              <Field label="Новый PIN" hint="4–6 цифр; предложен случайный">
                {(control) => <PinInput control={control} value={effectivePin} onValueChange={setPin} />}
              </Field>
              {error ? <Banner tone="danger" title={error} /> : null}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={onClose}>
                  Отмена
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Сохранение…" : "Сбросить PIN"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
