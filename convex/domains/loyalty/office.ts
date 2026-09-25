import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { internal } from "../../_generated/api"
import { internalMutation, mutation, query, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { normalizePhone } from "../../lib/loyalty"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { redactGuest } from "../../lib/pii"

// Office «Гости», «Программы лояльности», «Категории гостей» (W1-LOY-04/05/06). Personal data is masked
// without office.guests.pii; consents are append-only.

type User = { restaurantScopes: string[] }
const network = (user: User) => user.restaurantScopes.includes("*")
const visible = (user: User, guest: Doc<"guests">) => network(user) || !guest.restaurantExternalId || user.restaurantScopes.includes(guest.restaurantExternalId)

async function canSeePii(ctx: QueryCtx) {
  try {
    await requireOfficeCapability(ctx, "office.guests.pii")
    return true
  } catch {
    return false
  }
}

const publicGuest = (guest: Doc<"guests">, pii: boolean) => redactGuest({ ...guest, email: guest.email, birthDate: guest.birthDate, notes: guest.notes }, pii)

export const listGuests = query({
  args: { status: v.optional(v.union(v.literal("active"), v.literal("inactive"))), search: v.optional(v.string()), restaurantExternalId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.guests.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const pii = await canSeePii(ctx)
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const digits = needle?.replace(/\D/g, "") ?? ""
    const page = needle
      ? digits.length >= 3 && digits.length === needle.replace(/[\s()+-]/g, "").length
        ? await ctx.db.query("guests").withIndex("by_phone", (q) => q.gte("phone", digits).lt("phone", `${digits}￿`)).paginate(args.paginationOpts)
        : await ctx.db.query("guests").withSearchIndex("search_guests", (q) => {
            let scoped = q.search("searchText", needle)
            if (args.status) scoped = scoped.eq("status", args.status)
            if (args.restaurantExternalId) scoped = scoped.eq("restaurantExternalId", args.restaurantExternalId)
            return scoped
          }).paginate(args.paginationOpts)
      : args.status
        ? await ctx.db.query("guests").withIndex("by_status_last_visit", (q) => q.eq("status", args.status)).order("desc").paginate(args.paginationOpts)
        : await ctx.db.query("guests").order("desc").paginate(args.paginationOpts)
    const rows = page.page.filter((guest) => visible(user, guest) && (!args.status || (guest.status ?? "active") === args.status) && (!args.restaurantExternalId || guest.restaurantExternalId === args.restaurantExternalId))
    return { ...page, page: rows.map((guest) => publicGuest(guest, pii)) }
  },
})

export const getGuest = query({
  args: { guestId: v.id("guests") },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.guests.view")
    const guest = await ctx.db.get(args.guestId)
    if (!guest || !visible(user, guest)) return null
    const [accounts, transactions, consents] = await Promise.all([
      ctx.db.query("loyaltyAccounts").withIndex("by_guest_program", (q) => q.eq("guestId", guest._id)).take(20),
      ctx.db.query("loyaltyTransactions").withIndex("by_guest_occurred", (q) => q.eq("guestId", guest._id)).order("desc").take(50),
      ctx.db.query("guestConsents").withIndex("by_guest_channel_recorded", (q) => q.eq("guestId", guest._id)).order("desc").take(50),
    ])
    return { guest: publicGuest(guest, await canSeePii(ctx)), accounts, transactions, consents }
  },
})

export const guestSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.guests.view")
    let activeGuests = 0
    for await (const _guest of ctx.db.query("guests").withIndex("by_status_last_visit", (q) => q.eq("status", "active"))) {
      activeGuests += 1
      if (activeGuests >= 100_000) break
    }
    const programs = await ctx.db.query("loyaltyPrograms").withIndex("by_status_priority", (q) => q.eq("status", "published")).take(200)
    return { activeGuests, publishedPrograms: programs.length }
  },
})

const CONSENT_CHANNEL = v.union(v.literal("personal-data"), v.literal("cross-border"), v.literal("sms"), v.literal("email"))

