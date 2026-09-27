import { Link } from "react-router"

import { Ornament } from "@/shared/components/ui"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { useIntegrationReferences } from "../data/use-integration-cards"

// «ЕГАИС» (/office/integration-egais, W3-INT-02, office/71, decision D4): the Russian alcohol register is
// not used in Kazakhstan. The page says so; the server refuses a ЕГАИС card and any exchange job under KZ
// (convex/domains/integrations/cards.ts, lib/integrationQueue.ts) — this is not only a front-end flag.

export function EgaisUnavailable() {
  const references = useIntegrationReferences("integration-egais")
  const jurisdictions = [...new Set((references?.organizations ?? []).map((row) => row.jurisdiction))]
  const current = jurisdictions.length ? jurisdictions.join(", ") : "KZ"
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <section aria-label="Недоступно для KZ" className="flex flex-col items-center gap-3 rounded-card border border-border bg-card px-6 py-12 text-center">
        <Ornament width={120} className="text-gold" />
        <h2 className="font-display text-title font-semibold text-foreground">Недоступно для KZ</h2>
        <p className="max-w-xl text-body-sm text-muted-foreground">Для алкогольного и фискального учёта Казахстана используйте интеграции ОФД/ККМ.</p>
        <p className="max-w-xl text-caption text-muted-foreground">Текущая юрисдикция: {current}. Конфигурация ЕГАИС не активируется и не отправляет задания обмена.</p>
        <Link to="/office/integration-fiscal" className={cn("text-body-sm font-medium text-accent underline-offset-2 hover:underline", focusRingClass)}>
          Перейти к фискальным сервисам
        </Link>
      </section>
    </div>
  )
}
