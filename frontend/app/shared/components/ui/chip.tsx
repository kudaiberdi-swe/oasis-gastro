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
  /** A small category-color dot before the label — a mark, never a fill. */
  tone?: CategoryTone
  count?: number
}

/** Filter and category chip, 36/44px, fully round. Active is the violet --chip-active fill; idle a muted tint. */
const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(({ active = false, size = "md", tone, count, className, children, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    aria-pressed={active}
    className={cn(
      "inline-flex shrink-0 items-center gap-2 rounded-round border px-4 text-body-sm font-medium whitespace-nowrap transition-colors disabled:opacity-50",
      size === "lg" ? "h-11" : "h-9",
      active ? "border-chip-active bg-chip-active text-chip-active-foreground" : "border-transparent bg-muted text-foreground hover:bg-accent-surface hover:text-accent",
      tone && cn("pl-3 before:block before:size-2 before:shrink-0 before:rounded-round", toneClass[tone]),
      focusRingClass,
      className,
    )}
    {...props}
  >
    {children}
    {count !== undefined ? <span className={cn("tabular-nums", active ? "text-chip-active-muted" : "text-muted-foreground")}>{count}</span> : null}
  </button>
))
Chip.displayName = "Chip"

export { Chip }
