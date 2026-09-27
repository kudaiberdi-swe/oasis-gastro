import { formatQuantity } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import type { StockCheckRow } from "../model/production"

/**
 * «Ингредиенты к списанию»: recipe quantities for the act's preparations against the source warehouse.
 * Quantities only — the cost and the exact plan (recipe version at the act date, losses, nested
 * preparations) come from the server when the act is posted.
 */
export function MaterialWriteoffPreview({ rows, state }: { rows: readonly StockCheckRow[]; state: "ready" | "loading" | "no-access" | "empty" }) {
  const head = "h-10 px-3 text-caption font-semibold text-muted-foreground"
  return (
    <section aria-label="Ингредиенты к списанию" className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-title-sm font-semibold">Ингредиенты к списанию</h3>
        <p className="text-caption text-muted-foreground">Предварительно по действующей техкарте. Точное количество и стоимость рассчитает проведение.</p>
      </div>
      {state === "no-access" ? (
        <p className="text-body-sm text-muted-foreground">Состав техкарт виден с правом просмотра номенклатуры.</p>
      ) : state === "loading" ? (
        <p className="text-body-sm text-muted-foreground" aria-busy="true">
          Загрузка техкарт…
        </p>
      ) : state === "empty" || rows.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">Добавьте заготовки и количество — здесь появится их состав.</p>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-card border border-border">
          <table className="w-full border-collapse text-body-sm">
            <caption className="sr-only">Ингредиенты к списанию</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={cn(head, "text-left")}>
                  Ингредиент
                </th>
                <th scope="col" className={cn(head, "text-left")}>
                  Ед.
                </th>
                <th scope="col" className={cn(head, "text-right")}>
                  Нужно
                </th>
                <th scope="col" className={cn(head, "text-right")}>
                  На складе
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="h-11 border-b border-border last:border-b-0">
                  <td className="px-3 font-semibold">{row.name}</td>
                  <td className="px-3">{row.unit}</td>
                  <td className="px-3 text-right tabular-nums whitespace-nowrap">{formatQuantity(row.quantity)}</td>
                  <td className={cn("px-3 text-right tabular-nums whitespace-nowrap", row.short && "font-semibold text-destructive")}>{row.onHand === null ? "—" : formatQuantity(row.onHand)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
