import { Pencil, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/shared/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, formatTenge } from "@/shared/lib/utils"

import { useOfficeCatalog, useOfficeCatalogMutations, type CategoryId, type OfficeCategory, type OfficeProduct, type ProductId } from "../data/use-office-catalog"

const UNITS = ["порц.", "шт", "кг", "л"] as const

const inputClass = "h-11 rounded-[var(--radius-control)] border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"

export function CatalogWorkspace() {
  const { categories, products, restaurants, loading } = useOfficeCatalog()
  const mutations = useOfficeCatalogMutations()
  const [activeCategory, setActiveCategory] = useState<string | "all">("all")
  const [editingCategory, setEditingCategory] = useState<OfficeCategory | "new" | null>(null)
  const [editingProduct, setEditingProduct] = useState<OfficeProduct | "new" | null>(null)

  const visibleProducts = useMemo(
    () => (activeCategory === "all" ? products : products.filter((product) => product.category === activeCategory)).sort((left, right) => left.nameSort.localeCompare(right.nameSort, "ru")),
    [products, activeCategory],
  )

  if (loading) {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Загрузка…</div>
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Категории</p>
          <button type="button" onClick={() => setEditingCategory("new")} className="grid size-6 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-muted hover:text-foreground">
            <Plus className="size-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setActiveCategory("all")}
          className={cn("flex h-8 items-center rounded-[var(--radius-control)] px-2 text-left text-sm font-semibold text-muted-foreground hover:bg-muted", activeCategory === "all" && "bg-primary/10 text-primary")}
        >
          Все блюда ({products.length})
        </button>
        {categories.map((category) => {
          const count = products.filter((product) => product.category === category.externalId).length
          return (
            <div key={category._id} className="group flex items-center">
              <button
                type="button"
                onClick={() => setActiveCategory(category.externalId)}
                className={cn(
                  "flex h-8 min-w-0 flex-1 items-center rounded-[var(--radius-control)] px-2 text-left text-sm font-semibold text-muted-foreground hover:bg-muted",
                  activeCategory === category.externalId && "bg-primary/10 text-primary",
                  category.active === false && "opacity-45",
                )}
              >
                <span className="truncate">{category.label} ({count})</span>
              </button>
              <button type="button" onClick={() => setEditingCategory(category)} className="grid size-6 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100">
                <Pencil className="size-3" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="text-sm font-extrabold text-foreground">Блюда</p>
          <Button size="sm" onClick={() => setEditingProduct("new")}>
            <Plus className="size-3.5" /> Добавить блюдо
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left">Блюдо</th>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-right">Базовая цена</th>
                <th className="px-3 py-2 text-center">Активно</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((product) => (
                <tr key={product._id} className="border-t border-border/60 hover:bg-muted/40">
                  <td className="px-5 py-2">
                    <p className="font-semibold text-foreground">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{product.nameKk}</p>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{product.sku}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatTenge(product.basePrice)}</td>
                  <td className="px-3 py-2 text-center">{product.enabled ? "✓" : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => setEditingProduct(product)} className="grid size-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-muted hover:text-foreground">
                      <Pencil className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {!visibleProducts.length && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted-foreground">Блюд пока нет</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingCategory ? (
        <CategoryDialog
          category={editingCategory === "new" ? null : editingCategory}
          nextSortOrder={categories.length}
          onClose={() => setEditingCategory(null)}
          onCreate={mutations.createCategory}
          onUpdate={mutations.updateCategory}
        />
      ) : null}

      {editingProduct ? (
        <ProductDialog
          product={editingProduct === "new" ? null : editingProduct}
          categories={categories}
          restaurants={restaurants}
          defaultCategory={activeCategory === "all" ? categories[0]?.externalId ?? "" : activeCategory}
          onClose={() => setEditingProduct(null)}
          onCreate={mutations.createProduct}
          onUpdate={mutations.updateProduct}
          onSetPrice={mutations.setProductPrice}
        />
      ) : null}
    </div>
  )
}

function CategoryDialog({
  category,
  nextSortOrder,
  onClose,
  onCreate,
  onUpdate,
}: {
  category: OfficeCategory | null
  nextSortOrder: number
  onClose: () => void
  onCreate: (args: { label: string; shortLabel: string; sortOrder: number }) => Promise<CategoryId>
  onUpdate: (args: { categoryId: CategoryId; label: string; shortLabel: string; sortOrder: number; active: boolean }) => Promise<unknown>
}) {
  const [label, setLabel] = useState(category?.label ?? "")
  const [shortLabel, setShortLabel] = useState(category?.shortLabel ?? "")
  const [sortOrder, setSortOrder] = useState(category?.sortOrder ?? nextSortOrder)
  const [active, setActive] = useState(category?.active !== false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (category) await onUpdate({ categoryId: category._id, label, shortLabel, sortOrder, active })
      else await onCreate({ label, shortLabel, sortOrder })
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить категорию"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? "Категория" : "Новая категория"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Название">
            <input value={label} onChange={(event) => setLabel(event.target.value)} className={inputClass} required />
          </Field>
          <Field label="Короткое название (для чека/кассы)">
            <input value={shortLabel} onChange={(event) => setShortLabel(event.target.value)} className={inputClass} required />
          </Field>
          <Field label="Порядок сортировки">
            <input type="number" value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} className={inputClass} />
          </Field>
          {category ? (
            <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
              Активна (видна в кассе)
            </label>
          ) : null}
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="mt-2">{submitting ? "Сохранение…" : "Сохранить"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProductDialog({
  product,
  categories,
  restaurants,
  defaultCategory,
  onClose,
  onCreate,
  onUpdate,
  onSetPrice,
}: {
  product: OfficeProduct | null
  categories: OfficeCategory[]
  restaurants: { externalId: string; name: string }[]
  defaultCategory: string
  onClose: () => void
  onCreate: (args: { name: string; nameKk: string; description: string; category: string; categorySort: number; basePrice: number; sku: string; popular: boolean; badge?: string; baseUnit: (typeof UNITS)[number] }) => Promise<ProductId>
  onUpdate: (args: { productId: ProductId; name: string; nameKk: string; description: string; category: string; categorySort: number; basePrice: number; sku: string; popular: boolean; badge?: string; baseUnit: (typeof UNITS)[number]; enabled: boolean }) => Promise<unknown>
  onSetPrice: (args: { productId: ProductId; restaurantExternalId: string; priceKzt: number }) => Promise<unknown>
}) {
  const [name, setName] = useState(product?.name ?? "")
  const [nameKk, setNameKk] = useState(product?.nameKk ?? "")
  const [description, setDescription] = useState(product?.description ?? "")
  const [category, setCategory] = useState(product?.category ?? defaultCategory)
  const [basePrice, setBasePrice] = useState(product?.basePrice ?? 0)
  const [sku, setSku] = useState(product?.sku ?? "")
  const [popular, setPopular] = useState(product?.popular ?? false)
  const [badge, setBadge] = useState(product?.badge ?? "")
  const [baseUnit, setBaseUnit] = useState<(typeof UNITS)[number]>((product?.baseUnit as (typeof UNITS)[number]) ?? "порц.")
  const [enabled, setEnabled] = useState(product?.enabled ?? true)
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const price of product?.prices ?? []) map[price.restaurantExternalId] = String(price.priceKzt)
    return map
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const categorySort = categories.find((candidate) => candidate.externalId === category)?.sortOrder ?? 0
      const common = { name, nameKk, description, category, categorySort, basePrice, sku, popular, badge: badge || undefined, baseUnit }
      const productId = product ? product._id : await onCreate(common)
      if (product) await onUpdate({ productId, ...common, enabled })
      for (const [restaurantExternalId, raw] of Object.entries(prices)) {
        const priceKzt = Number(raw)
        if (!raw || !Number.isFinite(priceKzt) || priceKzt <= 0) continue
        const original = product?.prices.find((price) => price.restaurantExternalId === restaurantExternalId)?.priceKzt
        if (original === priceKzt) continue
        await onSetPrice({ productId, restaurantExternalId, priceKzt })
      }
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить блюдо"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{product ? product.name : "Новое блюдо"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Название (рус)"><input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} required /></Field>
            <Field label="Атауы (қаз)"><input value={nameKk} onChange={(event) => setNameKk(event.target.value)} className={inputClass} required /></Field>
          </div>
          <Field label="Описание"><textarea value={description} onChange={(event) => setDescription(event.target.value)} className={cn(inputClass, "min-h-16 resize-y")} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Категория">
              <select value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass} required>
                {categories.map((option) => <option key={option._id} value={option.externalId}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Ед. измерения">
              <select value={baseUnit} onChange={(event) => setBaseUnit(event.target.value as (typeof UNITS)[number])} className={inputClass}>
                {UNITS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Field>
            <Field label="SKU"><input value={sku} onChange={(event) => setSku(event.target.value)} className={inputClass} required /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Базовая цена, ₸"><input type="number" value={basePrice} onChange={(event) => setBasePrice(Number(event.target.value))} className={inputClass} required min={0} /></Field>
            <Field label="Бейдж (напр. «Хит»)"><input value={badge} onChange={(event) => setBadge(event.target.value)} className={inputClass} /></Field>
            <label className="mt-6 flex items-center gap-2 text-sm font-semibold text-foreground">
              <input type="checkbox" checked={popular} onChange={(event) => setPopular(event.target.checked)} />
              Популярное
            </label>
          </div>

          {product ? (
            <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              Активно (видно в кассе)
            </label>
          ) : null}

          <div className="rounded-[var(--radius-card)] border border-border p-3">
            <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Цена по филиалам (₸)</p>
            <p className="mb-2 text-xs text-muted-foreground">Пусто — используется базовая цена</p>
            <div className="grid grid-cols-2 gap-2">
              {restaurants.map((restaurant) => (
                <label key={restaurant.externalId} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted-foreground">{restaurant.name}</span>
                  <input
                    type="number"
                    min={0}
                    placeholder={String(basePrice)}
                    value={prices[restaurant.externalId] ?? ""}
                    onChange={(event) => setPrices((current) => ({ ...current, [restaurant.externalId]: event.target.value }))}
                    className={inputClass}
                  />
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="mt-1">{submitting ? "Сохранение…" : "Сохранить"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
