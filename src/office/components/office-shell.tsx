import type { ReactNode } from "react"

import { useSidebarCollapsed } from "@/office/data/use-office-navigation"
import type { OfficeNavigationGroup } from "@/office/model/navigation"
import { Breadcrumb, PageHeader } from "@/shared/components/ui"
import { cn } from "@/shared/lib/utils"

import { Sidebar } from "./sidebar"

export interface OfficeShellProps {
  groups: OfficeNavigationGroup[]
  activeItemId: string | undefined
  userName?: string
  footerLine: string
  onSignOut?: () => void
  children: ReactNode
}

/** Office frame: dark sidebar + content. No POS header here (L-7). */
export function OfficeShell({ groups, activeItemId, userName, footerLine, onSignOut, children }: OfficeShellProps) {
  const { collapsed, canToggle, toggle } = useSidebarCollapsed()
  return (
    <div className="flex h-full min-h-0 bg-background">
      <Sidebar
        groups={groups}
        activeItemId={activeItemId}
        collapsed={collapsed}
        canToggleCollapsed={canToggle}
        onToggleCollapsed={toggle}
        userName={userName}
        footerLine={footerLine}
        onSignOut={onSignOut}
      />
      {/* S-18: the content column has a bounded height, so pages and tables scroll inside it. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}

export interface OfficePageProps {
  group?: OfficeNavigationGroup
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Right side of the breadcrumb row, e.g. «● Все изменения сохранены». */
  status?: ReactNode
  /** "fill": the body owns its scrolling (existing workspaces with side panes); "scroll": the page scrolls. */
  layout?: "fill" | "scroll"
  children: ReactNode
}

/** Breadcrumb 12px + PageHeader (group whisper, Cormorant title, one primary), up to 1440px wide. */
export function OfficePage({ group, title, description, actions, status, layout = "scroll", children }: OfficePageProps) {
  const header = (
    <div className="flex flex-col gap-3 border-b border-border px-6 pt-5 pb-4 xl:px-8">
      <div className="flex min-h-5 items-center justify-between gap-4 text-caption">
        {group ? <Breadcrumb className="text-caption" items={[{ label: group.label }, { label: title }]} /> : <span />}
        {status}
      </div>
      <div className="flex flex-col gap-1">
        {group ? <p className="text-caption font-medium text-accent">{group.whisper}</p> : null}
        <PageHeader title={title} description={description} actions={actions} />
      </div>
    </div>
  )

  if (layout === "fill") {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1440px] flex-col">
        {header}
        <div className={cn("flex min-h-0 flex-1 flex-col bg-card")}>{children}</div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col">
        {header}
        <div className="px-6 py-6 xl:px-8">{children}</div>
      </div>
    </div>
  )
}
