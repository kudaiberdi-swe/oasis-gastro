import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn, focusRingClass } from "@/shared/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...props }, ref) => <TabsPrimitive.List ref={ref} className={cn("flex gap-4 border-b border-border", className)} {...props} />,
)
TabsList.displayName = "TabsList"

/** 2px --accent underline on the active tab; the count stays muted. */
const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { count?: number }
>(({ className, count, children, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "-mb-px inline-flex h-11 items-center gap-2 border-b-2 border-transparent px-1 text-body-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-foreground",
      focusRingClass,
      className,
    )}
    {...props}
  >
    {children}
    {count !== undefined ? <span className="text-muted-foreground tabular-nums">{count}</span> : null}
  </TabsPrimitive.Trigger>
))
TabsTrigger.displayName = "TabsTrigger"

const TabsContent = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  ({ className, ...props }, ref) => <TabsPrimitive.Content ref={ref} className={cn("pt-4", focusRingClass, className)} {...props} />,
)
TabsContent.displayName = "TabsContent"

export { Tabs, TabsContent, TabsList, TabsTrigger }
