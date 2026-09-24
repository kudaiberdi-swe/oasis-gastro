import { v } from "convex/values"

import { internalMutation, type MutationCtx } from "../../_generated/server"
import type { Infer } from "convex/values"
import { validateSettingData } from "../../lib/retailSettings"
import type { retailSettingData } from "./validators"

type Data = Infer<typeof retailSettingData>

/** Every 10 minutes: published settings past their effectiveTo become expired. */
export const expireSettings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    let expired = 0
    for (const kind of ["payment-type", "order-type", "discount-type", "deletion-reason", "cash-operation-type"] as const) {
      const rows = await ctx.db.query("retailSettings").withIndex("by_kind_status_start", (q) => q.eq("kind", kind).eq("status", "published")).take(200)
      for (const row of rows) {
        if (row.effectiveTo !== undefined && row.effectiveTo <= now) {
          expired += 1
          await ctx.db.patch(row._id, { status: "expired", updatedAt: now })
        }
      }
    }
    return { expired }
  },
})

const DEFAULTS: { code: string; name: string; sortOrder: number; data: Data }[] = [
  { code: "cash", name: "Наличные", sortOrder: 1, data: { kind: "payment-type", processorKind: "cash", account: "cash", fiscal: true, revenue: true, manualEntry: false, externalAcceptance: false, combinable: true, allowsChange: true, opensCashDrawer: true } },
  { code: "card", name: "Банковская карта", sortOrder: 2, data: { kind: "payment-type", processorKind: "card", account: "inTransit", fiscal: true, revenue: true, manualEntry: false, externalAcceptance: true, combinable: true, allowsChange: false, opensCashDrawer: false } },
  { code: "kaspi-qr", name: "Kaspi QR", sortOrder: 3, data: { kind: "payment-type", processorKind: "qr", account: "inTransit", fiscal: true, revenue: true, manualEntry: true, externalAcceptance: true, combinable: true, allowsChange: false, opensCashDrawer: false } },
  { code: "dine-in", name: "В зале", sortOrder: 1, data: { kind: "order-type", serviceMode: "dine-in", promptStage: "start", isDefault: true, serviceChargePercent: 15 } },
  { code: "takeaway", name: "С собой", sortOrder: 2, data: { kind: "order-type", serviceMode: "takeaway", promptStage: "start", isDefault: false, serviceChargePercent: 0 } },
  { code: "delivery", name: "Доставка", sortOrder: 3, data: { kind: "order-type", serviceMode: "delivery", promptStage: "start", isDefault: false, serviceChargePercent: 0 } },
  { code: "guest-refused", name: "Отказ гостя", sortOrder: 1, data: { kind: "deletion-reason", writeOff: false, requireComment: false, requireManager: true } },
  { code: "cashier-error", name: "Ошибка кассира", sortOrder: 2, data: { kind: "deletion-reason", writeOff: false, requireComment: true, requireManager: true } },
  { code: "spoilage", name: "Порча", sortOrder: 3, data: { kind: "deletion-reason", expenseAccount: "cashShortage", writeOff: true, requireComment: true, requireManager: true } },
  { code: "float-in", name: "Внесение размена", sortOrder: 1, data: { kind: "cash-operation-type", direction: "cash-in", cashAccount: "cash", correspondingAccount: "bank", maximumAmount: 500_000, requireManager: false } },
  { code: "collection", name: "Инкассация", sortOrder: 2, data: { kind: "cash-operation-type", direction: "cash-out", cashAccount: "cash", correspondingAccount: "bank", maximumAmount: 50_000_000, requireManager: true } },
]

export async function seedRetailDefaults(ctx: MutationCtx, dryRun = false) {
  const now = Date.now()
  let created = 0
  for (const setting of DEFAULTS) {
    if (!dryRun) await validateSettingData(ctx, setting.data) // a dry run may precede the chart-of-accounts seed
    const existing = await ctx.db.query("retailSettings").withIndex("by_kind_code_version", (q) => q.eq("kind", setting.data.kind).eq("code", setting.code)).first()
    if (existing) continue
    created += 1
    if (!dryRun) {
      await ctx.db.insert("retailSettings", {
        externalId: `${setting.data.kind}-${setting.code}`,
        kind: setting.data.kind,
        code: setting.code,
        name: setting.name,
        status: "published",
        effectiveFrom: now,
        sortOrder: setting.sortOrder,
        restaurantExternalIds: [],
        data: setting.data,
        version: 1,
        searchText: `${setting.code} ${setting.name}`.toLocaleLowerCase("ru"),
        createdAt: now,
        updatedAt: now,
        publishedAt: now,
        createdBy: "seed",
      })
    }
  }
  return { created, total: DEFAULTS.length, dryRun }
}

/** Idempotent by code; each default passes the same validator as office edits. Needs the chart of accounts. */
export const seedDefaults = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => seedRetailDefaults(ctx, args.dryRun ?? false),
})
