import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { useEffect, useState } from "react"

import { api } from "../../../../../convex/_generated/api"

// Stock reference data (W1-STK-03…07) over convex/domains/stock/master: units, warehouses, suppliers,
// inventory items and balances. The server checks every right and scope again.

const master = api.domains.stock.master

export const STOCK_PAGE_SIZE = 50
/** One page of items for pickers; the Combobox searches the server beyond it. */
export const ITEM_PICKER_SIZE = 50

export type Unit = FunctionReturnType<typeof master.listUnits>[number]
export type UnitDimension = Unit["dimension"]
export type SaveUnitArgs = FunctionArgs<typeof master.saveUnit>
export type Warehouse = FunctionReturnType<typeof master.listWarehouses>[number]
export type WarehouseKind = Warehouse["kind"]
export type WarehouseOption = FunctionReturnType<typeof master.listWarehouseOptions>[number]
export type SaveWarehouseArgs = FunctionArgs<typeof master.saveWarehouse>
export type Supplier = FunctionReturnType<typeof master.listSuppliers>["page"][number]
export type SupplierPolicy = Supplier["priceDeviationPolicy"]
export type SaveSupplierArgs = FunctionArgs<typeof master.saveSupplier>
export type InventoryItem = FunctionReturnType<typeof master.listInventoryItems>["page"][number]
export type InventoryItemKind = NonNullable<InventoryItem["kind"]>
export type SaveInventoryItemArgs = FunctionArgs<typeof master.saveInventoryItem>
export type BalanceRow = FunctionReturnType<typeof master.listBalances>["page"][number]
export type BalanceFilter = NonNullable<FunctionArgs<typeof master.listBalances>["filter"]>

export const DIMENSION_LABELS: Record<UnitDimension, string> = { mass: "Масса", volume: "Объём", count: "Количество", portion: "Порция" }

export const WAREHOUSE_KIND_LABELS: Record<WarehouseKind, string> = { storage: "Склад", kitchen: "Кухня", bar: "Бар", distribution: "Распределительный" }

export const SUPPLIER_POLICY: Record<SupplierPolicy, { label: string; hint: string }> = {
  ignore: { label: "Не проверять", hint: "Цена прихода не сравнивается со средней." },
  warn: { label: "Предупреждать", hint: "Отклонение больше допустимого — предупреждение при проведении." },
  block: { label: "Запрещать", hint: "Отклонение больше допустимого в любую сторону не даст провести приход." },
  "block-higher": { label: "Запрещать рост цены", hint: "Рост цены больше допустимого не даст провести приход, снижение — предупреждение." },
}

export const ITEM_KIND_LABELS: Record<InventoryItemKind, string> = { ingredient: "Ингредиент", preparation: "Заготовка", good: "Товар", service: "Услуга", modifier: "Модификатор" }

export const BALANCE_TABS: { value: BalanceFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "belowMinimum", label: "Ниже минимума" },
  { value: "aboveMaximum", label: "Выше максимума" },
  { value: "negative", label: "Отрицательные" },
]

/** «×0,001» — coefficient to the base unit with a Russian comma. */
export function formatCoefficient(value: number) {
  return `×${String(Math.round(value * 1_000_000) / 1_000_000).replace(".", ",")}`
}

/** "0,001" / "0.001" → 0.001; empty or garbage → null. */
export function parseDecimal(text: string): number | null {
  const clean = text.trim().replace(/\s/g, "").replace(",", ".")
  if (!clean) return null
  const value = Number(clean)
  return Number.isFinite(value) ? value : null
}

export function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

// ── Units ──

export function useUnits(search = "") {
  return useQuery(master.listUnits, { search: search.trim() || undefined })
}

export function useSaveUnit() {
  return useMutation(master.saveUnit)
}

// ── Warehouses ──

export function useWarehouses(restaurantExternalId?: string) {
  return useQuery(master.listWarehouses, restaurantExternalId ? { restaurantExternalId } : {})
}

/** Active warehouses in scope for pickers; `enabled: false` skips the query (no office.stock.view). */
export function useWarehouseOptions(enabled = true) {
  return useQuery(master.listWarehouseOptions, enabled ? {} : "skip")
}

export function useSaveWarehouse() {
  return useMutation(master.saveWarehouse)
}

// ── Suppliers ──

export function useSuppliers(search: string) {
  return usePaginatedQuery(master.listSuppliers, { search: search.trim() || undefined }, { initialNumItems: STOCK_PAGE_SIZE })
}

/** Active suppliers for a picker (first page; the list is small). */
export function useSupplierOptions(enabled = true) {
  const page = useQuery(master.listSuppliers, enabled ? { activeOnly: true, paginationOpts: { numItems: 200, cursor: null } } : "skip")
  return page?.page
}

export function useSaveSupplier() {
  return useMutation(master.saveSupplier)
}

// ── Inventory items ──

/** Item picker: one page of active items matching the typed text (server search index). */
export function useInventoryItemSearch(search: string, enabled = true) {
  const debounced = useDebounced(search)
  const page = useQuery(master.listInventoryItems, enabled ? { search: debounced.trim() || undefined, activeOnly: true, paginationOpts: { numItems: ITEM_PICKER_SIZE, cursor: null } } : "skip")
  return page?.page
}

/** The full item behind a balance row: there is no get-by-id query, so it is found by name search. */
export function useInventoryItem(externalId: string | undefined, name: string | undefined) {
  const page = useQuery(master.listInventoryItems, externalId && name ? { search: name, paginationOpts: { numItems: 20, cursor: null } } : "skip")
  if (!externalId) return null
  if (page === undefined) return undefined
  return page.page.find((item) => item.externalId === externalId) ?? null
}

export function useSaveInventoryItem() {
  return useMutation(master.saveInventoryItem)
}

// ── Balances ──

export function useBalances(args: { warehouseExternalId?: string; at?: number; filter: BalanceFilter }) {
  return usePaginatedQuery(
    master.listBalances,
    { warehouseExternalId: args.warehouseExternalId, at: args.at, filter: args.filter === "all" ? undefined : args.filter },
    { initialNumItems: STOCK_PAGE_SIZE },
  )
}
