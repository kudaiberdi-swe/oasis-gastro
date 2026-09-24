import * as React from "react"

import { cn } from "@/shared/lib/utils"

import { Ornament } from "./ornament"

export interface EmptyStateProps {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  size?: "md" | "lg"
  className?: string
}

/** Gold ornament (96/120px), Cormorant 22px title, one action at most. */
export function EmptyState({ title, description, action, size = "md", className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <Ornament width={size === "lg" ? 120 : 96} className="text-gold" />
      <p className="font-display text-title font-semibold text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-body-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
