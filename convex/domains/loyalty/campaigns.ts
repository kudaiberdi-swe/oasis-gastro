import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { internal } from "../../_generated/api"
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { canMessageGuest } from "../../lib/consents"
import { enqueueIntegrationJob } from "../../lib/integrationQueue"
import { nextNumber } from "../../lib/numbering"
import { effectiveScopes, getOfficeAuthEmail, hasNetworkScope, hasScope, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"
import { maskEmail, maskPhone } from "../../lib/pii"
import { almatyBusinessDate, nextAlmatyWindowTime } from "../../lib/time"
import { CAMPAIGN_OPERATION } from "../integrations/adapters/messaging"

// «Рассылки и акции» (W3-LOY-08). Lifecycle: draft → pending-approval → approved → completed, or
// cancelled. Approving queues one integration job per guest who may receive it (Г-2: consent to
// personal data and to the channel in force, consent state known) in batches of 200 continued through
// the scheduler; the job waits for the Almaty quiet-hours window and is sent by the messaging adapter
// (W3-INT-06). No provider key → the jobs end in dead-letter with the reason, never «sent».

type Campaign = Doc<"campaigns">
type Status = Campaign["status"]

const ENQUEUE_BATCH = 200
const PREVIEW_LIMIT = 200
const MAX_TEMPLATE = 1000
const LIVE: Status[] = ["draft", "pending-approval", "approved"]
const PENDING_JOB_STATUSES = ["queued", "retrying", "processing"] as const

const channel = v.union(v.literal("sms"), v.literal("email"))
const status = v.union(v.literal("draft"), v.literal("pending-approval"), v.literal("approved"), v.literal("completed"), v.literal("cancelled"))

async function requireCampaign(ctx: QueryCtx, externalId: string) {
  const row = await ctx.db.query("campaigns").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!row) throw new ConvexError("Кампания не найдена")
  return row
}

/** A network campaign ("*") is visible with network scope; otherwise with any of its restaurants. */
function visibleTo(user: { restaurantScopes: string[] }, campaign: Pick<Campaign, "restaurantExternalIds">) {
  if (campaign.restaurantExternalIds.includes("*")) return hasNetworkScope(user)
  return campaign.restaurantExternalIds.some((id) => hasScope(user.restaurantScopes, id))
}

/** Changing a campaign needs every one of its restaurants in scope. */
async function requireRestaurantScopes(ctx: QueryCtx, user: { restaurantScopes: string[] }, restaurantExternalIds: string[]) {
  for (const id of restaurantExternalIds) {
    if (id === "*") {
      if (!hasNetworkScope(user)) throw new ConvexError("Рассылка по всей сети доступна только с доступом ко всем ресторанам")
    } else await requireRestaurantScope(ctx, user, id)
  }
}

/** Whether a guest belongs to the campaign audience before consents: organization, restaurants, category. */
function inAudience(guest: Doc<"guests">, target: { organizationExternalId: string; restaurantExternalIds: string[]; categoryExternalId?: string }) {
  if (guest.organizationExternalId && guest.organizationExternalId !== target.organizationExternalId) return false
  if (!target.restaurantExternalIds.includes("*") && !(guest.restaurantExternalId && target.restaurantExternalIds.includes(guest.restaurantExternalId))) return false
  return !target.categoryExternalId || (guest.categoryExternalIds ?? []).includes(target.categoryExternalId)
}

/** The organization of a campaign: of its restaurants, or the user's only one for a network campaign. */
async function campaignOrganization(ctx: QueryCtx, user: Doc<"officeUsers">, role: Doc<"officeRoles">, restaurantExternalIds: string[]) {
  const organizations = new Set<string>()
  for (const id of restaurantExternalIds.filter((candidate) => candidate !== "*")) {
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", id)).unique()
    if (!restaurant?.active) throw new ConvexError("Ресторан не найден или отключён")
    organizations.add(restaurant.organizationExternalId)
  }
  if (organizations.size > 1) throw new ConvexError("Рестораны кампании должны принадлежать одной организации")
  if (organizations.size === 1) return [...organizations][0]
  const scopes = (await effectiveScopes(ctx, user, role)).organizationScopes.filter((id) => id !== "*")
  if (scopes.length === 1) return scopes[0]
  const organizationsRows = await ctx.db.query("organizations").take(2)
  const active = organizationsRows.filter((row) => row.active)
  if (organizationsRows.length === 1 && active.length === 1) return active[0].externalId
  throw new ConvexError("Выберите рестораны кампании — организация не определена")
}

