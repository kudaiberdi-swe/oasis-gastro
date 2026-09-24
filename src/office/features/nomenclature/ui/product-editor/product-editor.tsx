import { ArrowLeft } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { flattenGroupTree, groupOptions, useProductGroups } from "@/office/features/product-groups/data/use-product-groups"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, EmptyState, Tabs, TabsContent, TabsList, TabsTrigger, TonePill, useToast } from "@/shared/components/ui"
import { useBreakpoint } from "@/shared/hooks/use-breakpoint"
import { errorMessage } from "@/shared/lib/error-message"
import type { CategoryTone } from "@/shared/components/ui/chip"
import { cn } from "@/shared/lib/utils"

import { ITEM_TYPE_LABELS, useNomenclatureMutations, useProductCard, useProductId, type NomenclatureLocationState, type ProductCard, type ProductId } from "../../data/use-nomenclature"
import { areFieldsDirty, changedBranchPrices, saveArgs, useProductDraft, validateDraft, type DraftErrors } from "../../model/use-product-draft"
import { ImageTab } from "./image-tab"
import { MainTab } from "./main-tab"
import { TechnologyTab } from "./technology-tab"
import { UnitsTab } from "./units-tab"

type TabKey = "main" | "units" | "image" | "sizes" | "recipe" | "technology"

const TABS: { key: TabKey; label: string }[] = [
  { key: "main", label: "Основные свойства" },
  { key: "units", label: "Единицы измерения" },
  { key: "image", label: "Изображение" },
  { key: "sizes", label: "Шкала размеров" },
  { key: "recipe", label: "Технологическая карта" },
  { key: "technology", label: "Технология приготовления" },
]

/** Product card (/office/nomenclature/:externalId, W1-CAT-05) on the Editor template (OFFICE-DESIGN §3.4). */
export function ProductEditor({ externalId }: { externalId: string }) {
  const card = useProductCard(externalId)
  const location = useLocation()
  const navigate = useNavigate()
  // The register's filters ride along in the query string, so «К списку» restores them.
  const back = useCallback(() => navigate({ pathname: "/office/nomenclature", search: location.search }), [navigate, location.search])

  if (card === undefined) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  if (card === null) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <EmptyState
          title="Позиция не найдена"
          description="Возможно, её удалили или ссылка устарела."
          action={
            <Button variant="secondary" onClick={back}>
              <ArrowLeft aria-hidden />К списку
            </Button>
          }
        />
      </div>
    )
  }
  return <ProductEditorForm card={card} onBack={back} productIdFromState={(location.state as NomenclatureLocationState)?.productId} />
}

