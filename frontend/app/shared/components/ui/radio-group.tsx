import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"

import { cn, focusRingClass } from "@/shared/lib/utils"

import { useArrowSelection } from "./use-arrow-selection"

export interface RadioCardOption {
  value: string
  label: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
}

export interface RadioGroupProps extends Omit<React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>, "children"> {
  options: RadioCardOption[]
}

/** Radio cards: the whole card is the target, arrows move between options. */
export function RadioGroup({ options, className, onValueChange, ...props }: RadioGroupProps) {
  const arrows = useArrowSelection(onValueChange)
  return (
    <RadioGroupPrimitive.Root className={cn("grid gap-2", className)} onValueChange={onValueChange} onKeyDownCapture={arrows.onKeyDownCapture} {...props}>
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          onFocus={arrows.itemFocus(option.value)}
          className={cn(
            "flex min-h-[var(--control-h)] items-start gap-3 rounded-control border border-input bg-card p-3 text-left disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-muted",
            focusRingClass,
          )}
        >
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-round border-2 border-input">
            <RadioGroupPrimitive.Indicator className="size-2.5 rounded-round bg-primary" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-body-sm font-semibold text-foreground">{option.label}</span>
            {option.description ? <span className="text-caption text-muted-foreground">{option.description}</span> : null}
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
}
