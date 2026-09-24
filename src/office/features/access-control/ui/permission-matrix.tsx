import { ChevronDown } from "lucide-react"
import { useId, useMemo, useState } from "react"

import { findOfficeItem, officeNavigation } from "@/office/model/navigation"
import { Checkbox } from "@/shared/components/ui"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { ACTION_LABELS, ACTION_ORDER, countLabel, rightId, type CatalogSection } from "../data/use-access-control"

const FUNCTION_FORMS: [string, string, string] = ["функция", "функции", "функций"]

export interface PermissionMatrixProps {
  catalog: readonly CatalogSection[]
  /** Explicit office.<section>.<action> rights that are checked. */
  selected: ReadonlySet<string>
  onToggle: (right: string, checked: boolean) => void
  /** «Полный доступ»: every box reads as granted and nothing can be changed. */
  fullAccess: boolean
  /** Read-only screen (no office.roles.edit). */
  readOnly?: boolean
  /** Rights the editor may not grant stay disabled (the server rejects them anyway). */
  canGrant: (right: string) => boolean
}

/** «Матрица разрешений» (OFFICE-DESIGN §3.6): one accordion per navigation group, section × action inside. */
export function PermissionMatrix({ catalog, selected, onToggle, fullAccess, readOnly = false, canGrant }: PermissionMatrixProps) {
  const groups = useMemo(
    () =>
      officeNavigation
        .map((group) => ({ id: group.id, label: group.label, sections: catalog.filter((section) => section.groupId === group.id) }))
        .filter((group) => group.sections.length > 0),
    [catalog],
  )
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggleGroup = (groupId: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })

  return (
    <div className="flex flex-col rounded-card border border-border" aria-disabled={fullAccess || readOnly || undefined}>
      {groups.map((group) => (
        <MatrixGroup
          key={group.id}
          label={group.label}
          sections={group.sections}
          expanded={open.has(group.id)}
          onToggleExpanded={() => toggleGroup(group.id)}
          selected={selected}
          onToggle={onToggle}
          fullAccess={fullAccess}
          readOnly={readOnly}
          canGrant={canGrant}
        />
      ))}
    </div>
  )
}

function MatrixGroup({
  label,
  sections,
  expanded,
  onToggleExpanded,
  selected,
  onToggle,
  fullAccess,
  readOnly,
  canGrant,
}: {
  label: string
  sections: CatalogSection[]
  expanded: boolean
  onToggleExpanded: () => void
} & Omit<PermissionMatrixProps, "catalog">) {
  const panelId = useId()
  // Only the actions some section of this group supports get a column.
  const actions = ACTION_ORDER.filter((action) => sections.some((section) => section.actions.includes(action)))
  const granted = fullAccess ? sections.length : sections.filter((section) => section.actions.some((action) => selected.has(rightId(section.id, action)))).length

  return (
    <section className="border-b border-border last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggleExpanded}
          className={cn("flex w-full items-center gap-3 bg-card px-4 py-3 text-left hover:bg-muted", focusRingClass)}
        >
          <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")} />
          <span className="flex-1 text-body-sm font-semibold text-foreground">{label}</span>
          <span className="text-caption text-muted-foreground tabular-nums">
            {countLabel(sections.length, FUNCTION_FORMS)}
            {granted > 0 ? ` · с правами ${granted}` : ""}
          </span>
        </button>
      </h3>
      {expanded ? (
        <div id={panelId} className="border-t border-border">
          <table className="w-full border-collapse text-body-sm">
            <caption className="sr-only">{`Права раздела «${label}»`}</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky top-0 z-10 bg-muted px-4 py-2 text-left text-caption font-medium text-muted-foreground">
                  Раздел
                </th>
                {actions.map((action) => (
                  <th key={action} scope="col" className="sticky top-0 z-10 w-28 bg-muted px-2 py-2 text-center text-caption font-medium text-muted-foreground">
                    {ACTION_LABELS[action]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => {
                const sectionLabel = findOfficeItem(section.id)?.label ?? section.id
                return (
                  <tr key={section.id} className="border-t border-border">
                    <th scope="row" className="px-4 py-2 text-left font-normal text-foreground">
                      {sectionLabel}
                    </th>
                    {actions.map((action) => {
                      if (!section.actions.includes(action)) return <td key={action} className="px-2 py-2" />
                      const right = rightId(section.id, action)
                      return (
                        <td key={action} className="px-2 py-2 text-center">
                          <Checkbox
                            aria-label={`${sectionLabel}: ${ACTION_LABELS[action]}`}
                            checked={fullAccess || selected.has(right)}
                            disabled={fullAccess || readOnly || !canGrant(right)}
                            onCheckedChange={(checked) => onToggle(right, checked === true)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
