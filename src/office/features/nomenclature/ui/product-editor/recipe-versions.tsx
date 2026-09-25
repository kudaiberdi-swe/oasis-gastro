import { Plus } from "lucide-react"

import { Button, TonePill } from "@/shared/components/ui"
import { formatAlmatyDate } from "@/shared/lib/almaty-time"
import { cn } from "@/shared/lib/utils"

import type { RecipeVersionId, RecipeVersionRow } from "../../data/use-recipe"
import { RECIPE_STATUS } from "../../model/use-recipe-draft"
import { RecipePanel } from "./recipe-panel"

export interface RecipeVersionsProps {
  versions: readonly RecipeVersionRow[] | undefined
  selectedId: RecipeVersionId | undefined
  /** An unsaved «Новая версия» is open. */
  creatingNew: boolean
  /** Unsaved edits: switching versions is blocked until they are saved or cancelled. */
  dirty: boolean
  canEdit: boolean
  canActivate: boolean
  activating: boolean
  onSelect: (id: RecipeVersionId) => void
  onNew: () => void
  onActivate: () => void
}

/** «История версий»: every version with its start date and status; sales use the one in force on their date. */
export function RecipeVersions({ versions, selectedId, creatingNew, dirty, canEdit, canActivate, activating, onSelect, onNew, onActivate }: RecipeVersionsProps) {
  const rows = versions ? [...versions].sort((a, b) => b.version - a.version) : undefined
  return (
    <RecipePanel
      title="История версий"
      description="Состав применяется к продажам по дате начала действия"
      action={
        canEdit ? (
          <Button variant="secondary" size="sm" onClick={onNew} disabled={dirty || creatingNew}>
            <Plus aria-hidden />
            Новая версия
          </Button>
        ) : undefined
      }
    >
      {creatingNew ? (
        <p className="border-b border-border bg-muted/40 px-5 py-2.5 text-body-sm font-medium">Новая версия — ещё не сохранена. Сохраните её, чтобы она появилась в списке черновиком.</p>
      ) : null}
      {rows === undefined ? (
        <p className="px-5 py-4 text-body-sm text-muted-foreground">Загружаем версии…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-4 text-body-sm text-muted-foreground">Версий пока нет. Первая сохранённая техкарта станет черновиком версии 1.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-body-sm">
            <caption className="sr-only">Версии технологической карты</caption>
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                {["Версия", "Начало действия", "Статус", "Автор", ""].map((header, index) => (
                  <th key={index} scope="col" className="px-5 py-2.5 text-caption font-semibold text-muted-foreground">
                    {header || <span className="sr-only">Действия</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selected = !creatingNew && row._id === selectedId
                const status = RECIPE_STATUS[row.status]
                return (
                  <tr key={row._id} aria-current={selected ? "true" : undefined} className={cn("border-b border-border last:border-b-0", selected && "bg-muted/40 shadow-[inset_2px_0_0_var(--gold)]")}>
                    <td className="px-5 py-3 font-semibold tabular-nums">v{row.version}</td>
                    <td className="px-5 py-3 tabular-nums">{formatAlmatyDate(row.effectiveFrom)}</td>
                    <td className="px-5 py-3">
                      <TonePill tone={status.tone}>{status.label}</TonePill>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{row.createdBy}</td>
                    <td className="px-5 py-2">
                      <div className="flex justify-end gap-2">
                        {selected ? (
                          <span className="py-2 text-caption text-muted-foreground">Открыта</span>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => onSelect(row._id)} disabled={dirty} title={dirty ? "Сохраните или отмените изменения" : undefined}>
                            Открыть
                          </Button>
                        )}
                        {selected && row.status === "draft" && canActivate ? (
                          <Button variant="secondary" size="sm" onClick={onActivate} disabled={dirty || activating}>
                            Активировать
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {dirty && rows && rows.length > 0 ? <p className="border-t border-border px-5 py-2.5 text-caption text-muted-foreground">Чтобы открыть другую версию, сохраните или отмените изменения.</p> : null}
    </RecipePanel>
  )
}
