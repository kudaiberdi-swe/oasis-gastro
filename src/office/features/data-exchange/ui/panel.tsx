import type { ReactNode } from "react"

import { cn } from "@/shared/lib/utils"

/** A titled card of the dedicated screen (OFFICE-DESIGN §3.6): 18px title, one-line description, body below a rule. */
export function Panel({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-panel border border-border bg-card shadow-panel", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-title-sm font-semibold text-foreground">{title}</h2>
          {description ? <p className="text-caption text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}
