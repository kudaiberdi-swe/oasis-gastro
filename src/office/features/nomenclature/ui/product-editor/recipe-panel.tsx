import type { ReactNode } from "react"

import { cn } from "@/shared/lib/utils"

/** A card panel of the recipe tab: title, one-line description, an action on the right. */
export function RecipePanel({ title, description, action, children, className }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-title-sm font-semibold">{title}</h3>
          {description ? <p className="text-caption text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}
