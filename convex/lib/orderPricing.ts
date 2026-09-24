import { ConvexError } from "convex/values"
import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"
import { isAvailable } from "./availability"
import { validateAndPriceModifiers, type KitchenModifier, type PricedModifier } from "./modifierPricing"
import { calculateDiscountAmount, roundKzt } from "./money"
import { DISCOUNT_APPROVAL_PERCENT, SERVICE_CHARGE_PERCENT } from "./policy"
import { resolvePrice, resolveSizedPrice } from "./pricing"
import { activeSettingsAt, settingInForce, settingVersionTag } from "./retailSettings"

type QueryCtx = GenericQueryCtx<DataModel>
type ServiceMode = "dine-in" | "takeaway" | "delivery"

// Server-side pricing of a POS draft (W1-POS-03): the client's prices are never trusted.

export type DraftLine = {
  clientLineId?: string
  productId: Id<"products">
  quantity: number
  modifiers?: string[]
  sizeExternalId?: string
  modifierSelections?: { modifierExternalId: string; quantity: number }[]
}

export type PricedLine = {
  clientLineId?: string
  product: Doc<"products">
  quantity: number
  unitPrice: number
  modifiers: string[]
  sizeOption?: Doc<"sizeOptions">
  modifierSelections?: PricedModifier[]
  kitchenModifiers?: KitchenModifier[]
  lineTotal: number
}

async function sizeOptionFor(ctx: QueryCtx, product: Doc<"products">, sizeExternalId: string | undefined) {
  if (!product.sizeScaleId) {
    if (sizeExternalId) throw new ConvexError(`У «${product.name}» нет размеров`)
    return undefined
  }
  const options = await ctx.db.query("sizeOptions").withIndex("by_scale_sort", (q) => q.eq("scaleId", product.sizeScaleId!)).take(50)
  const option = sizeExternalId ? options.find((row) => row.externalId === sizeExternalId) : (options.find((row) => row.isDefault) ?? options[0])
  if (!option) throw new ConvexError(`Выберите размер «${product.name}»`)
  if (!option.available) throw new ConvexError(`Размер «${option.label}» недоступен`)
  return option
}

export async function priceDraftLines(ctx: QueryCtx, restaurantExternalId: string, lines: DraftLine[], at: number): Promise<PricedLine[]> {
  const result: PricedLine[] = []
  for (const input of lines) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 99) throw new ConvexError("Некорректное количество")
    const product = await ctx.db.get(input.productId)
    if (!product?.enabled) throw new ConvexError("Позиция недоступна")
    if (!(await isAvailable(ctx, product._id, restaurantExternalId, at))) throw new ConvexError(`«${product.name}» сейчас нет в наличии`)
    const sizeOption = await sizeOptionFor(ctx, product, input.sizeExternalId)
    const { price: unitPrice } = sizeOption ? await resolveSizedPrice(ctx, { product, restaurantExternalId, at, sizeOption }) : await resolvePrice(ctx, { product, restaurantExternalId, at })
    // Clients that do not send modifierSelections yet (before the POS modifier dialog) keep free-text notes only.
    const modifiers = input.modifierSelections
      ? await validateAndPriceModifiers(ctx, product, input.modifierSelections.map((selection) => ({ externalId: selection.modifierExternalId, quantity: selection.quantity })))
      : null
    const modifierUnit = (modifiers?.priced ?? []).reduce((sum, modifier) => sum + modifier.unitPrice * modifier.quantity, 0)
    result.push({
      clientLineId: input.clientLineId,
      product,
      quantity: input.quantity,
      unitPrice,
      modifiers: input.modifiers ?? [],
      sizeOption,
      modifierSelections: modifiers?.priced,
      kitchenModifiers: modifiers?.kitchenModifiers,
      lineTotal: roundKzt((unitPrice + modifierUnit) * input.quantity),
    })
  }
  return result
}

export type ResolvedOrderType = { externalId?: string; name: string; serviceMode: ServiceMode; serviceChargePercent: number; tag?: string }

