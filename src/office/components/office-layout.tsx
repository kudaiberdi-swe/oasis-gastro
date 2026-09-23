import { LogOut, UtensilsCrossed } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/shared/lib/utils"

export type OfficeDestination = "catalog" | "stock" | "finance" | "workforce" | "loyalty" | "reports"

const NAV: { id: OfficeDestination; label: string }[] = [
  { id: "catalog", label: "Меню и цены" },
  { id: "stock", label: "Склад" },
  { id: "finance", label: "Финансы" },
  { id: "workforce", label: "Кадры" },
  { id: "loyalty", label: "Лояльность" },
  { id: "reports", label: "Отчёты" },
]

export function OfficeLayout({
  active,
  onNavigate,
  userName,
  onSignOut,
  children,
}: {
  active: OfficeDestination
  onNavigate: (destination: OfficeDestination) => void
  userName?: string
  onSignOut?: () => void
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border p-4">
          <p className="text-sm font-extrabold text-foreground">Sandyq Офис</p>
        </div>
        <nav aria-label="Навигация офиса" className="min-h-0 flex-1 overflow-y-auto p-2">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={cn(
                "flex h-9 w-full items-center rounded-[var(--radius-control)] px-3 text-left text-sm font-bold text-muted-foreground hover:bg-muted hover:text-foreground",
                item.id === active && "bg-primary/10 text-primary",
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-border p-3 text-xs font-semibold text-muted-foreground">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="size-3.5 text-primary" />
            <p className="min-w-0 flex-1 truncate font-extrabold text-foreground">{userName ?? "Офис"}</p>
            {onSignOut ? (
              <button type="button" aria-label="Выйти" title="Выйти" onClick={onSignOut} className="grid size-7 place-items-center rounded-[var(--radius-control)] hover:bg-muted hover:text-foreground">
                <LogOut className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}