function smsParts(text: string) {
  const unicode = /[^\x20-\x7E\n\r]/.test(text)
  const single = unicode ? 70 : 160
  const part = unicode ? 67 : 153
  return text.length <= single ? 1 : Math.ceil(text.length / part)
}

// --- Queries ----------------------------------------------------------------------------------

export const listCampaigns = query({
  args: { status: v.optional(status), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.campaigns.view")
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const page = needle
      ? await ctx.db.query("campaigns").withSearchIndex("search_campaigns", (q) => (args.status ? q.search("searchText", needle).eq("status", args.status) : q.search("searchText", needle))).paginate(args.paginationOpts)
      : args.status
        ? await ctx.db.query("campaigns").withIndex("by_status_scheduled", (q) => q.eq("status", args.status!)).order("desc").paginate(args.paginationOpts)
        : await ctx.db.query("campaigns").withIndex("by_scheduled").order("desc").paginate(args.paginationOpts)
    return { ...page, page: page.page.filter((row) => visibleTo(user, row)).map(({ template: _template, searchText: _search, ...row }) => row) }
  },
})

export const getCampaign = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.campaigns.view")
    const row = await ctx.db.query("campaigns").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!row || !visibleTo(user, row)) return null
    const pending = await Promise.all(PENDING_JOB_STATUSES.map((jobStatus) => ctx.db.query("integrationJobs").withIndex("by_source_status", (q) => q.eq("sourceExternalId", row.externalId).eq("status", jobStatus)).first()))
    return { ...row, jobsPending: pending.some(Boolean) }
  },
})

/** Pickers of the card: active guest categories (without office.guest-categories.view). */
export const campaignReferences = query({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.campaigns.view")
    const categories = await ctx.db.query("guestCategories").take(200)
    return { categories: categories.filter((row) => row.active).map((row) => ({ externalId: row.externalId, name: row.name })).sort((a, b) => a.name.localeCompare(b.name, "ru")) }
  },
})

/**
 * «Будет отправлено N гостям с согласием»: guests of the audience with consent in force, counted over
 * the first 200 active guests (capped: true — at least N).
 */
export const campaignAudience = query({
  args: { channel, categoryExternalId: v.optional(v.string()), restaurantExternalIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.campaigns.view")
    if (!args.restaurantExternalIds.length) return { count: 0, capped: false }
    await requireRestaurantScopes(ctx, user, args.restaurantExternalIds)
    const organizationExternalId = await campaignOrganization(ctx, user, role, args.restaurantExternalIds)
    const guests = await ctx.db.query("guests").withIndex("by_status_last_visit", (q) => q.eq("status", "active")).order("desc").take(PREVIEW_LIMIT)
    const now = Date.now()
    let count = 0
    for (const guest of guests) {
      if (inAudience(guest, { organizationExternalId, restaurantExternalIds: args.restaurantExternalIds, categoryExternalId: args.categoryExternalId }) && (await canMessageGuest(ctx, guest, args.channel, now))) count += 1
    }
    return { count, capped: guests.length === PREVIEW_LIMIT }
  },
})

// --- Mutations --------------------------------------------------------------------------------

