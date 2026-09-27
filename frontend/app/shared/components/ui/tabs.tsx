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


export interface FilterTabItem {
  value: string
  label: React.ReactNode
  count?: number
}

export interface FilterTabsProps {
  value: string
  onValueChange: (value: string) => void
  items: FilterTabItem[]
  /** The one region all tabs filter (a register table); it gets role="tabpanel". */
  panelId: string
  "aria-label": string
  className?: string
}

/**
 * Status tabs that filter one list (registers): same look as Tabs, but every tab controls the same
 * panel, so there are no aria-controls pointing at unmounted panels. Arrows move and select.
 */
export function FilterTabs({ value, onValueChange, items, panelId, className, ...aria }: FilterTabsProps) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])
  const baseId = React.useId()
  const move = (index: number) => {
    const next = (index + items.length) % items.length
    refs.current[next]?.focus()
    onValueChange(items[next].value)
  }
  return (
    <div role="tablist" {...aria} className={cn("flex gap-4 border-b border-border", className)}>
      {items.map((item, index) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            ref={(element) => {
              refs.current[index] = element
            }}
            id={`${baseId}-${item.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") move(index + 1)
              else if (event.key === "ArrowLeft") move(index - 1)
              else if (event.key === "Home") move(0)
              else if (event.key === "End") move(items.length - 1)
              else return
              event.preventDefault()
            }}
            className={cn(
              "-mb-px inline-flex h-11 items-center gap-2 border-b-2 border-transparent px-1 text-body-sm font-medium text-muted-foreground hover:text-foreground aria-selected:border-accent aria-selected:font-semibold aria-selected:text-foreground",
              focusRingClass,
            )}
          >
            {item.label}
            {item.count !== undefined ? <span className="text-muted-foreground tabular-nums">{item.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
