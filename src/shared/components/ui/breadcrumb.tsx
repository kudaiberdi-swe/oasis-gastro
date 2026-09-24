import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn, focusRingClass } from "@/shared/lib/utils"

export type BreadcrumbItem = { label: React.ReactNode; onClick?: () => void; href?: string }

export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav aria-label="Навигация" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-body-sm text-muted-foreground">
        {items.map((item, index) => {
          const last = index === items.length - 1
          const linkClass = cn("rounded-control hover:text-foreground hover:underline", focusRingClass)
          return (
            <li key={index} className="flex items-center gap-1">
              {last ? (
                <span aria-current="page" className="text-foreground">
                  {item.label}
                </span>
              ) : item.href ? (
                <a href={item.href} className={linkClass}>
                  {item.label}
                </a>
              ) : item.onClick ? (
                <button type="button" onClick={item.onClick} className={linkClass}>
                  {item.label}
                </button>
              ) : (
                <span>{item.label}</span>
              )}
              {last ? null : <ChevronRight aria-hidden className="size-4" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
