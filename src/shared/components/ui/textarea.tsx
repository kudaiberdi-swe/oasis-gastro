import * as React from "react"

import { cn } from "@/shared/lib/utils"

import { inputClass } from "./input"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(({ className, rows = 3, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={cn(inputClass, "h-auto min-h-20 py-2", className)} {...props} />
))
Textarea.displayName = "Textarea"

export { Textarea }