export const saveGuest = mutation({
  args: {
    guestId: v.optional(v.id("guests")),
    expectedUpdatedAt: v.optional(v.number()),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    birthDate: v.optional(v.string()),
    gender: v.optional(v.union(v.literal("female"), v.literal("male"), v.literal("unspecified"))),
    cardNumber: v.optional(v.string()),
    categoryExternalIds: v.array(v.string()),
    notes: v.optional(v.string()),
    restaurantExternalId: v.optional(v.string()),
    consents: v.optional(v.object({ personalData: v.boolean(), crossBorder: v.boolean(), documentRef: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.guests.edit")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите имя гостя")
    const masked = (value?: string) => Boolean(value?.includes("•"))
    const phone = args.phone && !masked(args.phone) ? normalizePhone(args.phone) : undefined
    if (args.phone && !masked(args.phone) && !phone) throw new ConvexError("Некорректный телефон")
    const guestEmail = args.email && !masked(args.email) ? args.email.trim() : undefined
    if (guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) throw new ConvexError("Некорректный email")
    if (args.birthDate && !masked(args.birthDate) && !/^\d{4}-\d{2}-\d{2}$/.test(args.birthDate)) throw new ConvexError("Дата рождения — ГГГГ-ММ-ДД")
    for (const code of args.categoryExternalIds) {
      if (!(await ctx.db.query("guestCategories").withIndex("by_external_id", (q) => q.eq("externalId", code)).unique())) throw new ConvexError("Категория гостя не найдена")
    }
    const now = Date.now()
    if (phone) {
      const same = await ctx.db.query("guests").withIndex("by_phone", (q) => q.eq("phone", phone)).unique()
      if (same && same._id !== args.guestId) throw new ConvexError("Гость с таким телефоном уже есть")
    }
    if (args.guestId) {
      const guest = await ctx.db.get(args.guestId)
      if (!guest || !visible(user, guest)) throw new ConvexError("Гость не найден")
      if (args.expectedUpdatedAt !== undefined && (guest.updatedAt ?? 0) !== args.expectedUpdatedAt) throw new ConvexError("Карточку изменил другой пользователь — обновите страницу")
      const patch: Partial<Doc<"guests">> = { name, gender: args.gender, cardNumber: args.cardNumber?.trim() || undefined, categoryExternalIds: args.categoryExternalIds, updatedAt: now }
      if (phone) patch.phone = phone
      if (args.email !== undefined && !masked(args.email)) patch.email = guestEmail
      if (args.birthDate !== undefined && !masked(args.birthDate)) patch.birthDate = args.birthDate || undefined
      if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined
      patch.searchText = `${patch.phone ?? guest.phone} ${name} ${patch.cardNumber ?? ""}`.toLocaleLowerCase("ru")
      await ctx.db.patch(guest._id, patch)
      await writeOfficeAudit(ctx, email, { action: "loyalty.guest.update", summary: `Изменена карточка гостя «${name}»`, resourceType: "guest", resourceExternalId: guest.externalId ?? String(guest._id), capability: "office.guests.edit" })
      return guest._id
    }
    if (!phone && !guestEmail) throw new ConvexError("Укажите телефон или email")
    if (!args.consents?.personalData || !args.consents.crossBorder) throw new ConvexError("Нужны согласия на обработку и трансграничную передачу персональных данных")
    const guestId = await ctx.db.insert("guests", {
      phone: phone ?? "",
      name,
      points: 0,
      createdAt: now,
      externalId: `guest-${crypto.randomUUID()}`,
      status: "active",
      restaurantExternalId: args.restaurantExternalId,
      email: guestEmail,
      birthDate: args.birthDate || undefined,
      gender: args.gender,
      cardNumber: args.cardNumber?.trim() || undefined,
      categoryExternalIds: args.categoryExternalIds,
      notes: args.notes?.trim() || undefined,
      consentState: "granted",
      visits: 0,
      turnover: 0,
      searchText: `${phone ?? ""} ${name} ${args.cardNumber ?? ""}`.toLocaleLowerCase("ru"),
      updatedAt: now,
    })
    for (const channel of ["personal-data", "cross-border"] as const) {
      await ctx.db.insert("guestConsents", { guestId, channel, granted: true, source: "office", actorKey: email, recordedAt: now, ...(args.consents.documentRef ? { documentRef: args.consents.documentRef } : {}) })
    }
    await writeOfficeAudit(ctx, email, { action: "loyalty.guest.create", summary: `Новый гость «${name}»`, resourceType: "guest", resourceExternalId: String(guestId), capability: "office.guests.edit" })
    return guestId
  },
})

/** Consents are append-only: a new row per decision; the guest keeps the latest personal-data state. */
export const recordConsent = mutation({
  args: { guestId: v.id("guests"), channel: CONSENT_CHANNEL, granted: v.boolean(), documentRef: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.guests.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const guest = await ctx.db.get(args.guestId)
    if (!guest || !visible(user, guest)) throw new ConvexError("Гость не найден")
    const now = Date.now()
    await ctx.db.insert("guestConsents", { guestId: guest._id, channel: args.channel, granted: args.granted, source: "office", actorKey: email, recordedAt: now, ...(args.documentRef ? { documentRef: args.documentRef } : {}) })
    if (args.channel === "personal-data") await ctx.db.patch(guest._id, { consentState: args.granted ? "granted" : "withdrawn", updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: "loyalty.consent", summary: `Согласие «${args.channel}»: ${args.granted ? "дано" : "отозвано"}`, resourceType: "guest", resourceExternalId: guest.externalId ?? String(guest._id), capability: "office.guests.edit" })
  },
})

export const setGuestStatus = mutation({
  args: { guestId: v.id("guests"), status: v.union(v.literal("active"), v.literal("inactive")) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.guests.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const guest = await ctx.db.get(args.guestId)
    if (!guest || !visible(user, guest)) throw new ConvexError("Гость не найден")
    await ctx.db.patch(guest._id, { status: args.status, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "loyalty.guest.status", summary: `Гость «${guest.name ?? ""}»: ${args.status === "active" ? "включён" : "отключён"}`, resourceType: "guest", resourceExternalId: guest.externalId ?? String(guest._id), capability: "office.guests.edit" })
  },
})

/** Manual correction of a program account (replaces adjustPoints); never below zero. */
export const adjustBalance = mutation({
  args: { guestId: v.id("guests"), programExternalId: v.string(), amount: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.loyalty-programs.approve")
    const email = (await getOfficeAuthEmail(ctx))!
    const guest = await ctx.db.get(args.guestId)
    if (!guest || !visible(user, guest)) throw new ConvexError("Гость не найден")
    if (!Number.isInteger(args.amount) || args.amount === 0) throw new ConvexError("Укажите ненулевое целое число баллов")
    if (args.reason.trim().length < 3) throw new ConvexError("Укажите причину корректировки")
    const program = await ctx.db.query("loyaltyPrograms").withIndex("by_external_id", (q) => q.eq("externalId", args.programExternalId)).unique()
    if (!program) throw new ConvexError("Программа не найдена")
    const now = Date.now()
    let account = await ctx.db.query("loyaltyAccounts").withIndex("by_guest_program", (q) => q.eq("guestId", guest._id).eq("programExternalId", program.externalId)).unique()
    if (!account) {
      const id = await ctx.db.insert("loyaltyAccounts", { externalId: `loyalty-account-${crypto.randomUUID()}`, guestId: guest._id, programExternalId: program.externalId, kind: program.programKind, balance: 0, reserved: 0, updatedAt: now })
      account = (await ctx.db.get(id))!
    }
    const balanceAfter = account.balance + args.amount
    if (balanceAfter < 0) throw new ConvexError(`Недостаточно баллов: на счёте ${account.balance}`)
    await ctx.db.patch(account._id, { balance: balanceAfter, updatedAt: now })
    await ctx.db.patch(guest._id, { points: Math.max(0, guest.points + args.amount), updatedAt: now })
    await ctx.db.insert("loyaltyTransactions", { guestId: guest._id, kind: "adjustment", points: args.amount, balanceAfter, reason: args.reason.trim(), actorEmail: email, occurredAt: now, accountId: account._id, programExternalId: program.externalId, idempotencyKey: `adjust:${crypto.randomUUID()}`, description: args.reason.trim() })
    await writeOfficeAudit(ctx, email, { action: "loyalty.adjust", summary: `Корректировка «${program.name}»: ${args.amount > 0 ? "+" : ""}${args.amount} (${args.reason.trim()})`, resourceType: "guest", resourceExternalId: guest.externalId ?? String(guest._id), capability: "office.loyalty-programs.approve" })
    return { balance: balanceAfter }
  },
})

// ── Programs (W1-LOY-05) ─────────────────────────────────────────────────────

const programFields = {
  name: v.string(),
  programKind: v.union(v.literal("bonus"), v.literal("deposit")),
  accrualPercent: v.number(),
  maxRedemptionPercent: v.number(),
  welcomeBonus: v.number(),
  startsAt: v.number(),
  endsAt: v.optional(v.number()),
  categoryExternalId: v.optional(v.string()),
  restaurantExternalIds: v.array(v.string()),
  expirationDays: v.optional(v.number()),
  priority: v.number(),
}

export const listPrograms = query({
  args: { status: v.optional(v.union(v.literal("draft"), v.literal("published"), v.literal("inactive"))) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.loyalty-programs.view")
    return args.status
      ? ctx.db.query("loyaltyPrograms").withIndex("by_status_priority", (q) => q.eq("status", args.status!)).order("desc").take(200)
      : ctx.db.query("loyaltyPrograms").withIndex("by_status_priority").order("desc").take(200)
  },
})

function validateProgram(args: { accrualPercent: number; maxRedemptionPercent: number; welcomeBonus: number; startsAt: number; endsAt?: number; expirationDays?: number; restaurantExternalIds: string[]; name: string }) {
  if (!args.name.trim()) throw new ConvexError("Укажите название программы")
  if (!(args.accrualPercent >= 0 && args.accrualPercent <= 100)) throw new ConvexError("Начисление — от 0 до 100 %")
  if (!(args.maxRedemptionPercent >= 0 && args.maxRedemptionPercent <= 100)) throw new ConvexError("Списание — от 0 до 100 %")
  if (!(Number.isInteger(args.welcomeBonus) && args.welcomeBonus >= 0)) throw new ConvexError("Приветственный бонус — целое неотрицательное число")
  if (args.endsAt !== undefined && args.endsAt <= args.startsAt) throw new ConvexError("Окончание должно быть позже начала")
  if (args.expirationDays !== undefined && !(Number.isInteger(args.expirationDays) && args.expirationDays > 0)) throw new ConvexError("Срок жизни баллов — целое число дней")
  if (!args.restaurantExternalIds.length) throw new ConvexError("Выберите рестораны программы")
}

/** Saves a draft (published programs are edited as a new draft by copying). Returns overlap warnings. */
export const saveProgram = mutation({
  args: { externalId: v.optional(v.string()), ...programFields },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.loyalty-programs.edit")
    for (const restaurant of args.restaurantExternalIds) if (restaurant !== "*") await requireRestaurantScope(ctx, user, restaurant)
    if (args.restaurantExternalIds.includes("*") && !network(user)) throw new ConvexError("Программу на всю сеть может сохранить только пользователь с доступом ко всей сети")
    validateProgram(args)
    const email = (await getOfficeAuthEmail(ctx))!
    const { externalId: givenId, ...fields } = args
    const now = Date.now()
    let externalId = givenId
    if (givenId) {
      const existing = await ctx.db.query("loyaltyPrograms").withIndex("by_external_id", (q) => q.eq("externalId", givenId)).unique()
      if (!existing) throw new ConvexError("Программа не найдена")
      if (existing.status !== "draft") throw new ConvexError("Изменить можно только черновик")
      await ctx.db.patch(existing._id, { ...fields, name: fields.name.trim(), updatedAt: now })
    } else {
      externalId = `loyalty-program-${crypto.randomUUID()}`
      await ctx.db.insert("loyaltyPrograms", { ...fields, name: fields.name.trim(), externalId, status: "draft", createdAt: now, updatedAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: "loyalty.program.save", summary: `Программа «${args.name.trim()}»: черновик`, resourceType: "loyalty-program", resourceExternalId: externalId!, capability: "office.loyalty-programs.edit" })
    return { externalId: externalId!, overlaps: await overlapsOf(ctx, { ...fields, externalId: externalId! }) }
  },
})

async function overlapsOf(ctx: QueryCtx, program: { externalId: string; restaurantExternalIds: string[]; categoryExternalId?: string; startsAt: number; endsAt?: number; priority: number }) {
  const published = await ctx.db.query("loyaltyPrograms").withIndex("by_status_priority", (q) => q.eq("status", "published")).take(200)
  return published
    .filter((other) => other.externalId !== program.externalId && (other.categoryExternalId ?? null) === (program.categoryExternalId ?? null))
    .filter((other) => other.restaurantExternalIds.includes("*") || program.restaurantExternalIds.includes("*") || other.restaurantExternalIds.some((id) => program.restaurantExternalIds.includes(id)))
    .filter((other) => (other.endsAt === undefined || other.endsAt > program.startsAt) && (program.endsAt === undefined || program.endsAt > other.startsAt))
    .map((other) => ({ externalId: other.externalId, name: other.name, priority: other.priority, samePriority: other.priority === program.priority }))
}

export const transitionProgram = mutation({
  args: { externalId: v.string(), action: v.union(v.literal("publish"), v.literal("deactivate")) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.loyalty-programs.approve")
    const email = (await getOfficeAuthEmail(ctx))!
    const program = await ctx.db.query("loyaltyPrograms").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!program) throw new ConvexError("Программа не найдена")
    for (const restaurant of program.restaurantExternalIds) if (restaurant !== "*") await requireRestaurantScope(ctx, user, restaurant)
    if (args.action === "publish") {
      if (program.status === "published") throw new ConvexError("Программа уже опубликована")
      const clashes = (await overlapsOf(ctx, program)).filter((other) => other.samePriority)
      if (clashes.length) throw new ConvexError(`Пересекается с «${clashes[0].name}» при том же приоритете — задайте приоритет явно`)
    } else if (program.status !== "published") throw new ConvexError("Отключить можно только опубликованную программу")
    await ctx.db.patch(program._id, { status: args.action === "publish" ? "published" : "inactive", updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: `loyalty.program.${args.action}`, summary: `Программа «${program.name}»: ${args.action === "publish" ? "опубликована" : "отключена"}`, resourceType: "loyalty-program", resourceExternalId: program.externalId, capability: "office.loyalty-programs.approve" })
  },
})

// ── Guest categories (W1-LOY-06) ─────────────────────────────────────────────

export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.guest-categories.view")
    return ctx.db.query("guestCategories").take(200)
  },
})

