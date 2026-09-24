import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn, focusRingClass } from "@/shared/lib/utils"

/** On/off flags in reference-data forms (POS-DESIGN §5). */
const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-round border-2 border-transparent bg-input transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
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
