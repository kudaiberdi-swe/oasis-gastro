import { ConvexError, v } from "convex/values"

import { mutation } from "../../_generated/server"
import { CAPABILITY_CATALOG } from "../../lib/capabilities"
import { effectiveScopes, getOfficeAuthEmail, hasScope, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"
import { businessDateFor, almatyDayStart } from "../../lib/time"

// Corporation and administration sections edited in the canonical tables (W1-ADM-01, decision:
// no platformRecords copy as in bahandi — one source of truth).

const terminalKind = v.union(v.literal("pos"), v.literal("kds"), v.literal("office"), v.literal("delivery"))

export const saveTerminal = mutation({
  args: {
    externalId: v.optional(v.string()),
    restaurantExternalId: v.string(),
    name: v.string(),
    terminalNumber: v.number(),
    kind: terminalKind,
    appVersion: v.optional(v.string()),
    heartbeatUrl: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.terminals.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название терминала")
    if (!Number.isInteger(args.terminalNumber) || args.terminalNumber < 1 || args.terminalNumber > 999) throw new ConvexError("Номер терминала — целое число от 1 до 999")
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) throw new ConvexError("Ресторан не найден")

    const existing = args.externalId ? await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique() : null
    if (args.externalId && !existing) throw new ConvexError("Терминал не найден")
    if (existing && existing.restaurantId !== restaurant._id) throw new ConvexError("Ресторан терминала менять нельзя")
    if (existing && args.expectedVersion !== undefined && args.expectedVersion !== (existing.version ?? 1)) throw new ConvexError("Терминал изменён другим пользователем — обновите страницу")

    const sameNumber = await ctx.db
      .query("posTerminals")
      .withIndex("by_restaurant_number", (q) => q.eq("restaurantId", restaurant._id).eq("terminalNumber", args.terminalNumber))
      .first()
    if (sameNumber && sameNumber._id !== existing?._id) throw new ConvexError(`Терминал с номером ${args.terminalNumber} уже есть в этом ресторане`)

    const optional = { appVersion: args.appVersion?.trim() || undefined, heartbeatUrl: args.heartbeatUrl?.trim() || undefined }
    let externalId: string
    if (existing) {
      // Terminals imported from iiko keep iiko's name and number; only local settings change here.
      const patch = existing.sourceReadOnly
        ? { kind: args.kind, ...optional }
        : { name, terminalNumber: args.terminalNumber, kind: args.kind, ...optional }
      await ctx.db.patch(existing._id, { ...patch, version: (existing.version ?? 1) + 1 })
      externalId = existing.externalId
    } else {
      externalId = `${restaurant.externalId}-${String(args.terminalNumber).padStart(2, "0")}`
      const clash = await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
      if (clash) externalId = `${externalId}-${crypto.randomUUID().slice(0, 6)}`
      await ctx.db.insert("posTerminals", { externalId, restaurantId: restaurant._id, name, terminalNumber: args.terminalNumber, nextOrderNumber: 1, active: true, kind: args.kind, ...optional, version: 1 })
    }
    await writeOfficeAudit(ctx, email, {
      action: existing ? "terminal.update" : "terminal.create",
      summary: `Терминал «${name}» №${args.terminalNumber}`,
      resourceType: "terminal",
      resourceExternalId: externalId,
      restaurantExternalId: restaurant.externalId,
      capability: "office.terminals.edit",
    })
    return externalId
  },
})

export const setTerminalActive = mutation({
  args: { externalId: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.terminals.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const terminal = await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    const restaurant = terminal ? await ctx.db.get(terminal.restaurantId) : null
    if (!terminal || !restaurant) throw new ConvexError("Терминал не найден")
    await requireRestaurantScope(ctx, user, restaurant.externalId)
    await ctx.db.patch(terminal._id, { active: args.active, version: (terminal.version ?? 1) + 1 })
    await writeOfficeAudit(ctx, email, {
      action: "terminal.update",
      summary: `Терминал «${terminal.name}» ${args.active ? "включён" : "отключён"}`,
      resourceType: "terminal",
      resourceExternalId: terminal.externalId,
      restaurantExternalId: restaurant.externalId,
      capability: "office.terminals.edit",
    })
  },
})

const SECTION_IDS = new Set(CAPABILITY_CATALOG.map((section) => section.id))

