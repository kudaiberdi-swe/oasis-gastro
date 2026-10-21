import { formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

export interface MoneyProps {
  value: number
  /** On dark surfaces (POS header, nav) prices use --nav-accent. */
  onDark?: boolean
  /** Signed deltas (variance, adjustments): +/− and success/destructive color. */
  signed?: boolean
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
}

const sizeClass = { sm: "text-body", md: "text-title-sm", lg: "text-title", xl: "text-display" }

/** Semibold with tabular lining figures, violet by default. */
export function Money({ value, onDark = false, signed = false, size = "md", className }: MoneyProps) {
  const color = signed ? (value < 0 ? "text-destructive" : value > 0 ? "text-success" : "text-muted-foreground") : onDark ? "text-nav-accent" : "text-accent"
  return <span className={cn("sq-price font-semibold whitespace-nowrap", sizeClass[size], color, className)}>{formatTenge(value, { explicitPlus: signed })}</span>
}
