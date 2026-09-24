import * as React from "react"

import { cn, focusRingClass } from "@/shared/lib/utils"

export type CategoryTone = "meat" | "dairy" | "bread" | "green" | "tea" | "turkistan"

const toneClass: Record<CategoryTone, string> = {
  meat: "before:bg-cat-meat",
  dairy: "before:bg-cat-dairy",
  bread: "before:bg-cat-bread",
  green: "before:bg-cat-green",
  tea: "before:bg-cat-tea",
  turkistan: "before:bg-cat-turkistan",
}

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  size?: "md" | "lg"
  /** A 3px category-color strip on the left — a mark, never a fill. */
  tone?: CategoryTone
  count?: number
}

/** Filter and category chip, 36/44px. Active is --nav with --nav-foreground (POS-DESIGN §5). */
const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(({ active = false, size = "md", tone, count, className, children, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    aria-pressed={active}
    className={cn(
      "relative inline-flex shrink-0 items-center gap-2 overflow-hidden rounded-control border px-3 text-body-sm font-medium whitespace-nowrap transition-colors disabled:opacity-50",
      size === "lg" ? "h-11" : "h-9",
      active ? "border-nav bg-nav text-nav-foreground" : "border-input bg-card text-foreground hover:bg-muted",
      tone && cn("pl-4 before:absolute before:inset-y-0 before:left-0 before:w-[3px]", toneClass[tone]),
      focusRingClass,
      className,
    )}
    {...props}
  >
    {children}
    {count !== undefined ? <span className={cn("tabular-nums", active ? "text-nav-muted" : "text-muted-foreground")}>{count}</span> : null}
  </button>
))
Chip.displayName = "Chip"

export { Chip }
