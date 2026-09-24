import * as React from "react"
import { AlertTriangle, Info, OctagonAlert } from "lucide-react"

import { cn } from "@/shared/lib/utils"

const toneStyles = {
  info: { className: "border-accent/40 bg-accent/10 text-foreground [&_svg]:text-accent", icon: Info },
  warning: { className: "border-warning/40 bg-warning/10 text-foreground [&_svg]:text-warning", icon: AlertTriangle },
  danger: { className: "border-destructive/40 bg-destructive/10 text-foreground [&_svg]:text-destructive", icon: OctagonAlert },
} as const

export interface BannerProps {
  tone?: keyof typeof toneStyles
  title: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

/** Page-level notice, e.g. «Смена открыта более 24 часов». */
export function Banner({ tone = "warning", title, children, action, className }: BannerProps) {
  const { className: toneClassName, icon: Icon } = toneStyles[tone]
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-card border p-3", toneClassName, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="text-body-sm font-semibold">{title}</p>
        {children ? <div className="text-body-sm text-muted-foreground">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
