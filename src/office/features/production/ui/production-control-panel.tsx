import { CircleAlert, CircleCheck, CircleQuestionMark, OctagonAlert } from "lucide-react"

import { cn } from "@/shared/lib/utils"

import type { CheckTone, ControlCheck } from "../model/production"

const ICONS: Record<CheckTone, { icon: typeof CircleCheck; className: string; label: string }> = {
  ok: { icon: CircleCheck, className: "text-success", label: "Готово" },
  warning: { icon: CircleAlert, className: "text-warning", label: "Внимание" },
  error: { icon: OctagonAlert, className: "text-destructive", label: "Ошибка" },
  unknown: { icon: CircleQuestionMark, className: "text-muted-foreground", label: "Нет данных" },
}

/** «Проверка проведения» of a production act: what posting will check, before the click. */
export function ProductionControlPanel({ checks }: { checks: readonly ControlCheck[] }) {
  return (
    <section aria-label="Проверка проведения" className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
      <h3 className="text-title-sm font-semibold">Контроль проведения</h3>
      <ul className="flex flex-col divide-y divide-border">
        {checks.map((check) => {
          const tone = ICONS[check.tone]
          const Icon = tone.icon
          return (
            <li key={check.key} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <Icon aria-label={tone.label} className={cn("mt-0.5 size-[18px] shrink-0", tone.className)} />
              <div className="flex min-w-0 flex-col">
                <span className="text-body-sm font-semibold">{check.label}</span>
                <span className="text-caption text-muted-foreground">{check.detail}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
