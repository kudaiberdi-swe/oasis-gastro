import * as PopoverPrimitive from "@radix-ui/react-popover"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { ChevronDown, ExternalLink, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Rows3, Search, Sun } from "lucide-react"
import { useMemo, useState } from "react"
import { Link } from "react-router"

import { useExpandedGroups } from "@/office/data/use-office-navigation"
import { searchNavigation } from "@/office/model/nav-filter"
import { OFFICE_LINKS, type OfficeNavigationGroup, type OfficeNavigationItem } from "@/office/model/navigation"
import { preloadSection } from "@/office/model/section-preload"
import { useTheme } from "@/shared/components/theme-provider"
import { cn, focusRingClass } from "@/shared/lib/utils"

export interface SidebarProps {
  groups: OfficeNavigationGroup[]
  activeItemId: string | undefined
  collapsed: boolean
  canToggleCollapsed: boolean
  onToggleCollapsed: () => void
  userName?: string
  footerLine: string
  onSignOut?: () => void
}

const navFocus = cn(focusRingClass, "focus-visible:outline-nav-accent")

function itemHref(item: OfficeNavigationItem) {
  return OFFICE_LINKS[item.id] ?? `/office/${item.id}`
}

function NavItemLink({ item, active, highlight }: { item: OfficeNavigationItem; active: boolean; highlight?: string }) {
  const external = item.id in OFFICE_LINKS
  return (
    <Link
      to={itemHref(item)}
      target={external ? "_blank" : undefined}
      aria-current={active ? "page" : undefined}
      onPointerEnter={external ? undefined : () => preloadSection(item.id)}
      onFocus={external ? undefined : () => preloadSection(item.id)}
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-control py-1.5 pr-2 pl-10 text-body-sm text-nav-muted transition-colors",
        active ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-nav-raised hover:text-nav-foreground",
        navFocus,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{highlight ? <Highlight text={item.label} query={highlight} /> : item.label}</span>
      {external ? <ExternalLink aria-hidden className="size-3.5 shrink-0" /> : null}
    </Link>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  const index = text.toLocaleLowerCase("ru").indexOf(query.trim().toLocaleLowerCase("ru").split(/\s+/)[0] ?? "")
  if (!query.trim() || index < 0) return <>{text}</>
  const length = query.trim().split(/\s+/)[0].length
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-transparent text-nav-accent underline decoration-nav-accent underline-offset-2">{text.slice(index, index + length)}</mark>
      {text.slice(index + length)}
    </>
  )
}

/**
 * Ink-violet 264px office sidebar: the light OASIS Gastro logo on top, icon + label groups, the open page as a
 * violet pill; 72px with the OASIS Gastro mark, tooltips and flyouts when collapsed.
 */
