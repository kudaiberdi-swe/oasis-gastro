import type { Doc } from "../../../_generated/dataModel"
import type { Calculator } from "../registry"
import { aggregate, col, dayEnd, dayStart, SCAN_BUDGET } from "./_shared"
import { STOCK_W2_CALCULATORS } from "./stockW2"

// Stock reports (W1-RPT-07). Warehouses of the restaurants in scope; movements streamed over index
// ranges with a budget (truncated beyond it).

async function warehousesOf(ctx: Parameters<Calculator>[0], restaurants: string[]) {
  const rows: Doc<"warehouses">[] = []
  for (const restaurant of restaurants) rows.push(...(await ctx.db.query("warehouses").withIndex("by_restaurant_active", (q) => q.eq("restaurantExternalId", restaurant).eq("active", true)).take(50)))
  return rows
}

function balanceReport(filter: (item: Doc<"inventoryItems">, quantity: number) => boolean, title: string): Calculator {
  return async (ctx, _config, restaurants) => {
    const columns = [col("group", "Номенклатура", "text"), col("warehouse", "Склад", "text"), col("quantity", "Количество", "quantity"), col("minimum", "Минимум", "quantity"), col("averageCost", "Ср. цена", "money"), col("value", "Стоимость", "money")]
    const rows = []
    let scanned = 0
    for (const warehouse of await warehousesOf(ctx, restaurants)) {
      for await (const balance of ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", warehouse._id))) {
        if ((scanned += 1) > SCAN_BUDGET) break
        const item = await ctx.db.get(balance.inventoryItemId)
        if (!item || !filter(item, balance.quantity)) continue
        rows.push({ key: `${warehouse._id}:${item._id}`, label: item.name, text: { warehouse: warehouse.name }, values: { quantity: balance.quantity, minimum: item.minimumStock ?? 0, averageCost: balance.averageUnitCost, value: Math.round(balance.quantity * balance.averageUnitCost) } })
      }
    }
    const result = aggregate(rows, columns, "value")
    return { sourceLabel: title, columns, ...result, kpis: [{ key: "value", label: "Стоимость остатков", value: Math.round(result.totals.value ?? 0), unit: "money" }], truncated: scanned > SCAN_BUDGET }
  }
}

const KIND_LABEL: Record<string, string> = { receipt: "Приход", writeoff: "Списание", adjustment: "Корректировка", document: "Документ", production: "Производство", sale: "Продажа", reversal: "Сторно" }

const stockMovement: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Номенклатура", "text"), col("opening", "Начальный остаток", "quantity"), col("incoming", "Приход", "quantity"), col("outgoing", "Расход", "quantity"), col("closing", "Конечный остаток", "quantity")]
  const from = dayStart(config.dateFrom)
  const to = dayEnd(config.dateTo)
  const perItem = new Map<string, { label: string; opening?: number; incoming: number; outgoing: number; closing?: number }>()
  let scanned = 0
  for (const warehouse of await warehousesOf(ctx, restaurants)) {
    const balances = await ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", warehouse._id)).take(200)
    for (const balance of balances) {
      const item = await ctx.db.get(balance.inventoryItemId)
      if (!item) continue
      const key = `${warehouse._id}:${item._id}`
      const row = { label: `${item.name} · ${warehouse.shortName}`, incoming: 0, outgoing: 0 } as { label: string; opening?: number; incoming: number; outgoing: number; closing?: number }
      const before = await ctx.db.query("stockMovements").withIndex("by_warehouse_item_occurred", (q) => q.eq("warehouseId", warehouse._id).eq("inventoryItemId", item._id).lt("occurredAt", from)).order("desc").first()
      row.opening = before?.balanceAfter ?? 0
      for await (const movement of ctx.db.query("stockMovements").withIndex("by_warehouse_item_occurred", (q) => q.eq("warehouseId", warehouse._id).eq("inventoryItemId", item._id).gte("occurredAt", from).lte("occurredAt", to))) {
        if ((scanned += 1) > SCAN_BUDGET) break
        if (movement.quantityDelta >= 0) row.incoming += movement.quantityDelta
        else row.outgoing -= movement.quantityDelta
        row.closing = movement.balanceAfter
      }
      row.closing ??= row.opening
      if (row.incoming || row.outgoing || row.opening) perItem.set(key, row)
    }
  }
  const rows = [...perItem.entries()].map(([key, row]) => ({ key, label: row.label, values: { opening: row.opening ?? 0, incoming: row.incoming, outgoing: row.outgoing, closing: row.closing ?? 0 } }))
  return { sourceLabel: "Движения склада", columns, ...aggregate(rows, columns, "outgoing"), kpis: [], truncated: scanned > SCAN_BUDGET }
}