export const saveCampaign = mutation({
  args: {
    externalId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    name: v.string(),
    channel,
    categoryExternalId: v.optional(v.string()),
    restaurantExternalIds: v.array(v.string()),
    scheduledAt: v.number(),
    quietHoursStart: v.number(),
    quietHoursEnd: v.number(),
    subject: v.optional(v.string()),
    template: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.campaigns.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const restaurantExternalIds = [...new Set(args.restaurantExternalIds)]
    if (!restaurantExternalIds.length) throw new ConvexError("Выберите рестораны")
    if (restaurantExternalIds.includes("*") && restaurantExternalIds.length > 1) throw new ConvexError("«Все рестораны» не сочетается с отдельными ресторанами")
    await requireRestaurantScopes(ctx, user, restaurantExternalIds)
    const existing = args.externalId ? await requireCampaign(ctx, args.externalId) : null
    if (existing) {
      await requireRestaurantScopes(ctx, user, existing.restaurantExternalIds)
      if (existing.status !== "draft") throw new ConvexError("Изменить можно только черновик")
      if (args.expectedVersion !== undefined && existing.version !== args.expectedVersion) throw new ConvexError("Кампания изменена другим пользователем. Обновите карточку")
    }
    const name = args.name.trim()
    if (name.length < 2) throw new ConvexError("Укажите название кампании")
    const template = args.template.trim()
    if (!template) throw new ConvexError("Напишите текст сообщения")
    if (template.length > MAX_TEMPLATE) throw new ConvexError(`Сообщение — не длиннее ${MAX_TEMPLATE} символов`)
    const subject = args.channel === "email" ? args.subject?.trim() : undefined
    if (args.channel === "email" && !subject) throw new ConvexError("Укажите тему письма")
    const { quietHoursStart: start, quietHoursEnd: end } = args
    if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 24 && start < end)) throw new ConvexError("Окно отправки: «не раньше» меньше «не позже», целые часы от 0 до 24")
    if (!Number.isFinite(args.scheduledAt)) throw new ConvexError("Укажите время запуска")
    if (!existing && args.scheduledAt < Date.now() - 3_600_000) throw new ConvexError("Время запуска уже прошло")
    if (args.categoryExternalId && !(await ctx.db.query("guestCategories").withIndex("by_external_id", (q) => q.eq("externalId", args.categoryExternalId!)).unique())) throw new ConvexError("Категория гостей не найдена")
    const organizationExternalId = existing?.organizationExternalId ?? (await campaignOrganization(ctx, user, role, restaurantExternalIds))
    if (existing && (await campaignOrganization(ctx, user, role, restaurantExternalIds)) !== existing.organizationExternalId) throw new ConvexError("Организацию кампании изменить нельзя")
    const now = Date.now()
    const number = existing?.number ?? (await nextNumber(ctx, { moduleId: "campaigns", prefix: "CMP", organizationExternalId, businessDate: almatyBusinessDate(args.scheduledAt) }))
    const value = {
      name,
      channel: args.channel,
      categoryExternalId: args.categoryExternalId || undefined,
      restaurantExternalIds,
      scheduledAt: args.scheduledAt,
      quietHoursStart: start,
      quietHoursEnd: end,
      subject,
      template,
      searchText: `${number} ${name} ${template}`.toLocaleLowerCase("ru"),
      updatedAt: now,
    }
    let externalId: string
    let version: number
    if (existing) {
      version = existing.version + 1
      externalId = existing.externalId
      await ctx.db.patch(existing._id, { ...value, version })
    } else {
      externalId = `campaign-${crypto.randomUUID()}`
      version = 1
      await ctx.db.insert("campaigns", { ...value, externalId, number, organizationExternalId, status: "draft", audienceCount: 0, sentCount: 0, failedCount: 0, enqueueState: "idle", version, createdBy: email, createdAt: now })
    }
    await writeOfficeAudit(ctx, email, {
      action: "campaign.save",
      summary: `Кампания ${number} «${name}»: ${args.channel === "sms" ? "SMS" : "email"}${args.channel === "sms" ? `, ${smsParts(template)} SMS` : ""}`,
      resourceType: "campaigns",
      resourceExternalId: externalId,
      ...(restaurantExternalIds[0] !== "*" ? { restaurantExternalId: restaurantExternalIds[0] } : {}),
      capability: "office.campaigns.edit",
    })
    return { externalId, number, version }
  },
})

