import { AlertTriangle, CheckCircle2 } from "lucide-react"

import { formatQuantity } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import type { RecipeCheck } from "../../../../../../convex/lib/recipeMath"
import type { RecipeComputation } from "../../model/use-recipe-draft"
import { RecipePanel } from "./recipe-panel"

const TITLES: Record<RecipeCheck["code"], string> = {
  units: "Единицы приведены к килограммам",
  yield: "Выход готового продукта рассчитан",
  batch: "Норма закладки указана",
  costs: "Себестоимость без нулевых ингредиентов",
  date: "Начало действия не позже первой продажи",
}

function detail(check: RecipeCheck, computed: RecipeComputation) {
  if (!check.ok) return check.message
  switch (check.code) {
    case "units":
      return "Для литров и штук задан вес одной единицы"
    case "yield":
      return `${formatQuantity(computed.summary.outputKg)} кг на всю закладку`
    case "batch":
      return `${formatQuantity(computed.batchYield)} порц. из одной закладки`
    case "costs":
      return "У всех ингредиентов есть средняя складская цена"
    case "date":
      return "Продажи с этой даты спишут ингредиенты по техкарте"
  }
}

/** «Проверка техкарты»: the recipeMath checks with a title and what exactly is wrong. */
export function RecipeChecks({ computed }: { computed: RecipeComputation }) {
  return (
    <RecipePanel title="Проверка техкарты" description="Проверки целостности текущей техкарты">
      <ul className="flex flex-col divide-y divide-border">
        {computed.checks.map((check) => (
          <li key={check.code} className="flex items-start gap-3 px-5 py-3" data-check={check.code} data-ok={check.ok}>
            <CheckIcon ok={check.ok} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body-sm font-semibold">{TITLES[check.code]}</span>
              <span className={cn("text-caption", check.ok ? "text-muted-foreground" : "text-destructive")}>{detail(check, computed)}</span>
            </span>
          </li>
        ))}
      </ul>
    </RecipePanel>
  )
}

/** The one-line summary next to «Норма закладки»: correct, or how many checks fail. */
export function RecipeStatusIndicator({ checks }: { checks: RecipeCheck[] }) {
  const failed = checks.filter((check) => !check.ok).length
  return (
    <div role="status" className="flex min-h-[var(--control-h)] items-center gap-2 rounded-control border border-border bg-card px-3 text-body-sm font-medium">
      {failed === 0 ? <CheckCircle2 aria-hidden className="size-[18px] shrink-0 text-success" /> : <AlertTriangle aria-hidden className="size-[18px] shrink-0 text-warning" />}
      {failed === 0 ? "Техкарта заполнена корректно" : `Требуют внимания: ${failed} ${failed === 1 ? "проверка" : failed < 5 ? "проверки" : "проверок"}`}
    </div>
  )
}

function CheckIcon({ ok }: { ok: boolean }) {
  return (
    <span aria-hidden className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-control", ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
      {ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
    </span>
  )
}
