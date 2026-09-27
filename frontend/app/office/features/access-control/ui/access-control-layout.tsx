import type { ReactNode } from "react"

import { OfficeStatePage } from "@/office/components/state-page"
import { cn, focusRingClass } from "@/shared/lib/utils"

/** Special screen (OFFICE-DESIGN §3.6): master list 360 px on the left, the card on the right. */
export function SplitLayout({ list, children }: { list: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <aside className="flex shrink-0 flex-col border-b border-border lg:w-[360px] lg:overflow-y-auto lg:border-r lg:border-b-0">{list}</aside>
      <div className="relative min-w-0 flex-1 lg:overflow-y-auto">{children}</div>
    </div>
  )
}

export function MasterList({
  label,
  action,
  empty,
  children,
}: {
  label: string
  action: ReactNode
  /** Shown instead of the list when there are no rows. */
  empty?: { title: string; description: string } | null
  children: ReactNode
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-3 p-4">
      {action ? <div className="flex">{action}</div> : null}
      {empty ? (
        <OfficeStatePage state={{ kind: "empty", title: empty.title, description: empty.description }} />
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-card border border-border bg-card">{children}</ul>
      )}
    </section>
  )
}

export function MasterListItem({ title, meta, trailing, active, onSelect }: { title: ReactNode; meta?: ReactNode; trailing?: ReactNode; active: boolean; onSelect: () => void }) {
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted", active && "bg-muted shadow-[inset_2px_0_0_var(--gold)]", focusRingClass)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-semibold text-foreground">{title}</span>
          {meta ? <span className="block truncate text-caption text-muted-foreground">{meta}</span> : null}
        </span>
        {trailing}
      </button>
    </li>
  )
}