/** «Закрыть период» (W1-ADM-03): lockedThrough is the last closed business day, never in the future. */
export const createPeriodLock = mutation({
  args: {
    kind: v.union(v.literal("preliminary"), v.literal("final")),
    lockedThrough: v.string(),
    restaurantExternalId: v.optional(v.string()),
    organizationExternalId: v.optional(v.string()),
    moduleId: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.document-locks.post")
    const email = (await getOfficeAuthEmail(ctx))!
    const scopes = await effectiveScopes(ctx, user, role)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.lockedThrough)) throw new ConvexError("Укажите дату закрытия")
    if (args.lockedThrough > businessDateFor(Date.now())) throw new ConvexError("Нельзя закрыть будущий период")
    if (args.moduleId && !SECTION_IDS.has(args.moduleId)) throw new ConvexError("Неизвестный раздел")
    const reason = args.reason.trim()
    if (reason.length < 3) throw new ConvexError("Укажите причину закрытия")

    let organizationExternalId: string
    if (args.restaurantExternalId) {
      await requireRestaurantScope(ctx, user, args.restaurantExternalId)
      const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId!)).unique()
      if (!restaurant) throw new ConvexError("Ресторан не найден")
      organizationExternalId = restaurant.organizationExternalId
    } else {
      // A whole-organization lock needs network scope over that organization.
      if (!user.restaurantScopes.includes("*")) throw new ConvexError("Закрыть период всей организации может только пользователь с доступом ко всем ресторанам")
      const own = scopes.organizationScopes.filter((scope) => scope !== "*")
      const organization = args.organizationExternalId ?? (own.length === 1 ? own[0] : undefined)
      if (!organization) {
        const organizations = await ctx.db.query("organizations").take(3)
        const active = organizations.filter((row) => row.active)
        if (active.length !== 1) throw new ConvexError("Выберите организацию")
        organizationExternalId = active[0].externalId
      } else organizationExternalId = organization
      if (!hasScope(scopes.organizationScopes, organizationExternalId)) throw new ConvexError("Нет доступа к организации")
    }

    const externalId = `lock-${crypto.randomUUID()}`
    await ctx.db.insert("periodLocks", {
      externalId,
      organizationExternalId,
      ...(args.restaurantExternalId ? { restaurantExternalId: args.restaurantExternalId } : {}),
      ...(args.moduleId ? { moduleId: args.moduleId } : {}),
      kind: args.kind,
      lockedThrough: almatyDayStart(args.lockedThrough),
      active: true,
      reason,
      createdBy: email,
      createdAt: Date.now(),
    })
    await writeOfficeAudit(ctx, email, {
      action: "period-lock.create",
      summary: `${args.kind === "final" ? "Окончательно" : "Предварительно"} закрыт период по ${args.lockedThrough.split("-").reverse().join(".")}: ${reason}`,
      resourceType: "period-lock",
      resourceExternalId: externalId,
      restaurantExternalId: args.restaurantExternalId,
      capability: "office.document-locks.post",
      details: { kind: args.kind, lockedThrough: args.lockedThrough, moduleId: args.moduleId, organizationExternalId },
    })
    await appendOutboxEvent(ctx, { aggregateType: "period-lock", aggregateExternalId: externalId, eventType: "period-lock.created", restaurantExternalId: args.restaurantExternalId, organizationExternalId })
    return externalId
  },
})

/** Reopening needs office.document-locks.reverse and a reason. */
export const reopenPeriodLock = mutation({
  args: { externalId: v.string(), reopenReason: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.document-locks.reverse")
    const email = (await getOfficeAuthEmail(ctx))!
    const lock = await ctx.db.query("periodLocks").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!lock) throw new ConvexError("Блокировка не найдена")
    const scopes = await effectiveScopes(ctx, user, role)
    if (!hasScope(scopes.organizationScopes, lock.organizationExternalId)) throw new ConvexError("Блокировка не найдена")
    if (lock.restaurantExternalId) await requireRestaurantScope(ctx, user, lock.restaurantExternalId)
    else if (!user.restaurantScopes.includes("*")) throw new ConvexError("Снять блокировку всей организации может только пользователь с доступом ко всем ресторанам")
    if (!lock.active) throw new ConvexError("Период уже открыт")
    const reason = args.reopenReason.trim()
    if (reason.length < 3) throw new ConvexError("Укажите причину повторного открытия")
    await ctx.db.patch(lock._id, { active: false, reopenedBy: email, reopenedAt: Date.now(), reopenReason: reason })
    await writeOfficeAudit(ctx, email, {
      action: "period-lock.reopen",
      summary: `Период открыт повторно: ${reason}`,
      resourceType: "period-lock",
      resourceExternalId: lock.externalId,
      restaurantExternalId: lock.restaurantExternalId,
      capability: "office.document-locks.reverse",
    })
  },
})
