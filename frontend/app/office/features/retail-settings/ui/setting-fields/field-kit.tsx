import type { ReactNode } from "react"

import { SwitchRow } from "@/office/features/stock/ui/master-list"
import { Combobox, Field, Switch, type ComboboxOption } from "@/shared/components/ui"

import type { SettingErrors } from "../../model/setting-draft"

const NONE = "__none__"

export interface AccountChoices {
  options: ComboboxOption[]
  labelOf: (value: string | undefined) => string | undefined
}

export interface KindFieldsProps<T> {
  data: T
  onChange: (patch: Partial<T>) => void
  errors: SettingErrors
  readOnly: boolean
  accounts: AccountChoices
}

/** A behaviour block of the form: «Поведение оплаты», «Режим обслуживания», … */
export function SettingBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 border-t border-border pt-5">
      <h3 className="text-title-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

/** Flags in two columns with a label and a hint (OFFICE-DESIGN §3.2). */
export function FlagGrid({ children, error }: { children: ReactNode; error?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function Flag({ label, hint, checked, onCheckedChange, disabled }: { label: string; hint?: string; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <SwitchRow label={label} hint={hint}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </SwitchRow>
  )
}

/** Chart-of-accounts picker; `optional` adds «Не указан». A value outside the list keeps its raw label. */
export function AccountField({
  label,
  value,
  onChange,
  accounts,
  error,
  hint,
  optional = false,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  accounts: AccountChoices
  error?: string
  hint?: string
  optional?: boolean
  disabled?: boolean
}) {
  const options = [...(optional ? [{ value: NONE, label: "Не указан" }] : []), ...accounts.options]
  if (value && !options.some((option) => option.value === value)) options.push({ value, label: accounts.labelOf(value) ?? value })
  return (
    <Field label={label} error={error} hint={hint}>
      {(control) => (
        <Combobox
          {...control}
          value={value || (optional ? NONE : undefined)}
          onValueChange={(next) => onChange(next === NONE ? "" : next)}
          options={options}
          placeholder="Выберите счёт"
          searchPlaceholder="Код или название счёта"
          disabled={disabled}
        />
      )}
    </Field>
  )
}
