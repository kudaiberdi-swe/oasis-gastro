import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn, focusRingClass } from "@/shared/lib/utils"

/**
 * On/off flags in reference-data forms (POS-DESIGN §5): violet when on. `offTone="danger"` turns the off
 * track red where off means a stop (the «В продаже» switch of the stop-list).
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & { offTone?: "neutral" | "danger" }
>(
  ({ className, offTone = "neutral", ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-round border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
        offTone === "danger" ? "bg-destructive" : "bg-input",
        focusRingClass,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 rounded-round bg-card shadow-panel transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  ),
)
Switch.displayName = "Switch"

export { Switch }
