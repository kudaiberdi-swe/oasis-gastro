import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn, focusRingClass } from "@/shared/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...props }, ref) => <TabsPrimitive.List ref={ref} className={cn("flex gap-1", "data-[orientation=horizontal]:w-fit data-[orientation=horizontal]:max-w-full data-[orientation=horizontal]:rounded-round data-[orientation=horizontal]:bg-muted data-[orientation=horizontal]:p-1", className)} {...props} />,
)
TabsList.displayName = "TabsList"

/**
 * Segmented pill tabs: a round muted track, the active tab a raised white pill with violet text; the count
 * stays muted. Vertical lists (card sections) have no track: the active tab is the violet tint there.
 */
const tabClass =
  "inline-flex h-9 items-center gap-2 rounded-round px-4 text-body-sm font-medium text-muted-foreground transition-[color,background-color,box-shadow] disabled:opacity-50"
const trackClass = "flex w-fit max-w-full gap-1 rounded-round bg-muted p-1"

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { count?: number }
>(({ className, count, children, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      tabClass,
      "data-[state=active]:font-semibold data-[state=active]:text-accent data-[state=inactive]:hover:text-foreground data-[orientation=horizontal]:data-[state=active]:bg-card data-[orientation=horizontal]:data-[state=active]:shadow-panel data-[orientation=vertical]:data-[state=active]:bg-accent-surface data-[orientation=vertical]:data-[state=inactive]:hover:bg-muted",
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
    <div role="tablist" {...aria} className={cn(trackClass, className)}>
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
              tabClass,
              "aria-selected:bg-card aria-selected:font-semibold aria-selected:text-accent aria-selected:shadow-panel aria-[selected=false]:hover:text-foreground",
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
