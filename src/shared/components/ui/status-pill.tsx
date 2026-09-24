import { describeStatus, type StatusDomain, type StatusTone } from "@/shared/lib/status-dictionary"
import { cn } from "@/shared/lib/utils"

export const toneClass: Record<StatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-accent/30 bg-accent/10 text-accent",
}

export interface StatusPillProps {
  domain: StatusDomain
  status: string
  className?: string
}

/** Every status on screen goes through the dictionary: Russian label + tone, never the raw value. */
export function StatusPill({ domain, status, className }: StatusPillProps) {
  const entry = describeStatus(domain, status)
  return (
    <span
      title={entry.known ? undefined : status}
      className={cn("inline-flex h-6 items-center rounded-control border px-2 text-caption font-medium whitespace-nowrap", toneClass[entry.tone], className)}
    >
      {entry.label}
    </span>
  )
}

/** A pill with a free label — for counts and flags that are not backend statuses. */
export function TonePill({ tone = "neutral", className, children }: { tone?: StatusTone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-control border px-2 text-caption font-medium whitespace-nowrap", toneClass[tone], className)}>{children}</span>
  )
}
