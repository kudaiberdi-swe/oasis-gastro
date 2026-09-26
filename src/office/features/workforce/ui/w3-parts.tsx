import type { ReactNode } from "react"

import { Switch } from "@/shared/components/ui"
import { cn } from "@/shared/lib/utils"

// Small parts shared by the W3 staff cards (motivation, medical records).

export function ReadOnlyField({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-body-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-body-sm text-foreground">{value}</span>
    </div>
  )
}

export function SwitchRow({ label, hint, checked, disabled, onChange, className }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; className?: string }) {
  return (
    <label className={cn("flex items-start justify-between gap-4 rounded-control border border-border p-3", className)}>
      <span className="flex flex-col gap-0.5">
        <span className="text-body-sm font-medium text-foreground">{label}</span>
        <span className="text-caption text-muted-foreground">{hint}</span>
      </span>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  )
}

export function CardSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-title-sm font-semibold">{title}</h3>
        {description ? <p className="text-caption text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}
