import { Pencil, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import {
  Button,
  Checkbox,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  formatMoneyDigits,
  Input,
  MoneyInput,
  Select,
  SkeletonRows,
  Textarea,
  TonePill,
  type Column,
} from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { useOfficeCatalog, useOfficeCatalogMutations, type CategoryId, type OfficeCategory, type OfficeProduct, type ProductId } from "../data/use-office-catalog"

const UNITS = ["порц.", "шт", "кг", "л"] as const
const UNIT_OPTIONS = UNITS.map((unit) => ({ value: unit, label: unit }))

const categoryItemClass = cn(
  "flex h-9 min-w-0 flex-1 items-center rounded-control px-2 text-left text-body-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
  focusRingClass,
)
const categoryActiveClass = "bg-muted font-semibold text-foreground shadow-[inset_2px_0_0_var(--gold)]"

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

  const columns: Column<OfficeProduct>[] = [
    {
      key: "name",
      header: "Блюдо",
      sortValue: (product) => product.nameSort,
      cell: (product) => (
        <div className="flex flex-col">
          <span className="font-semibold text-foreground">{product.name}</span>
          <span className="text-caption text-muted-foreground">{product.nameKk}</span>
        </div>
      ),
    },
    { key: "sku", header: "SKU", sortValue: (product) => product.sku, cell: (product) => <span className="text-muted-foreground">{product.sku}</span> },
    { key: "price", header: "Базовая цена", numeric: true, sortValue: (product) => product.basePrice, cell: (product) => formatTenge(product.basePrice) },
    {
      key: "enabled",
      header: "В кассе",
      cell: (product) => (product.enabled ? <TonePill tone="success">Активно</TonePill> : <TonePill>Скрыто</TonePill>),
    },
    {
      key: "edit",
      header: <span className="sr-only">Действия</span>,
      className: "w-14 text-right",
      cell: (product) => (
        <Button variant="ghost" size="icon-sm" aria-label={`Редактировать «${product.name}»`} onClick={() => setEditingProduct(product)}>
          <Pencil />
        </Button>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-5">
        <SkeletonRows />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <nav aria-label="Категории" className="flex w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-3">
        <div className="mb-1 flex items-center justify-between pl-2">
          <p className="text-caption font-semibold text-muted-foreground">Категории</p>
          <Button variant="ghost" size="icon-sm" aria-label="Новая категория" onClick={() => setEditingCategory("new")}>
            <Plus />
          </Button>
        </div>
        <button type="button" onClick={() => setActiveCategory("all")} aria-current={activeCategory === "all" ? "true" : undefined} className={cn(categoryItemClass, activeCategory === "all" && categoryActiveClass)}>
          Все блюда ({products.length})
        </button>
        {categories.map((category) => {
          const count = products.filter((product) => product.category === category.externalId).length
          const active = activeCategory === category.externalId
          return (
            <div key={category._id} className="group flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setActiveCategory(category.externalId)}
                aria-current={active ? "true" : undefined}
                className={cn(categoryItemClass, active && categoryActiveClass, category.active === false && "opacity-45")}
              >
                <span className="truncate">
                  {category.label} ({count})
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Редактировать категорию «${category.label}»`}
                onClick={() => setEditingCategory(category)}
                className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Pencil />
              </Button>
            </div>
          )
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <p className="text-title-sm font-semibold text-foreground">Блюда</p>
          <Button size="sm" onClick={() => setEditingProduct("new")}>
            <Plus /> Добавить блюдо
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <DataTable
            caption="Блюда"
            columns={columns}
            rows={visibleProducts}
            getRowId={(product) => product._id}
            empty={<EmptyState title="Блюд пока нет" description="Добавьте блюдо, чтобы оно появилось в кассе." />}
          />
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

function CheckboxRow({ checked, onCheckedChange, children, className }: { checked: boolean; onCheckedChange: (checked: boolean) => void; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex items-center gap-2 text-body-sm font-medium text-foreground", className)}>
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      {children}
    </label>
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Название">{(control) => <Input {...control} value={label} onChange={(event) => setLabel(event.target.value)} required />}</Field>
          <Field label="Короткое название (для чека/кассы)">
            {(control) => <Input {...control} value={shortLabel} onChange={(event) => setShortLabel(event.target.value)} required />}
          </Field>
          <Field label="Порядок сортировки">
            {(control) => <Input {...control} type="number" inputMode="numeric" value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} />}
          </Field>
          {category ? (
            <CheckboxRow checked={active} onCheckedChange={setActive}>
              Активна (видна в кассе)
            </CheckboxRow>
          ) : null}
          {error ? (
            <p role="alert" className="text-body-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
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
  const [basePrice, setBasePrice] = useState<number | null>(product?.basePrice ?? 0)
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

  const categoryOptions = categories.map((option) => ({ value: option.externalId, label: option.label }))

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    // The native <select required> used to block submit without a category; Radix Select has no native validation.
    if (!category) {
      setError("Выберите категорию")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const categorySort = categories.find((candidate) => candidate.externalId === category)?.sortOrder ?? 0
      const common = { name, nameKk, description, category, categorySort, basePrice: basePrice ?? 0, sku, popular, badge: badge || undefined, baseUnit }
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Название (рус)">{(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} required />}</Field>
            <Field label="Атауы (қаз)">{(control) => <Input {...control} value={nameKk} onChange={(event) => setNameKk(event.target.value)} required />}</Field>
          </div>
          <Field label="Описание">{(control) => <Textarea {...control} value={description} onChange={(event) => setDescription(event.target.value)} className="resize-y" />}</Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Категория">{(control) => <Select {...control} value={category || undefined} onValueChange={setCategory} options={categoryOptions} />}</Field>
            <Field label="Ед. измерения">
              {(control) => <Select {...control} value={baseUnit} onValueChange={(value) => setBaseUnit(value as (typeof UNITS)[number])} options={UNIT_OPTIONS} />}
            </Field>
            <Field label="SKU">{(control) => <Input {...control} value={sku} onChange={(event) => setSku(event.target.value)} required />}</Field>
          </div>
          <div className="grid grid-cols-3 items-end gap-3">
            <Field label="Базовая цена">{(control) => <MoneyInput {...control} value={basePrice} onValueChange={setBasePrice} required />}</Field>
            <Field label="Бейдж (напр. «Хит»)">{(control) => <Input {...control} value={badge} onChange={(event) => setBadge(event.target.value)} />}</Field>
            <CheckboxRow checked={popular} onCheckedChange={setPopular} className="h-[var(--control-h)]">
              Популярное
            </CheckboxRow>
          </div>

          {product ? (
            <CheckboxRow checked={enabled} onCheckedChange={setEnabled}>
              Активно (видно в кассе)
            </CheckboxRow>
          ) : null}

          <fieldset className="flex flex-col gap-3 rounded-card border border-border p-3">
            <legend className="px-1 text-body-sm font-semibold text-foreground">Цена по филиалам</legend>
            <p className="text-caption text-muted-foreground">Пусто — используется базовая цена</p>
            <div className="grid grid-cols-2 gap-3">
              {restaurants.map((restaurant) => {
                const raw = prices[restaurant.externalId]
                return (
                  <Field key={restaurant.externalId} label={restaurant.name}>
                    {(control) => (
                      <MoneyInput
                        {...control}
                        placeholder={formatMoneyDigits(String(basePrice ?? 0))}
                        value={raw ? Number(raw) : null}
                        onValueChange={(value) => setPrices((current) => ({ ...current, [restaurant.externalId]: value === null ? "" : String(value) }))}
                      />
                    )}
                  </Field>
                )
              })}
            </div>
          </fieldset>

          {error ? (
            <p role="alert" className="text-body-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
