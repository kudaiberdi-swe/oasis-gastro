import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/shared/lib/utils"

import { inputClass } from "./input"

export interface SelectOption {
  value: string
  label: React.ReactNode
  /** A caption after the label, e.g. the code of a restaurant whose name repeats in the list. */
  hint?: string
  disabled?: boolean
}

export interface SelectProps {
  value: string | undefined
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  id?: string
  className?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
  "aria-label"?: string
}

/** Single choice from a short list; for search or many values use Combobox. */
export function Select({ value, onValueChange, options, placeholder = "Выберите", disabled, id, className, ...aria }: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger id={id} className={cn(inputClass, "flex items-center justify-between gap-2 text-left data-[placeholder]:text-muted-foreground", className)} {...aria}>
        <SelectPrimitive.Value className="min-w-0 truncate" placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(var(--radix-select-content-available-height),320px)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-card border border-border bg-popover text-popover-foreground shadow-float"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex h-[var(--control-h)] cursor-default select-none items-center rounded-control pr-3 pl-8 text-body-sm focus-visible:outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 flex items-center">
                  <Check className="size-4 text-primary" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>
                  {option.label}
                  {option.hint ? <span className="ml-2 text-caption text-muted-foreground">{option.hint}</span> : null}
                </SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
