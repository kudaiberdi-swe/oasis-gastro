import { Plus } from "lucide-react"
import type { ReactNode } from "react"

import { OfficeStatePage } from "@/office/components/state-page"
import { Button, Input, TonePill } from "@/shared/components/ui"
import { cn, focusRingClass } from "@/shared/lib/utils"

export interface MasterListItem {
  id: string
  title: string
  meta: ReactNode
  active: boolean
}

export interface MasterListProps {
  label: string
  items: MasterListItem[] | undefined
  selectedId: string | null
  onSelect: (id: string) => void
  search: string
  onSearchChange: (search: string) => void
  searchPlaceholder: string
  /** The page's one primary action («+ Новая единица»); hidden without the edit right. */
  createLabel?: string
  onCreate?: () => void
  activeLabels?: { on: string; off: string }
  emptyTitle: string
  emptyDescription: string
  footer?: ReactNode
}

/** Master-data list (OFFICE-DESIGN §3.3): name 14px 600, meta 12px muted, StatusPill on the right. */
export function MasterList({
  label,
  items,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  searchPlaceholder,
  createLabel,
  onCreate,
  activeLabels = { on: "Активна", off: "Неактивна" },
  emptyTitle,
  emptyDescription,
  footer,
}: MasterListProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input type="search" aria-label="Поиск" placeholder={searchPlaceholder} className="w-full sm:w-[420px]" value={search} onChange={(event) => onSearchChange(event.target.value)} />
        {createLabel && onCreate ? (
          <Button onClick={onCreate}>
            <Plus aria-hidden />
            {createLabel}
          </Button>
        ) : null}
      </div>
      {items === undefined ? (
        <OfficeStatePage state={{ kind: "loading" }} />
      ) : items.length === 0 ? (
        <div className="rounded-card border border-border bg-card">
          <OfficeStatePage
            state={{
              kind: "empty",
              title: emptyTitle,
              description: search.trim() ? "Измените запрос поиска." : emptyDescription,
              action:
                createLabel && onCreate && !search.trim() ? (
                  <Button variant="secondary" onClick={onCreate}>
                    {createLabel}
                  </Button>
                ) : undefined,
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-card border border-border bg-card">
          <ul aria-label={label} className="flex flex-col divide-y divide-border">
            {items.map((item) => {
              const selected = item.id === selectedId
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(item.id)}
                    className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted", selected && "bg-muted shadow-[inset_2px_0_0_var(--gold)]", focusRingClass)}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-body-sm font-semibold text-foreground">{item.title}</span>
                      <span className="truncate text-caption text-muted-foreground">{item.meta}</span>
                    </span>
                    <TonePill tone={item.active ? "success" : "neutral"}>{item.active ? activeLabels.on : activeLabels.off}</TonePill>
                  </button>
                </li>
              )
            })}
          </ul>
          {footer ?? <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground">Загружено записей: {items.length}</p>}
        </div>
      )}
    </div>
  )
}

export function SwitchRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex items-start gap-3 text-body-sm">
      <span className="pt-0.5">{children}</span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">{label}</span>
        {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  )
}
