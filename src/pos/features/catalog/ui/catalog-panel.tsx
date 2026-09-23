import { useState } from "react"

import { useCategories, useProducts } from "@/pos/features/catalog/data/use-catalog"
import { ProductCard } from "@/pos/components/product-card"
import { Button } from "@/shared/components/ui/button"
import { cn } from "@/shared/lib/utils"

export function CatalogPanel({ restaurantExternalId, onAddProduct }: { restaurantExternalId: string; onAddProduct: (product: { productId: string; name: string; nameKk: string; price: number }) => void }) {
  const categories = useCategories()
  const [activeCategory, setActiveCategory] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState("")
  const { items, loading, canLoadMore, loadMore } = useProducts({ restaurantExternalId, category: search ? undefined : activeCategory, search })

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-3">
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Поиск блюда…"
        className="h-11 rounded-[var(--radius-control)] border border-border bg-card px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
      />
      {!search && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setActiveCategory(undefined)}
            className={cn("shrink-0 rounded-full px-4 py-2 text-sm font-bold", !activeCategory ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
          >
            Все
          </button>
          {categories.map((category) => (
            <button
              key={category.externalId}
              type="button"
              onClick={() => setActiveCategory(category.externalId)}
              className={cn(
                "shrink-0 rounded-full px-4 py-2 text-sm font-bold",
                activeCategory === category.externalId ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {category.shortLabel}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Загрузка меню…</p>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Ничего не найдено</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 pb-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((product) => (
              <ProductCard
                key={product._id}
                name={product.name}
                nameKk={product.nameKk}
                price={product.price}
                onClick={() => onAddProduct({ productId: product._id, name: product.name, nameKk: product.nameKk, price: product.price })}
              />
            ))}
          </div>
        )}
        {canLoadMore && (
          <div className="pb-4 text-center">
            <Button variant="outline" onClick={loadMore}>
              Показать ещё
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
