import { useMemo, useState } from "react"
import { Search } from "lucide-react"

import { useCategories, useProducts } from "@/pos/features/catalog/data/use-catalog"
import { ProductCard } from "@/pos/components/product-card"
import { Button } from "@/shared/components/ui/button"
import { Chip, type CategoryTone } from "@/shared/components/ui/chip"
import { Input } from "@/shared/components/ui/input"

// Category strip colour (POS-DESIGN §2.3). Categories carry no tone field yet, so it is read from the
// bilingual label; categories that match nothing (sauces, garnishes, «Прочее») get no strip.
// --cat-turkistan is reserved for dishes marked Туркестан and is never assigned to a category.
const CATEGORY_TONES: Array<[RegExp, CategoryTone]> = [
  [/салат/i, "green"],
  [/выпечк|нан-тоқаш|баурсак/i, "bread"],
  [/десерт|тәтті|чай/i, "tea"],
  [/напит|сусын|фреш|лимонад/i, "dairy"],
  [/основн|втор|деликатес|суп|компанию/i, "meat"],
]

function categoryTone(label: string): CategoryTone | undefined {
  return CATEGORY_TONES.find(([pattern]) => pattern.test(label))?.[1]
}

export function CatalogPanel({ sessionToken, onAddProduct }: { sessionToken: string; onAddProduct: (product: { productId: string; name: string; nameKk: string; price: number }) => void }) {
  const categories = useCategories(sessionToken)
  const [activeCategory, setActiveCategory] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState("")
  const { items, loading, canLoadMore, loadMore } = useProducts({ sessionToken, category: search ? undefined : activeCategory, search })
  const toneByCategory = useMemo(() => new Map(categories.map((category) => [category.externalId, categoryTone(category.label)] as const)), [categories])

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск блюда…"
          aria-label="Поиск блюда"
          className="h-[var(--control-h-pos)] pl-10 text-body"
        />
      </div>
      {!search && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          <Chip size="lg" active={!activeCategory} onClick={() => setActiveCategory(undefined)}>
            Все
          </Chip>
          {categories.map((category) => (
            <Chip
              key={category.externalId}
              size="lg"
              tone={categoryTone(category.label)}
              active={activeCategory === category.externalId}
              onClick={() => setActiveCategory(category.externalId)}
            >
              {category.shortLabel}
            </Chip>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-4 text-body-sm text-muted-foreground">Загрузка меню…</p>
        ) : items.length === 0 ? (
          <p className="p-4 text-body-sm text-muted-foreground">Ничего не найдено</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 pb-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((product) => (
              <ProductCard
                key={product._id}
                name={product.name}
                nameKk={product.nameKk}
                price={product.price}
                tone={toneByCategory.get(product.category)}
                onClick={() => onAddProduct({ productId: product._id, name: product.name, nameKk: product.nameKk, price: product.price })}
              />
            ))}
          </div>
        )}
        {canLoadMore && (
          <div className="pb-4 text-center">
            <Button variant="secondary" onClick={loadMore}>
              Показать ещё
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
