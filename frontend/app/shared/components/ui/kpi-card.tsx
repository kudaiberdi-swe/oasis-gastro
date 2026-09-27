import * as React from "react"

import { cn } from "@/shared/lib/utils"

export interface KpiCardProps {
  label: React.ReactNode
  value: React.ReactNode
  /** Comparison or context line, e.g. «+12 % к прошлой неделе». */
  hint?: React.ReactNode
  hintTone?: "neutral" | "success" | "danger"
  className?: string
}

export function KpiCard({ label, value, hint, hintTone = "neutral", className }: KpiCardProps) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-card border border-border bg-card p-4 shadow-panel", className)}>
      <p className="text-body-sm text-muted-foreground">{label}</p>
      <div className="sq-price text-display font-semibold text-foreground">{value}</div>
      {hint ? (
        <p className={cn("text-caption", hintTone === "success" ? "text-success" : hintTone === "danger" ? "text-destructive" : "text-muted-foreground")}>{hint}</p>
      ) : null}
    </div>
  )
}
