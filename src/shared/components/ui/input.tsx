import * as React from "react"

import { cn, focusRingClass } from "@/shared/lib/utils"

// POS-DESIGN §5 Input: height --control-h, card background, --input border, 2px radius, --ring focus.
export const inputClass = cn(
  "h-[var(--control-h)] w-full min-w-0 rounded-control border border-input bg-card px-3 text-body-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&:is(input,textarea):read-only]:bg-muted",
  focusRingClass,
)

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, type = "text", ...props }, ref) => (
  <input ref={ref} type={type} className={cn(inputClass, className)} {...props} />
))
Input.displayName = "Input"

export { Input }
