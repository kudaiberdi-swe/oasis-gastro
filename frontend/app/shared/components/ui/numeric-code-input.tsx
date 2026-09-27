import * as React from "react"

import { cn } from "@/shared/lib/utils"

import { inputClass } from "./input"

export interface NumericCodeInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  value: string
  onValueChange: (value: string) => void
  maxLength: number
  /** Masks the digits (PIN). The field is never type="password" so browsers do not offer to save it. */
  secret?: boolean
}

/**
 * Digits-only code or PIN field. `name` must not look like email/password and autocomplete is off,
 * so password managers never capture a cashier PIN.
 */
const NumericCodeInput = React.forwardRef<HTMLInputElement, NumericCodeInputProps>(
  ({ value, onValueChange, maxLength, secret = false, name = "numeric-code", className, style, ...props }, ref) => (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      pattern="\d*"
      autoComplete={secret ? "off" : "one-time-code"}
      name={name}
      maxLength={maxLength}
      value={value}
      onChange={(event) => onValueChange(event.target.value.replace(/\D/g, "").slice(0, maxLength))}
      className={cn(inputClass, "text-center text-title tracking-[0.3em] tabular-nums", className)}
      style={secret ? { ...style, WebkitTextSecurity: "disc" } as React.CSSProperties : style}
      data-1p-ignore
      data-lpignore="true"
      {...props}
    />
  ),
)
NumericCodeInput.displayName = "NumericCodeInput"

export { NumericCodeInput }
