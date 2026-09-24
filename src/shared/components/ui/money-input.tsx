import * as React from "react"

import { cn } from "@/shared/lib/utils"

import { inputClass } from "./input"

const THIN_SPACE = " "

/** "12500" → "12 500" with U+2009 group separators, as the cashier types. */
export function formatMoneyDigits(digits: string) {
  const clean = digits.replace(/\D/g, "").replace(/^0+(?=\d)/, "")
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
}

export function parseMoney(text: string): number | null {
  const digits = text.replace(/\D/g, "")
  return digits ? Number(digits) : null
}

export interface MoneyInputProps extends Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type"> {
  /** Whole tenge; null is an empty field. */
  value: number | null
  onValueChange: (value: number | null) => void
}

/** Right-aligned, tabular figures, "₸" suffix (POS-DESIGN §5 MoneyInput). */
const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(({ value, onValueChange, className, ...props }, ref) => (
  <div className="relative">
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={value === null ? "" : formatMoneyDigits(String(value))}
      onChange={(event) => onValueChange(parseMoney(event.target.value))}
      className={cn(inputClass, "pr-8 text-right tabular-nums", className)}
      {...props}
    />
    <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-body-sm text-muted-foreground">
      ₸
    </span>
  </div>
))
MoneyInput.displayName = "MoneyInput"

export { MoneyInput }
