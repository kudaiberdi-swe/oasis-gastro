import { useState } from "react"
import { useSearchParams } from "react-router"

import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui"

import { ModifierRegister } from "./modifier-register"
import { ProductRulesTab } from "./product-rules-tab"

type TabKey = "catalog" | "rules"

/**
 * «Модификаторы» (/office/modifiers, W1-CAT-08) — конструктор блюд: the modifier catalog with its groups,
 * and the rules of a dish. The tab and the dish live in the URL (?tab=rules&product=…), so the product
 * card can link straight to its rules.
 */
export function ModifiersWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <ModifiersContent />
    </PlatformErrorBoundary>
  )
}

function ModifiersContent() {
  const [params, setParams] = useSearchParams()
  const tab: TabKey = params.get("tab") === "rules" ? "rules" : "catalog"
  const product = params.get("product") ?? undefined

  const update = (patch: { tab?: TabKey; product?: string }) => {
    const next = new URLSearchParams(params)
    const nextTab = patch.tab ?? tab
    if (nextTab === "rules") next.set("tab", "rules")
    else next.delete("tab")
    if ("product" in patch) {
      if (patch.product) next.set("product", patch.product)
      else next.delete("product")
    }
    setParams(next, { replace: true })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5 xl:px-8">
      <p className="mb-2 text-body-sm text-muted-foreground">Конструктор блюд: платные и бесплатные добавки, обязательность и ограничения.</p>
      <Tabs value={tab} onValueChange={(value) => update({ tab: value as TabKey })} className="flex min-h-0 flex-1 flex-col">
        <TabsList aria-label="Модификаторы">
          <TabsTrigger value="catalog">Справочник модификаторов</TabsTrigger>
          <TabsTrigger value="rules">Правила для блюда</TabsTrigger>
        </TabsList>
        <TabsContent value="catalog" className="flex min-h-0 flex-1 flex-col">
          <ModifierRegister />
        </TabsContent>
        <TabsContent value="rules">
          <ProductRulesTab productExternalId={product} onProductChange={(externalId) => update({ product: externalId })} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