const STEPS = {
  submit: { from: ["draft"], to: "pending-approval", capability: "edit" },
  approve: { from: ["pending-approval"], to: "approved", capability: "approve" },
  complete: { from: ["approved"], to: "completed", capability: "post" },
  cancel: { from: LIVE, to: "cancelled", capability: "cancel" },
} as const

async function hasPendingJobs(ctx: QueryCtx, campaignExternalId: string) {
  for (const jobStatus of PENDING_JOB_STATUSES) {
    if (await ctx.db.query("integrationJobs").withIndex("by_source_status", (q) => q.eq("sourceExternalId", campaignExternalId).eq("status", jobStatus)).first()) return true
  }
  return false
}

/**
 * Lifecycle steps. «Согласовать» starts queueing the audience; «Провести» closes a campaign whose
 * messages all left the queue; «Отменить» of an approved campaign cancels what is still queued.
 */
export const transitionCampaign = mutation({
  args: { externalId: v.string(), action: v.union(v.literal("submit"), v.literal("approve"), v.literal("complete"), v.literal("cancel")), expectedVersion: v.number(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const step = STEPS[args.action]
    const capability = `office.campaigns.${step.capability}`
    const { user } = await requireOfficeCapability(ctx, capability)
    const email = (await getOfficeAuthEmail(ctx))!
    const campaign = await requireCampaign(ctx, args.externalId)
    await requireRestaurantScopes(ctx, user, campaign.restaurantExternalIds)
    if (campaign.version !== args.expectedVersion) throw new ConvexError("Кампания изменена другим пользователем. Обновите карточку")
    if (!(step.from as readonly Status[]).includes(campaign.status)) throw new ConvexError("Действие недоступно для текущего статуса")
    const now = Date.now()
    const patch: Partial<Campaign> = {}
    if (args.action === "approve") {
      patch.approvedAt = now
      patch.enqueueState = "running"
      await ctx.scheduler.runAfter(0, internal.domains.loyalty.campaigns.enqueueCampaign, { campaignExternalId: campaign.externalId, cursor: null })
    }
    if (args.action === "complete") {
      if (campaign.enqueueState !== "done") throw new ConvexError("Аудитория ещё ставится в очередь — подождите")
      if (await hasPendingJobs(ctx, campaign.externalId)) throw new ConvexError("Сообщения ещё в очереди — провести можно после отправки или отмены")
      patch.completedAt = now
    }
    if (args.action === "cancel") {
      const reason = args.reason?.trim() ?? ""
      if (reason.length < 3) throw new ConvexError("Укажите причину отмены")
      patch.cancelReason = reason
      if (campaign.status === "approved") await ctx.scheduler.runAfter(0, internal.domains.loyalty.campaigns.cancelCampaignJobs, { campaignExternalId: campaign.externalId })
    }
    await ctx.db.patch(campaign._id, { ...patch, status: step.to, version: campaign.version + 1, updatedAt: now })
    await writeOfficeAudit(ctx, email, {
      action: `campaign.${args.action}`,
      summary: `${campaign.number}: ${campaign.status} → ${step.to}${args.reason ? ` — ${args.reason.trim()}` : ""}`,
      resourceType: "campaigns",
      resourceExternalId: campaign.externalId,
      capability,
    })
    await appendOutboxEvent(ctx, { aggregateType: "campaign", aggregateExternalId: campaign.externalId, eventType: `campaign.${step.to}`, organizationExternalId: campaign.organizationExternalId, payload: { number: campaign.number, channel: campaign.channel } })
    return { status: step.to, version: campaign.version + 1 }
  },
})

// --- Internal ---------------------------------------------------------------------------------

/**
 * One batch of the audience → integration jobs. Repeating a batch (or approving again) never doubles a
 * job: the idempotency key is campaign:<id>:<guest>:<channel>. The job keeps the guest id and a masked
 * contact only; the adapter reads the number or address at send time and re-checks the consent.
 */
export const enqueueCampaign = internalMutation({
  args: { campaignExternalId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.query("campaigns").withIndex("by_external_id", (q) => q.eq("externalId", args.campaignExternalId)).unique()
    if (!campaign || campaign.status !== "approved") return { queued: 0, done: true }
    const page = await ctx.db.query("guests").withIndex("by_status_last_visit", (q) => q.eq("status", "active")).paginate({ numItems: ENQUEUE_BATCH, cursor: args.cursor })
    const now = Date.now()
    const nextAttemptAt = nextAlmatyWindowTime(Math.max(now, campaign.scheduledAt), campaign.quietHoursStart, campaign.quietHoursEnd)
    let queued = 0
    for (const guest of page.page) {
      if (!inAudience(guest, campaign) || !(await canMessageGuest(ctx, guest, campaign.channel, now))) continue
      const guestExternalId = guest.externalId ?? `guest-${guest._id}`
      const result = await enqueueIntegrationJob(ctx, {
        provider: campaign.channel,
        operation: CAMPAIGN_OPERATION,
        sourceExternalId: campaign.externalId,
        idempotencyKey: `campaign:${campaign.externalId}:${guestExternalId}:${campaign.channel}`,
        organizationExternalId: campaign.organizationExternalId,
        nextAttemptAt,
        payload: {
          campaignExternalId: campaign.externalId,
          guestExternalId,
          channel: campaign.channel,
          recipient: campaign.channel === "sms" ? maskPhone(guest.phone) : maskEmail(guest.email),
          ...(campaign.subject ? { subject: campaign.subject } : {}),
          text: campaign.template,
          quietHours: { start: campaign.quietHoursStart, end: campaign.quietHoursEnd },
        },
      })
      if (result.created) queued += 1
    }
    await ctx.db.patch(campaign._id, { audienceCount: campaign.audienceCount + queued, enqueueState: page.isDone ? "done" : "running", updatedAt: now })
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.domains.loyalty.campaigns.enqueueCampaign, { campaignExternalId: campaign.externalId, cursor: page.continueCursor })
    return { queued, done: page.isDone }
  },
})