export function Sidebar({ groups, activeItemId, collapsed, canToggleCollapsed, onToggleCollapsed, userName, footerLine, onSignOut }: SidebarProps) {
  const activeGroupId = groups.find((group) => group.items.some((item) => item.id === activeItemId))?.id
  const { expanded, toggle } = useExpandedGroups(activeGroupId)
  const [query, setQuery] = useState("")
  // The 72px sidebar has no search field, so it always shows every group.
  const searching = !collapsed && query.trim() !== ""
  const visibleGroups = useMemo(() => (searching ? searchNavigation(groups, query) : groups), [groups, query, searching])
  const { mode, setMode, density, setDensity } = useTheme()

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <aside
        aria-label="Навигация офиса"
        className={cn("flex h-full shrink-0 flex-col bg-nav text-nav-foreground transition-[width] duration-150", collapsed ? "w-[72px]" : "w-[264px]")}
      >
        <div className={cn("flex h-16 shrink-0 items-center gap-2", collapsed ? "justify-center px-2" : "px-5")}>
          {collapsed ? (
            <img src="/branding/oasis-gastro-mark.svg" alt="OASIS Gastro" width={64} height={64} className="size-8 shrink-0" />
          ) : (
            <>
              <img src="/branding/oasis-gastro-logo-on-dark.svg" alt="OASIS Gastro" width={185} height={64} className="h-8 w-auto shrink-0" />
              <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-nav-muted">Office</span>
              <span className="rounded-round bg-nav-raised px-2 py-0.5 text-caption font-medium text-nav-accent">Сеть</span>
            </>
          )}
        </div>

        {collapsed ? null : (
          <div className="px-3 pt-3">
            <label className="relative block">
              <span className="sr-only">Поиск по разделам</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-nav-muted" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Раздел, документ или отчёт"
                className={cn("h-10 w-full rounded-control border border-transparent bg-nav-raised pr-3 pl-9 text-body-sm text-nav-foreground caret-nav-accent placeholder:text-nav-muted", navFocus)}
              />
            </label>
          </div>
        )}

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {searching && visibleGroups.length === 0 ? <p className="px-3 py-2 text-body-sm text-nav-muted">Ничего не найдено</p> : null}
          <ul className="flex flex-col gap-0.5">
            {visibleGroups.map((group) => {
              const Icon = group.icon
              const open = searching || expanded.includes(group.id)
              const groupActive = group.id === activeGroupId
              if (collapsed) {
                return (
                  <li key={group.id}>
                    <PopoverPrimitive.Root>
                      <TooltipPrimitive.Root>
                        <TooltipPrimitive.Trigger asChild>
                          <PopoverPrimitive.Trigger
                            aria-label={group.label}
                            className={cn(
                              "mx-auto flex size-11 items-center justify-center rounded-control text-nav-muted transition-colors",
                              groupActive ? "bg-primary text-primary-foreground" : "hover:bg-nav-raised hover:text-nav-foreground",
                              navFocus,
                            )}
                          >
                            <Icon aria-hidden className="size-5" />
                          </PopoverPrimitive.Trigger>
                        </TooltipPrimitive.Trigger>
                        <TooltipPrimitive.Portal>
                          <TooltipPrimitive.Content side="right" sideOffset={8} className="z-50 rounded-control bg-nav-raised px-2 py-1 text-caption text-nav-foreground shadow-float">
                            {group.label}
                          </TooltipPrimitive.Content>
                        </TooltipPrimitive.Portal>
                      </TooltipPrimitive.Root>
                      <PopoverPrimitive.Portal>
                        <PopoverPrimitive.Content side="right" align="start" sideOffset={8} className="z-50 w-64 rounded-card bg-nav p-2 text-nav-foreground shadow-float">
                          <p className="px-3 pb-1 text-caption font-semibold text-nav-muted">{group.label}</p>
                          <ul className="flex flex-col gap-0.5 [&_a]:pl-3">
                            {group.items.map((item) => (
                              <li key={item.id}>
                                <NavItemLink item={item} active={item.id === activeItemId} />
                              </li>
                            ))}
                          </ul>
                        </PopoverPrimitive.Content>
                      </PopoverPrimitive.Portal>
                    </PopoverPrimitive.Root>
                  </li>
                )
              }
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggle(group.id)}
                    disabled={searching}
                    className={cn(
                      "flex h-10 w-full items-center gap-3 rounded-control px-3 text-left text-body-sm font-medium text-nav-muted transition-colors hover:bg-nav-raised hover:text-nav-foreground",
                      groupActive && "text-nav-foreground [&>svg:first-child]:text-nav-accent",
                      navFocus,
                    )}
                  >
                    <Icon aria-hidden className="size-[18px] shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{group.label}</span>
                    <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-nav-muted transition-transform", !open && "-rotate-90")} />
                  </button>
                  {open ? (
                    <ul className="mt-0.5 mb-1 flex flex-col gap-0.5">
                      {group.items.map((item) => (
                        <li key={item.id}>
                          <NavItemLink item={item} active={item.id === activeItemId} highlight={searching ? query : undefined} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </nav>

        <div className={cn("flex flex-col gap-2 border-t border-nav-raised p-3", collapsed && "items-center")}>
          <Link
            to="/pos"
            target="_blank"
            className={cn("flex h-9 items-center gap-2 rounded-control px-2 text-body-sm text-nav-accent hover:bg-nav-raised", collapsed && "justify-center", navFocus)}
            aria-label={collapsed ? "Открыть кассу" : undefined}
          >
            <ExternalLink aria-hidden className="size-4" />
            {collapsed ? null : "Открыть кассу"}
          </Link>
          <div className={cn("flex gap-1", collapsed && "flex-col")}>
            <SidebarIconButton label={mode === "night" ? "Дневная тема" : "Ночная тема"} onClick={() => setMode(mode === "night" ? "day" : "night")}>
              {mode === "night" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </SidebarIconButton>
            <SidebarIconButton
              label={density === "compact" ? "Обычная плотность" : "Плотная таблица"}
              pressed={density === "compact"}
              onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
            >
              <Rows3 className="size-4" />
            </SidebarIconButton>
            {canToggleCollapsed ? (
              <SidebarIconButton label={collapsed ? "Развернуть меню" : "Свернуть меню"} onClick={onToggleCollapsed}>
                {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              </SidebarIconButton>
            ) : null}
          </div>
          <div className={cn("flex items-center gap-2", collapsed && "flex-col")}>
            {collapsed ? null : <p className="min-w-0 flex-1 truncate text-body-sm font-medium">{userName ?? "Офис"}</p>}
            {onSignOut ? (
              <SidebarIconButton label="Выйти" onClick={onSignOut}>
                <LogOut className="size-4" />
              </SidebarIconButton>
            ) : null}
          </div>
          {collapsed ? null : <p className="truncate text-caption text-nav-muted">{footerLine}</p>}
        </div>
      </aside>
    </TooltipPrimitive.Provider>
  )
}

function SidebarIconButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn("grid size-9 place-items-center rounded-round text-nav-muted transition-colors hover:bg-nav-raised hover:text-nav-foreground aria-pressed:bg-nav-raised aria-pressed:text-nav-accent", navFocus)}
        >
          {children}
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side="top" sideOffset={6} className="z-50 rounded-control bg-nav-raised px-2 py-1 text-caption text-nav-foreground shadow-float">
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