const purchases: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Поставщик", "text"), col("documents", "Накладных", "count"), col("net", "Без НДС", "money"), col("vat", "НДС", "money"), col("gross", "Сумма", "money")]
  const rows = []
  for (const restaurant of restaurants) {
    for await (const receipt of ctx.db.query("receipts").withIndex("by_restaurant_status_date", (q) => q.eq("restaurantExternalId", restaurant).eq("status", "posted").gte("date", dayStart(config.dateFrom)).lte("date", dayEnd(config.dateTo)))) {
      const supplier = await ctx.db.get(receipt.supplierId)
      rows.push({ key: String(receipt.supplierId), label: supplier?.name ?? "Поставщик", values: { documents: 1, net: receipt.totalNet, vat: receipt.totalVat, gross: receipt.totalGross } })
    }
  }
  const result = aggregate(rows, columns, "gross")
  return { sourceLabel: "Проведённые приходные накладные", columns, ...result, kpis: [{ key: "gross", label: "Закуплено", value: result.totals.gross ?? 0, unit: "money" }], truncated: false }
}

function documentLines(type: "inventory" | "writeoff"): Calculator {
  return async (ctx, config, restaurants) => {
    const inventory = type === "inventory"
    const columns = inventory
      ? [col("group", "Номенклатура", "text"), col("expected", "По учёту", "quantity"), col("actual", "Факт", "quantity"), col("difference", "Излишек / недостача", "quantity"), col("amount", "Сумма", "money")]
      : [col("group", "Причина", "text"), col("documents", "Документов", "count"), col("quantity", "Количество", "quantity"), col("amount", "Сумма", "money")]
    const rows = []
    for (const restaurant of restaurants) {
      for await (const document of ctx.db.query("stockDocuments").withIndex("by_type_restaurant_status_date", (q) => q.eq("type", type).eq("restaurantExternalId", restaurant).eq("status", "posted").gte("date", dayStart(config.dateFrom)).lte("date", dayEnd(config.dateTo)))) {
        const lines = await ctx.db.query("stockDocumentLines").withIndex("by_document", (q) => q.eq("documentId", document._id)).take(200)
        if (!inventory) {
          rows.push({ key: document.reason || "—", label: document.reason || "Без причины", values: { documents: 1, quantity: document.totalQuantity, amount: document.totalAmount } })
          continue
        }
        for (const line of lines) {
          const item = await ctx.db.get(line.inventoryItemId)
          const expected = line.expectedQuantity ?? 0
          const actual = line.actualQuantity ?? expected
          rows.push({ key: String(line.inventoryItemId), label: item?.name ?? "—", values: { expected, actual, difference: actual - expected, amount: Math.round((actual - expected) * line.unitCost) } })
        }
      }
    }
    return { sourceLabel: inventory ? "Проведённые инвентаризации" : "Проведённые акты списания", columns, ...aggregate(rows, columns, "amount"), kpis: [], truncated: false }
  }
}

export const STOCK_CALCULATORS: Record<string, Calculator> = {
  "stock-01": balanceReport(() => true, "Остатки по складам"),
  "stock-03": balanceReport((item, quantity) => item.minimumStock !== undefined && quantity < item.minimumStock, "Остатки ниже минимума"),
  "stock-07": stockMovement,
  "stock-09": purchases,
  "stock-24": documentLines("inventory"),
  "stock-25": documentLines("writeoff"),
  ...STOCK_W2_CALCULATORS, // W2-RPT-02
}
