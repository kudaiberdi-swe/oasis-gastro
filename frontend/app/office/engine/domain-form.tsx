import { useState } from "react"

import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from "@/shared/components/ui"
import { cn } from "@/shared/lib/utils"

import { formatValue } from "./format-value"
import type { DomainField } from "./module-config"

export type FormValues = Record<string, unknown>

/** Required fields and each field's own rule; returns field key → message. */
export function validateFields(fields: DomainField[], values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const value = values[field.key]
    const empty = value === undefined || value === null || value === "" || (typeof value === "number" && Number.isNaN(value))
    if (field.required && empty && field.kind !== "checkbox") {
      errors[field.key] = "Заполните поле"
      continue
    }
    const message = !empty ? field.validate?.(value, values) : null
    if (message) errors[field.key] = message
  }
  return errors
}

export function useDomainForm(fields: DomainField[], initial: FormValues) {
  const [values, setValues] = useState<FormValues>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  return {
    values,
    errors,
    dirty,
    setValue: (key: string, value: unknown) => {
      setValues((current) => ({ ...current, [key]: value }))
      setErrors((current) => {
        const { [key]: _removed, ...rest } = current
        return rest
      })
      setDirty(true)
    },
    reset: (next: FormValues = initial) => {
      setValues(next)
      setErrors({})
      setDirty(false)
    },
    /** Validates; true when the form can be saved. */
    check: () => {
      const next = validateFields(fields, values)
      setErrors(next)
      return Object.keys(next).length === 0
    },
    markSaved: () => setDirty(false),
  }
}

export interface DomainFormProps {
  fields: DomainField[]
  values: FormValues
  errors?: Record<string, string>
  onChange: (key: string, value: unknown) => void
  /** Posted documents: fields become text (L-18). */
  readOnly?: boolean
  columns?: 1 | 2
}

/** Fields generated from `DomainField` definitions, labels above, errors below (POS-DESIGN §5). */
export function DomainForm({ fields, values, errors = {}, onChange, readOnly = false, columns = 2 }: DomainFormProps) {
  return (
    <div className={cn("grid gap-4", columns === 2 && "md:grid-cols-2")}>
      {fields.map((field) => {
        const value = values[field.key]
        const span = field.span === "full" || field.kind === "textarea" ? "md:col-span-2" : undefined
        if (readOnly) {
          const shown =
            field.kind === "select"
              ? (field.options?.find((option) => option.value === value)?.label ?? value)
              : field.kind === "checkbox"
                ? formatValue("boolean", value)
                : field.kind === "money"
                  ? formatValue("money", value)
                  : field.kind === "date"
                    ? formatValue("date", value)
                    : formatValue("text", value)
          return (
            <div key={field.key} className={cn("flex flex-col gap-1.5", span)}>
              <span className="text-body-sm font-medium text-muted-foreground">{field.label}</span>
              <span className="text-body-sm text-foreground">{shown as React.ReactNode}</span>
            </div>
          )
        }
        if (field.kind === "checkbox") {
          return (
            <label key={field.key} className={cn("flex items-center gap-2 text-body-sm", span)}>
              <Checkbox checked={Boolean(value)} onCheckedChange={(checked) => onChange(field.key, checked === true)} />
              {field.label}
            </label>
          )
        }
        return (
          <Field key={field.key} label={field.required ? `${field.label} *` : field.label} hint={field.hint} error={errors[field.key]} className={span}>
            {(control) => {
              switch (field.kind) {
                case "textarea":
                  return <Textarea {...control} value={String(value ?? "")} onChange={(event) => onChange(field.key, event.target.value)} />
                case "money":
                  return <MoneyInput {...control} value={typeof value === "number" ? value : null} onValueChange={(next) => onChange(field.key, next)} />
                case "number":
                  return (
                    <Input
                      {...control}
                      type="number"
                      inputMode="decimal"
                      value={value === undefined || value === null ? "" : String(value)}
                      onChange={(event) => onChange(field.key, event.target.value === "" ? null : Number(event.target.value))}
                      className="text-right tabular-nums"
                    />
                  )
                case "date":
                  return (
                    <Input
                      {...control}
                      type="date"
                      value={typeof value === "number" ? new Date(value).toISOString().slice(0, 10) : ""}
                      onChange={(event) => onChange(field.key, event.target.value ? Date.parse(`${event.target.value}T00:00:00+05:00`) : null)}
                    />
                  )
                case "select":
                  return <Select {...control} value={value ? String(value) : undefined} onValueChange={(next) => onChange(field.key, next)} options={field.options ?? []} />
                default:
                  return <Input {...control} value={String(value ?? "")} onChange={(event) => onChange(field.key, event.target.value)} />
              }
            }}
          </Field>
        )
      })}
    </div>
  )
}
