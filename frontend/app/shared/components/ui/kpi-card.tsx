import * as React from "react"

import { cn } from "@/shared/lib/utils"

export interface KpiCardProps {
  label: React.ReactNode
  value: React.ReactNode
  /** Comparison or context line, e.g. «к прошлому периоду». */
  hint?: React.ReactNode
  hintTone?: "neutral" | "success" | "danger"
  /** A small chip right of the number, e.g. the green «+12 %» delta. */
  badge?: React.ReactNode
  className?: string
}

/** White card on the lavender background: muted label, a big bold number with an optional delta chip, a caption. */
export function KpiCard({ label, value, hint, hintTone = "neutral", badge, className }: KpiCardProps) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-card border border-border bg-card p-5 shadow-panel", className)}>
      <p className="text-body-sm font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="sq-price text-display font-bold tracking-tight text-foreground">{value}</div>
        {badge}
      </div>
      {hint ? (
        <p className={cn("text-caption", hintTone === "success" ? "text-success" : hintTone === "danger" ? "text-destructive" : "text-muted-foreground")}>{hint}</p>
      ) : null}
    </div>
  )
}