const ORDER_TYPE_NAME: Record<ServiceMode, string> = { "dine-in": "В зале", takeaway: "С собой", delivery: "Доставка" }

/** The order type: by id from activeForPos, or by the legacy service mode; before retail settings, D5 defaults. */
export async function resolveOrderType(ctx: QueryCtx, restaurantExternalId: string, input: { orderTypeExternalId?: string; orderType?: ServiceMode }, at: number): Promise<ResolvedOrderType> {
  let row: Doc<"retailSettings"> | undefined
  if (input.orderTypeExternalId) row = await settingInForce(ctx, "order-type", input.orderTypeExternalId, restaurantExternalId, at, "Тип заказа")
  else if (input.orderType) {
    const mode = input.orderType
    const active = await activeSettingsAt(ctx, "order-type", restaurantExternalId, at)
    row = active.find((setting) => setting.code === mode) ?? active.find((setting) => setting.data.kind === "order-type" && setting.data.serviceMode === mode)
    if (!row) return { name: ORDER_TYPE_NAME[mode], serviceMode: mode, serviceChargePercent: mode === "dine-in" ? SERVICE_CHARGE_PERCENT : 0 }
  } else throw new ConvexError("Выберите тип заказа")
  if (row.data.kind !== "order-type") throw new ConvexError("Тип заказа недоступен на этой кассе")
  return { externalId: row.externalId, name: row.name, serviceMode: row.data.serviceMode, serviceChargePercent: row.data.serviceChargePercent, tag: settingVersionTag(row) }
}

export type ResolvedDiscount = { externalId?: string; name?: string; amount: number; percent: number; needsManager: boolean; reason?: string; tag?: string }

/**
 * The discount of a draft: a discount type (percent, fixed or markup, with its minimum order and
 * manager threshold) or the legacy free percent with a reason (threshold DISCOUNT_APPROVAL_PERCENT).
 * A markup is a negative discount.
 */
export async function resolveDiscount(
  ctx: QueryCtx,
  restaurantExternalId: string,
  input: { discountTypeExternalId?: string; discountPercent: number; discountReason?: string },
  subtotal: number,
  at: number,
): Promise<ResolvedDiscount> {
  if (input.discountTypeExternalId) {
    const row = await settingInForce(ctx, "discount-type", input.discountTypeExternalId, restaurantExternalId, at, "Скидка")
    if (row.data.kind !== "discount-type") throw new ConvexError("Скидка недоступна на этой кассе")
    const data = row.data
    if (!data.manual) throw new ConvexError(`«${row.name}» применяется автоматически`)
    if (subtotal < data.minimumOrder) throw new ConvexError(`«${row.name}» — от ${data.minimumOrder} ₸`)
    const amount =
      data.mode === "percent" ? calculateDiscountAmount(subtotal, data.value)
      : data.mode === "fixed" ? Math.min(roundKzt(data.value), subtotal)
      : data.mode === "markup" ? -calculateDiscountAmount(subtotal, data.value)
      : null
    if (amount === null) throw new ConvexError(`«${row.name}» пока нельзя применить на кассе`)
    const share = subtotal > 0 ? (Math.abs(amount) / subtotal) * 100 : 0
    return { externalId: row.externalId, name: row.name, amount, percent: data.mode === "percent" ? data.value : 0, needsManager: share > data.managerApprovalAbove, reason: row.name, tag: settingVersionTag(row) }
  }
  if (input.discountPercent < 0 || input.discountPercent > 100) throw new ConvexError("Некорректная скидка")
  if (input.discountPercent > 0 && (input.discountReason?.trim().length ?? 0) < 3) throw new ConvexError("Для скидки укажите причину")
  return { amount: calculateDiscountAmount(subtotal, input.discountPercent), percent: input.discountPercent, needsManager: input.discountPercent > DISCOUNT_APPROVAL_PERCENT, reason: input.discountReason?.trim() || undefined }
}