/** Cancels the still queued messages of a cancelled campaign, 200 at a time. */
export const cancelCampaignJobs = internalMutation({
  args: { campaignExternalId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now()
    let cancelled = 0
    for (const jobStatus of ["queued", "retrying"] as const) {
      const rows = await ctx.db.query("integrationJobs").withIndex("by_source_status", (q) => q.eq("sourceExternalId", args.campaignExternalId).eq("status", jobStatus)).take(ENQUEUE_BATCH - cancelled)
      for (const job of rows) await ctx.db.patch(job._id, { status: "cancelled", error: "Кампания отменена", updatedAt: now })
      cancelled += rows.length
      if (cancelled >= ENQUEUE_BATCH) break
    }
    if (cancelled >= ENQUEUE_BATCH) await ctx.scheduler.runAfter(0, internal.domains.loyalty.campaigns.cancelCampaignJobs, args)
    return { cancelled }
  },
})

/**
 * «Отправлено / Ошибок»: a campaign job reaching completed or dead-letter moves the counter; a retry of a
 * dead-letter job from the office takes its error back (delta −1).
 */
export async function countCampaignJob(ctx: MutationCtx, job: Pick<Doc<"integrationJobs">, "operation" | "sourceExternalId">, outcome: "completed" | "dead-letter", delta: 1 | -1 = 1) {
  if (job.operation !== CAMPAIGN_OPERATION || !job.sourceExternalId) return
  const campaign = await ctx.db.query("campaigns").withIndex("by_external_id", (q) => q.eq("externalId", job.sourceExternalId!)).unique()
  if (!campaign) return
  if (outcome === "completed") await ctx.db.patch(campaign._id, { sentCount: Math.max(0, campaign.sentCount + delta) })
  else await ctx.db.patch(campaign._id, { failedCount: Math.max(0, campaign.failedCount + delta) })
}
