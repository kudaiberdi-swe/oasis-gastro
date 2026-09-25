import type { ReactNode } from "react"

import { RightPanel } from "@/office/components/right-panel"
import { useBreakpoint } from "@/shared/hooks/use-breakpoint"
import { cn, focusRingClass } from "@/shared/lib/utils"

// Master data layout (OFFICE-DESIGN §3.3) for zones, couriers, sources and price lists: the list with
// its caption on the left, the card on the right (≥1280), a slide-in panel below that.

export function MasterDetail({
  toolbar,
  list,
  card,
  cardTitle,
  cardCaption,
  cardActions,
  editing,
  onClose,
}: {
  toolbar?: ReactNode
  list: ReactNode
  /** The form; null shows the «choose a record» hint. */
  card: ReactNode | null
  cardTitle: string
  cardCaption?: string
  /** «Сохранить» in the card's header (the Sandyq move of bahandi's full-width button). */
  cardActions?: ReactNode
  editing: boolean
  onClose: () => void
}) {
  const breakpoint = useBreakpoint()
  const inline = breakpoint === "laptop" || breakpoint === "desktop"
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      {toolbar ? <div className="flex flex-wrap items-center justify-end gap-2">{toolbar}</div> : null}
      <div className="flex min-h-0 flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex w-full min-w-0 flex-col gap-3 lg:w-[400px] lg:shrink-0">{list}</div>
        {inline ? (
          <section aria-label={cardTitle} className="flex min-w-0 flex-1 flex-col gap-4 rounded-card border border-border bg-card p-5">
            <CardHeader title={cardTitle} caption={cardCaption} actions={editing ? cardActions : null} />
            {editing && card ? card : <p className="py-10 text-center text-body-sm text-muted-foreground">Выберите запись слева или создайте новую.</p>}
          </section>
        ) : (
          <RightPanel
            open={editing}
            onOpenChange={(open) => {
              if (!open) onClose()
            }}
            title={cardTitle}
            footer={cardActions}
          >
            {cardCaption ? <p className="mb-4 text-caption text-muted-foreground">{cardCaption}</p> : null}
            {card}
          </RightPanel>
        )}
      </div>
    </div>
  )
}

function CardHeader({ title, caption, actions }: { title: string; caption?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="text-title-sm font-semibold">{title}</h3>
        {caption ? <p className="text-caption text-muted-foreground">{caption}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

/** The list block: «Действующие зоны» + its caption, then rows. */
export function MasterListBlock({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col overflow-hidden rounded-card border border-border bg-card">
      <div className="flex flex-col gap-0.5 border-b border-border px-4 py-3">
        <h3 className="text-title-sm font-semibold">{title}</h3>
        {caption ? <p className="text-caption text-muted-foreground">{caption}</p> : null}
      </div>
      {children}
    </section>
  )
}

export function MasterRows({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col divide-y divide-border">{children}</ul>
}

/** A selectable row: title 14/600, meta 12 muted, trailing figures and a StatusPill. */
export function MasterRow({ title, meta, trailing, active, onSelect, actions }: { title: ReactNode; meta?: ReactNode; trailing?: ReactNode; active: boolean; onSelect: () => void; actions?: ReactNode }) {
  return (
    <li className={cn("flex items-center gap-2 pr-3", active && "bg-muted shadow-[inset_2px_0_0_var(--gold)]")}>
      <button type="button" aria-current={active ? "true" : undefined} onClick={onSelect} className={cn("flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-muted", focusRingClass)}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-semibold text-foreground">{title}</span>
          {meta ? <span className="block truncate text-caption text-muted-foreground">{meta}</span> : null}
        </span>
        {trailing ? <span className="flex shrink-0 items-center gap-3">{trailing}</span> : null}
      </button>
      {actions ? <span className="flex shrink-0 items-center gap-1.5">{actions}</span> : null}
    </li>
  )
}
