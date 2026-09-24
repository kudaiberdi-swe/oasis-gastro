import { ConvexError, v } from "convex/values"

import { mutation } from "../../_generated/server"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"
import { validateSettingData } from "../../lib/retailSettings"
import { RETAIL_MODULES, retailKind, retailSettingData } from "./validators"

/**
 * Saves a draft. Editing a published version creates the next version as a draft; the published one
 * stays in force until the new one is published.
 */
export const saveSetting = mutation({
  args: {
    externalId: v.optional(v.string()),
    kind: retailKind,
    code: v.string(),
    name: v.string(),
    receiptName: v.optional(v.string()),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    sortOrder: v.number(),
    restaurantExternalIds: v.array(v.string()),
    data: retailSettingData,
  },
  handler: async (ctx, args) => {
    const moduleId = RETAIL_MODULES[args.kind]
    const { user } = await requireOfficeCapability(ctx, `office.${moduleId}.edit`)
    for (const restaurant of args.restaurantExternalIds) await requireRestaurantScope(ctx, user, restaurant)
    if (args.restaurantExternalIds.length === 0 && !user.restaurantScopes.includes("*")) throw new ConvexError("Настройку для всех ресторанов может сохранить только пользователь с доступом ко всей сети")
    const email = (await getOfficeAuthEmail(ctx))!
    if (args.data.kind !== args.kind) throw new ConvexError("Данные не соответствуют виду справочника")
    const code = args.code.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9-]+/g, "-")
    const name = args.name.trim()
    if (!code || !name) throw new ConvexError("Укажите код и название")
    if (args.effectiveTo !== undefined && args.effectiveTo <= args.effectiveFrom) throw new ConvexError("Окончание действия должно быть позже начала")
    await validateSettingData(ctx, args.data)

    const value = {
      kind: args.kind,
      code,
      name,
      receiptName: args.receiptName?.trim() || undefined,
      effectiveFrom: args.effectiveFrom,
      effectiveTo: args.effectiveTo,
      sortOrder: args.sortOrder,
      restaurantExternalIds: [...new Set(args.restaurantExternalIds)],
      data: args.data,
      searchText: `${code} ${name} ${args.receiptName ?? ""}`.toLocaleLowerCase("ru"),
      updatedAt: Date.now(),
    }
    const existing = args.externalId ? await ctx.db.query("retailSettings").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique() : null
    if (args.externalId && (!existing || existing.kind !== args.kind)) throw new ConvexError("Запись не найдена")
    if (existing?.status === "expired") throw new ConvexError("Истёкшую версию изменить нельзя")
    let externalId: string
    if (existing?.status === "draft") {
      await ctx.db.patch(existing._id, value)
      externalId = existing.externalId
    } else {
      // New record, or the next version of a published one.
      const latest = await ctx.db.query("retailSettings").withIndex("by_kind_code_version", (q) => q.eq("kind", args.kind).eq("code", existing?.code ?? code)).order("desc").first()
      if (!existing && latest) throw new ConvexError(`Код «${code}» уже занят`)
      externalId = `${args.kind}-${crypto.randomUUID()}`
      await ctx.db.insert("retailSettings", { externalId, ...value, code: existing?.code ?? code, status: "draft", version: (latest?.version ?? 0) + 1, createdAt: Date.now(), createdBy: email })
    }
    await writeOfficeAudit(ctx, email, { action: "retail.setting.save", summary: `${name}: черновик`, resourceType: moduleId, resourceExternalId: externalId, capability: `office.${moduleId}.edit` })
    return externalId
  },
})

/** Publishing expires the previous published version of the same code from this version's start. */
export const publishSetting = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const setting = await ctx.db.query("retailSettings").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!setting) throw new ConvexError("Запись не найдена")
    const moduleId = RETAIL_MODULES[setting.kind]
    const { user } = await requireOfficeCapability(ctx, `office.${moduleId}.approve`)
    for (const restaurant of setting.restaurantExternalIds) await requireRestaurantScope(ctx, user, restaurant)
    if (setting.restaurantExternalIds.length === 0 && !user.restaurantScopes.includes("*")) throw new ConvexError("Настройку для всех ресторанов может опубликовать только пользователь с доступом ко всей сети")
    const email = (await getOfficeAuthEmail(ctx))!
    if (setting.status !== "draft") throw new ConvexError("Опубликовать можно только черновик")
    await validateSettingData(ctx, setting.data)
    const versions = await ctx.db.query("retailSettings").withIndex("by_kind_code_version", (q) => q.eq("kind", setting.kind).eq("code", setting.code)).take(100)
    for (const previous of versions) {
      if (previous._id !== setting._id && previous.status === "published") await ctx.db.patch(previous._id, { status: "expired", effectiveTo: setting.effectiveFrom, updatedAt: Date.now() })
    }
    await ctx.db.patch(setting._id, { status: "published", publishedAt: Date.now(), updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "retail.setting.publish", summary: `Опубликовано: ${setting.name} v${setting.version}`, resourceType: moduleId, resourceExternalId: setting.externalId, capability: `office.${moduleId}.approve` })
    const organizations = await ctx.db.query("organizations").take(3)
    const organization = organizations.find((row) => row.active)
    if (organization) await appendOutboxEvent(ctx, { aggregateType: moduleId, aggregateExternalId: setting.externalId, eventType: "retail.config.published", organizationExternalId: organization.externalId, payload: { kind: setting.kind, code: setting.code, version: setting.version } })
  },
})
