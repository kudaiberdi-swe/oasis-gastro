import { useState, type ReactNode } from "react"

import { Field, Select } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { cn } from "@/shared/lib/utils"

import { useSuggestedCredentials, type UnprovisionedCandidate } from "../data/use-office-workforce"
import { EMPLOYEE_CODE_PATTERN, PIN_PATTERN, ROLE_OPTIONS, type Role } from "../model/modules"
import { EmployeeCodeInput, PinInput, RestaurantsField } from "./credentials"

// POS access for an imported iiko employee (provisionPosAccess), shared by «Сотрудники → Из iiko» (dialog)
// and «Обмен между точками» (inline form, W1-IIKO-07). The code and PIN fields are the L-15 inputs from
// credentials.tsx; the server checks the right, the code uniqueness and the restaurant scope again.

export type ProvisionAccessArgs = { iikoEmployeeExternalId: string; employeeCode: string; pin: string; role: Role; restaurantExternalIds: string[] }
export type Branch = { externalId: string; name: string }

/** State, validation and submit of the provisioning form; code and PIN default to a free suggested pair. */
export function useProvisionAccessForm({ candidate, onProvision }: { candidate: UnprovisionedCandidate | null; onProvision: (args: ProvisionAccessArgs) => Promise<unknown> }) {
  // Suggested only once an employee is chosen, so the inline form opens with empty code and PIN (L-15).
  const suggested = useSuggestedCredentials(candidate !== null)
  const [code, setCode] = useState<string | null>(null)
  const [pin, setPin] = useState<string | null>(null)
  const [role, setRole] = useState<Role>("cashier")
  const [restaurants, setRestaurants] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const effectiveCode = code ?? (candidate ? (suggested?.code ?? "") : "")
  const effectivePin = pin ?? (candidate ? (suggested?.pin ?? "") : "")
  const selected = restaurants ?? candidate?.branches.map((branch) => branch.externalId) ?? []

  function reset() {
    setCode(null)
    setPin(null)
    setRole("cashier")
    setRestaurants(null)
    setError(null)
  }

  /** Resolves to the issued code and PIN (shown once), or null when the check or the server refused. */
  async function submit(): Promise<{ code: string; pin: string } | null> {
    if (!candidate) {
      setError("Выберите сотрудника")
      return null
    }
    if (!EMPLOYEE_CODE_PATTERN.test(effectiveCode)) return fail("Код — от 3 до 12 цифр")
    if (!PIN_PATTERN.test(effectivePin)) return fail("PIN — от 4 до 6 цифр")
    if (selected.length === 0) return fail("Выберите хотя бы один ресторан")
    setSubmitting(true)
    setError(null)
    try {
      await onProvision({ iikoEmployeeExternalId: candidate.externalId, employeeCode: effectiveCode, pin: effectivePin, role, restaurantExternalIds: selected })
      return { code: effectiveCode, pin: effectivePin }
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось выдать доступ"))
      return null
    } finally {
      setSubmitting(false)
    }
  }

  function fail(message: string) {
    setError(message)
    return null
  }

  return { candidate, code: effectiveCode, pin: effectivePin, role, restaurants: selected, error, submitting, setCode, setPin, setRole, setRestaurants, reset, submit }
}

export type ProvisionAccessFormState = ReturnType<typeof useProvisionAccessForm>

const LABELS = {
  dialog: { code: "Код сотрудника", pin: "PIN", role: "Роль" },
  inline: { code: "Код входа", pin: "Новый PIN", role: "Роль POS" },
} as const

/**
 * The fields of the form (the <form autoComplete="off"> and the submit button stay with the caller).
 * `dialog`: code + PIN in a row, role, restaurants. `inline`: one row «Сотрудник · Код входа · Новый PIN · Роль POS».
 */
export function ProvisionAccessFields({
  form,
  branches,
  variant,
  employeeField,
  className,
}: {
  form: ProvisionAccessFormState
  branches: Branch[]
  variant: "dialog" | "inline"
  /** Inline only: the employee picker placed before the code. */
  employeeField?: ReactNode
  className?: string
}) {
  const labels = LABELS[variant]
  const disabled = variant === "inline" && !form.candidate
  const options = [...branches, ...(form.candidate?.branches ?? []).filter((branch) => !branches.some((option) => option.externalId === branch.externalId))]

  const codeField = <Field label={labels.code}>{(control) => <EmployeeCodeInput control={control} disabled={disabled} value={form.code} onValueChange={form.setCode} />}</Field>
  const pinField = (
    <Field label={labels.pin} hint={variant === "inline" ? "4–6 цифр" : undefined}>
      {(control) => <PinInput control={control} disabled={disabled} value={form.pin} onValueChange={form.setPin} />}
    </Field>
  )
  const roleField = <Field label={labels.role}>{(control) => <Select {...control} disabled={disabled} value={form.role} onValueChange={(value) => form.setRole(value as Role)} options={ROLE_OPTIONS} />}</Field>

  if (variant === "dialog") {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <div className="grid grid-cols-2 gap-3">
          {codeField}
          {pinField}
        </div>
        {roleField}
        <RestaurantsField options={options} value={form.restaurants} onValueChange={form.setRestaurants} />
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {employeeField}
        {codeField}
        {pinField}
        {roleField}
      </div>
      {form.candidate ? <RestaurantsField options={options} value={form.restaurants} onValueChange={form.setRestaurants} /> : null}
    </div>
  )
}
