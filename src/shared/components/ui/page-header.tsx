import * as React from "react"

import { cn } from "@/shared/lib/utils"

export interface PageHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  breadcrumb?: React.ReactNode
  /** Right side: the page's one primary action plus secondary ones. */
  actions?: React.ReactNode
  /** Right after the title, e.g. the office «В избранное» star (W3-ADM-13). */
  titleAddon?: React.ReactNode
  className?: string
}

/** Cormorant title with the 4px rust heading accent (design skill). */
export function PageHeader({ title, description, breadcrumb, actions, titleAddon, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-2", className)}>
      {breadcrumb}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1 border-l-4 border-rust pl-3">
          {titleAddon ? (
            <div className="flex items-center gap-1">
              <h1 className="font-display text-display font-semibold text-foreground">{title}</h1>
              {titleAddon}
            </div>
          ) : (
            <h1 className="font-display text-display font-semibold text-foreground">{title}</h1>
          )}
          {description ? <p className="text-body-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}
