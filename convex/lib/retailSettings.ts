import { ConvexError, type Infer } from "convex/values"
import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"
import type { retailSettingData } from "../domains/retail/validators"
import { isSystemAccountKey, SYSTEM_ACCOUNTS } from "./accounts"

type QueryCtx = GenericQueryCtx<DataModel>
export type RetailSettingData = Infer<typeof retailSettingData>

async function assertAccount(ctx: QueryCtx, reference: string | undefined, label: string) {
  if (!reference) return
  const externalId = isSystemAccountKey(reference) ? SYSTEM_ACCOUNTS[reference].externalId : reference
  const account = await ctx.db.query("accounts").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!account?.active) throw new ConvexError(`${label}: счёт ${reference} не найден в плане счетов`)
}

/** Business rules of each kind on top of the schema validator (B:retail.ts:398 plus D5 and accounts). */
export async function validateSettingData(ctx: QueryCtx, data: RetailSettingData) {
  switch (data.kind) {
    case "payment-type":
      if (data.allowsChange && data.processorKind !== "cash") throw new ConvexError("Сдача возможна только у наличных")
      await assertAccount(ctx, data.account, "Тип оплаты")
      return
    case "order-type":
      if (!(data.serviceChargePercent >= 0 && data.serviceChargePercent <= 30)) throw new ConvexError("Сервисный сбор — от 0 до 30 %")
      return
    case "discount-type":
      if (data.mode === "percent" && !(data.value > 0 && data.value <= 100)) throw new ConvexError("Процент скидки — от 0 до 100")
      if (data.mode === "fixed" && !(data.value > 0)) throw new ConvexError("Сумма скидки должна быть больше нуля")
      if (data.managerApprovalAbove < 0 || data.minimumOrder < 0) throw new ConvexError("Пороги скидки не могут быть отрицательными")
      if (data.manual === data.automatic) throw new ConvexError("Скидка либо ручная, либо автоматическая")
      return
    case "deletion-reason":
      if (data.writeOff && !data.expenseAccount) throw new ConvexError("Для списания укажите счёт расходов")
      await assertAccount(ctx, data.expenseAccount, "Причина удаления")
      return
    case "cash-operation-type":
      if (!(data.maximumAmount > 0)) throw new ConvexError("Максимальная сумма должна быть больше нуля")
      await assertAccount(ctx, data.cashAccount, "Кассовая операция")
      await assertAccount(ctx, data.correspondingAccount, "Кассовая операция")
      if (data.cashAccount === data.correspondingAccount) throw new ConvexError("Счета операции должны различаться")
      return
  }
}

/** Published settings of a kind in force for a restaurant at a moment, by sortOrder. */
export async function activeSettingsAt(ctx: QueryCtx, kind: Doc<"retailSettings">["kind"], restaurantExternalId: string, at: number) {
  const rows = await ctx.db.query("retailSettings").withIndex("by_kind_status_start", (q) => q.eq("kind", kind).eq("status", "published").lte("effectiveFrom", at)).take(200)
  return rows
    .filter((row) => (row.effectiveTo === undefined || at < row.effectiveTo) && (row.restaurantExternalIds.length === 0 || row.restaurantExternalIds.includes(restaurantExternalId)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"))
}

/** One published setting in force for the restaurant, or a user-facing error. */
export async function settingInForce(ctx: QueryCtx, kind: Doc<"retailSettings">["kind"], externalId: string, restaurantExternalId: string, at: number, label: string) {
  const row = await ctx.db.query("retailSettings").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  const inForce = row && row.kind === kind && row.status === "published" && row.effectiveFrom <= at && (row.effectiveTo === undefined || at < row.effectiveTo)
  if (!row || !inForce || (row.restaurantExternalIds.length > 0 && !row.restaurantExternalIds.includes(restaurantExternalId))) throw new ConvexError(`${label} недоступен на этой кассе`)
  return row
}

export const settingVersionTag = (row: Doc<"retailSettings">) => `${row.kind}:${row.code}@${row.version}`
