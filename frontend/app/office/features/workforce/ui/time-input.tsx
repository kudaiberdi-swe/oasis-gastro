import * as React from "react"

import { Input } from "@/shared/components/ui"

export interface TimeInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  /** "ЧЧ:ММ"; the caller converts it to a minute of the day (model/w2.ts timeToMinute). */
  value: string
  onValueChange: (value: string) => void
}

/** Time of day ЧЧ:ММ (24 h) instead of «минута дня» (W2-HR-03). */
export const TimeInput = React.forwardRef<HTMLInputElement, TimeInputProps>(({ value, onValueChange, className, ...props }, ref) => (
  <Input ref={ref} type="time" step={60} value={value} onChange={(event) => onValueChange(event.target.value)} className={className ?? "tabular-nums"} autoComplete="off" {...props} />
))
TimeInput.displayName = "TimeInput"