export const saveCategory = mutation({
  args: { externalId: v.optional(v.string()), code: v.string(), name: v.string(), color: v.string(), assignment: v.union(v.literal("manual"), v.literal("automatic"), v.literal("default")), minimumSpend: v.number(), minimumVisits: v.number(), validDays: v.number(), active: v.boolean() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.guest-categories.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const code = args.code.trim().toLocaleLowerCase("en-US")
    if (!/^[a-z0-9-]{2,32}$/.test(code)) throw new ConvexError("Код — латиница, цифры и дефис")
    if (!args.name.trim()) throw new ConvexError("Укажите название")
    for (const value of [args.minimumSpend, args.minimumVisits, args.validDays]) if (!(Number.isInteger(value) && value >= 0)) throw new ConvexError("Пороги — целые неотрицательные числа")
    const all = await ctx.db.query("guestCategories").take(200)
    if (all.some((row) => row.code === code && row.externalId !== args.externalId)) throw new ConvexError("Код категории уже занят")
    const now = Date.now()
    const value = { code, name: args.name.trim(), color: args.color, assignment: args.assignment, minimumSpend: args.minimumSpend, minimumVisits: args.minimumVisits, validDays: args.validDays, active: args.active, updatedAt: now }
    let externalId = args.externalId
    if (externalId) {
      const existing = all.find((row) => row.externalId === externalId)
      if (!existing) throw new ConvexError("Категория не найдена")
      await ctx.db.patch(existing._id, value)
    } else {
      externalId = `guest-category-${code}`
      await ctx.db.insert("guestCategories", { ...value, externalId, createdAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: "loyalty.category.save", summary: `Категория гостей «${value.name}»`, resourceType: "guest-category", resourceExternalId: externalId, capability: "office.guest-categories.edit" })
    return externalId
  },
})

/**
 * Nightly: automatic categories by spend and visits. Guests carry lifetime turnover and visits (per
 * validDays windows come with the loyalty facts in W2); manual categories are never removed here.
 */
export const recalculateGuestCategories = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<{ scanned: number; changed: number; isDone: boolean }> => {
    const allCategories = await ctx.db.query("guestCategories").take(200)
    const automatic = allCategories.filter((row) => row.active && row.assignment === "automatic")
    const page = await ctx.db.query("guests").withIndex("by_status_last_visit", (q) => q.eq("status", "active")).paginate({ numItems: 200, cursor: args.cursor })
    let changed = 0
    for (const guest of page.page) {
      const manual = (guest.categoryExternalIds ?? []).filter((id) => !automatic.some((row) => row.externalId === id))
      const earned = automatic.filter((row) => (guest.turnover ?? 0) >= row.minimumSpend && (guest.visits ?? 0) >= row.minimumVisits).map((row) => row.externalId)
      const next = [...manual, ...earned]
      if (next.join() === (guest.categoryExternalIds ?? []).join()) continue
      changed += 1
      await ctx.db.patch(guest._id, { categoryExternalIds: next })
    }
    // Page by page in separate transactions until every active guest is done.
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.domains.loyalty.office.recalculateGuestCategories, { cursor: page.continueCursor })
    return { scanned: page.page.length, changed, isDone: page.isDone }
  },
})
