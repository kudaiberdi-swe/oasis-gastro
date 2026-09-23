import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/shared/lib/utils"

const badgeVariants = cva("inline-flex h-6 items-center justify-center rounded-full px-2.5 text-[11px] font-extrabold tracking-wide whitespace-nowrap", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      secondary: "bg-secondary text-secondary-foreground",
      outline: "border border-border bg-card text-muted-foreground",
      success: "bg-success/12 text-success",
      warning: "bg-warning/14 text-warning-foreground",
    },
  },
  defaultVariants: { variant: "default" },
})

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