function ProductEditorForm({ card, onBack, productIdFromState }: { card: ProductCard; onBack: () => void; productIdFromState: ProductId | undefined }) {
  const { draft, state, dirty, set, setBranchPrice, reset, markSaved } = useProductDraft(card)
  const blocker = useUnsavedChanges(dirty)
  const canEdit = useCan("office.nomenclature.edit")
  const canEditPrices = useCan("office.price-lists.edit")
  const productId = useProductId(card, productIdFromState)
  const groups = useProductGroups()
  const { saveProductCard, setProductPrice } = useNomenclatureMutations()
  const toast = useToast()
  const breakpoint = useBreakpoint()
  const [tab, setTab] = useState<TabKey>("main")
  const [errors, setErrors] = useState<DraftErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [closeAfterSave, setCloseAfterSave] = useState(false)
  const iiko = card.source === "iiko-server"
  const readOnly = !canEdit

  const options = useMemo(() => {
    const list = groupOptions(flattenGroupTree(groups ?? []))
    if (card.categoryExternalId && !list.some((option) => option.value === card.categoryExternalId)) list.push({ value: card.categoryExternalId, label: card.categoryLabel ?? "Без группы" })
    return list
  }, [groups, card.categoryExternalId, card.categoryLabel])
  const groupLabel = options.find((option) => option.value === draft.categoryExternalId)?.label.replace(/^(— )+/, "") ?? card.categoryLabel ?? "Без группы"

  // «Сохранить и закрыть» leaves once the saved state has rendered, so the leave guard lets it through.
  useEffect(() => {
    if (closeAfterSave && !dirty) onBack()
  }, [closeAfterSave, dirty, onBack])

  async function save(close: boolean) {
    if (saving) return
    const found = validateDraft(draft)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setTab(found.unitWeightKg && !found.name && !found.basePrice && !found.categoryExternalId ? "units" : "main")
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (canEdit && areFieldsDirty(state)) await saveProductCard(saveArgs(card.externalId, draft))
      if (productId && canEditPrices) {
        for (const price of changedBranchPrices(state)) await setProductPrice({ productId, ...price })
      }
      markSaved()
      toast("Сохранено", "success")
      if (close) setCloseAfterSave(true)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  const priceNotice = !canEditPrices ? undefined : productId ? undefined : "Цены филиалов можно изменить, открыв позицию из списка номенклатуры."
  const canSave = canEdit || canEditPrices
  const vertical = breakpoint === "tablet" || breakpoint === "laptop"

  const panels = (
    <>
      <TabsContent value="main" className={cn(vertical && "min-w-0 flex-1 pt-0")}>
        <MainTab
          card={card}
          draft={draft}
          errors={errors}
          set={set}
          groupOptions={options}
          readOnly={readOnly}
          prices={{ rows: card.branchPrices, values: draft.branchPrices, onChange: setBranchPrice, editable: canEditPrices && productId !== undefined, notice: priceNotice }}
        />
      </TabsContent>
      <TabsContent value="units" className={cn(vertical && "min-w-0 flex-1 pt-0")}>
        <UnitsTab card={card} draft={draft} errors={errors} set={set} readOnly={readOnly} />
      </TabsContent>
      <TabsContent value="image" className={cn(vertical && "min-w-0 flex-1 pt-0")}>
        <ImageTab card={card} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="sizes" className={cn(vertical && "min-w-0 flex-1 pt-0")}>
        <EmptyState title="Появится в следующих задачах" description="Шкала размеров подключается вместе с размерами блюд." />
      </TabsContent>
      <TabsContent value="recipe" className={cn(vertical && "min-w-0 flex-1 pt-0")}>
        <EmptyState title="Появится в следующих задачах" description="Технологическая карта подключается вместе с рецептурами." />
      </TabsContent>
      <TabsContent value="technology" className={cn(vertical && "min-w-0 flex-1 pt-0")}>
        <TechnologyTab card={card} draft={draft} set={set} readOnly={readOnly} />
      </TabsContent>
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <ProductThumb imageUrl={card.imageUrl} categoryLabel={card.categoryLabel ?? ""} size={56} />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-display text-title font-semibold">{draft.name.trim() || card.name}</h2>
                <TonePill tone="info">{ITEM_TYPE_LABELS[draft.itemType]}</TonePill>
              </div>
              <p className="text-body-sm text-muted-foreground">
                Артикул {draft.sku.trim() || "—"} · {groupLabel}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SaveStatus state={saving ? "saving" : dirty ? "dirty" : "saved"} />
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft aria-hidden />К списку
            </Button>
            {canSave ? (
              <Button onClick={() => void save(false)} disabled={!dirty || saving}>
                {dirty ? "Сохранить" : "Сохранено"}
              </Button>
            ) : null}
          </div>
        </header>

        {iiko ? (
          <Banner tone="info" title="Товар из iiko: изменения хранятся в Sandyq поверх данных iiko">
            Название, цена, место приготовления, способ списания, вес единицы и видимость в кассе меняются здесь; остальное приходит из iiko.
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="danger" title="Не удалось сохранить">
            {error}
          </Banner>
        ) : null}

        <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)} orientation={vertical ? "vertical" : "horizontal"} className={cn(vertical && "flex items-start gap-6")}>
          {vertical ? (
            <TabsList aria-label="Разделы карточки" className="w-60 shrink-0 flex-col gap-0 border-r border-b-0">
              {TABS.map((item) => (
                <TabsTrigger
                  key={item.key}
                  value={item.key}
                  className="mb-0 -mr-px h-10 w-full justify-start border-r-2 border-b-0 px-3 text-left data-[state=active]:bg-muted"
                >
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          ) : (
            <ScrollingTabsList />
          )}
          {panels}
        </Tabs>
      </div>

      {canSave ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-panel xl:px-8">
          <p className="text-caption text-muted-foreground">
            Источник: {iiko ? "iiko" : "Sandyq"} · статус: {draft.enabled ? "активна" : "скрыта"}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={!dirty || saving}>
              Отменить изменения
            </Button>
            <Button variant="secondary" onClick={() => void save(true)} disabled={!dirty || saving}>
              Сохранить и закрыть
            </Button>
          </div>
        </footer>
      ) : null}

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

/** Horizontal tabs that scroll instead of clipping «Технология приготовления», with edge shadows. */
function ScrollingTabsList() {
  const list = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const element = list.current
    if (!element) return
    setEdges({ left: element.scrollLeft > 0, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 })
  }, [])

  useEffect(() => {
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [measure])

  return (
    <div className="relative">
      <TabsList ref={list} aria-label="Разделы карточки" onScroll={measure} className="flex-nowrap overflow-x-auto [scrollbar-width:none]">
        {TABS.map((item) => (
          <TabsTrigger key={item.key} value={item.key} className="shrink-0 whitespace-nowrap">
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {edges.left ? <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-linear-to-r from-card to-transparent" /> : null}
      {edges.right ? <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-card to-transparent" /> : null}
    </div>
  )
}

// Category strip colour (POS-DESIGN §2.3) for rows without a photo, read from the group label.
const CATEGORY_TONES: Array<[RegExp, CategoryTone]> = [
  [/салат/i, "green"],
  [/выпечк|нан|баурсак/i, "bread"],
  [/десерт|тәтті|чай/i, "tea"],
  [/напит|сусын|фреш|лимонад/i, "dairy"],
  [/основн|втор|деликатес|суп|мяс/i, "meat"],
]
const TONE_STRIP: Record<CategoryTone, string> = {
  meat: "bg-cat-meat",
  dairy: "bg-cat-dairy",
  bread: "bg-cat-bread",
  green: "bg-cat-green",
  tea: "bg-cat-tea",
  turkistan: "bg-cat-turkistan",
}

export function ProductThumb({ imageUrl, categoryLabel, size = 40 }: { imageUrl: string | null; categoryLabel: string; size?: 40 | 56 }) {
  const [failed, setFailed] = useState(false)
  const tone = CATEGORY_TONES.find(([pattern]) => pattern.test(categoryLabel))?.[1]
  const box = size === 56 ? "size-14" : "size-10"
  if (imageUrl && !failed) {
    return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} className={cn(box, "shrink-0 rounded-control bg-muted object-cover")} />
  }
  return (
    <span aria-hidden data-testid="thumb-placeholder" className={cn(box, "relative shrink-0 overflow-hidden rounded-control bg-muted")}>
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", tone ? TONE_STRIP[tone] : "bg-border")} />
    </span>
  )
}
