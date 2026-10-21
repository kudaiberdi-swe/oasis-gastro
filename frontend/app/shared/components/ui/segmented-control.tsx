import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"

import { cn, focusRingClass } from "@/shared/lib/utils"

import { useArrowSelection } from "./use-arrow-selection"

export interface SegmentOption<T extends string> {
  value: T
  label: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: SegmentOption<T>[]
  "aria-label": string
  size?: "md" | "pos"
  className?: string
}

/** Round muted track; the active segment is a raised white pill with foreground text, never primary. */
export function SegmentedControl<T extends string>({ value, onValueChange, options, size = "md", className, ...aria }: SegmentedControlProps<T>) {
  const arrows = useArrowSelection((next) => onValueChange(next as T))
  return (
    <RadioGroupPrimitive.Root
      onKeyDownCapture={arrows.onKeyDownCapture}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      orientation="horizontal"
      className={cn("inline-flex gap-1 rounded-round bg-muted p-1", className)}
      {...aria}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          onFocus={arrows.itemFocus(option.value)}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-2 rounded-round border border-transparent px-4 text-body-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 data-[state=checked]:border-border data-[state=checked]:bg-card data-[state=checked]:font-semibold data-[state=checked]:text-foreground data-[state=checked]:shadow-panel [&_svg]:size-5",
            size === "pos" ? "h-[calc(var(--control-h-pos)-8px)]" : "h-[calc(var(--control-h)-8px)]",
            focusRingClass,
          )}
        >
          {option.icon}
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
}
