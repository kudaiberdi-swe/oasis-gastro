import { ConvexError } from "convex/values"
import type { GenericMutationCtx, GenericQueryCtx, PaginationOptions, PaginationResult } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"
import { writeOfficeAudit } from "./officeAccess"
import { transitionError, transitionFor, LIFECYCLES, type DomainAction, type DomainStatus, type Lifecycle } from "./lifecycles"
import { nextNumber } from "./numbering"
import { appendOutboxEvent } from "./outbox"
import { assertPeriodOpen } from "./periods"

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>

// Domain-record engine (W1-PLT-05): lifecycle, server numbering, OCC, period check, audit, outbox and
// index-based pagination for every office record table. Public functions check the office right and
// restaurant scope in their own handler and pass the verified user in.

/**
 * Tables that follow the domain-record contract: the same record shape and index names (by_external_id,
 * by_module_status_date, by_module_restaurant_date, a search index on searchText). The queries below are
 * typed against financeRecords (`as Base`); platformRecords has the same fields plus its own lookups.
 */
export type DomainTable = "financeRecords" | "platformRecords"
export type DomainRecord<T extends DomainTable = DomainTable> = Doc<T>
type Base = "financeRecords"
type BaseModuleId = Doc<Base>["moduleId"]

const SEARCH_INDEX: Record<DomainTable, string> = { financeRecords: "search_finance_records", platformRecords: "search_platform_records" }

export type ModuleDefinition<T extends DomainTable = DomainTable> = {
  moduleId: Doc<T>["moduleId"]
  lifecycle: Lifecycle
  prefix: string
  label: string
  /** false: reference data outside period locks (templates, settings) — edits never touch a closed period. */
  periodLocked?: boolean
}

type ScopedUser = { restaurantScopes: string[] }

const MAX_SCOPE_FILTER = 50

/**
 * A network-wide record (a template or setting of the whole organization) keeps this in
 * restaurantExternalId: only network users see it, and restaurant filters never match it.
 */
export const ORGANIZATION_SCOPE_PREFIX = "organization:"
export const organizationScopeId = (organizationExternalId: string) => `${ORGANIZATION_SCOPE_PREFIX}${organizationExternalId}`
export const isOrganizationScope = (restaurantExternalId: string) => restaurantExternalId.startsWith(ORGANIZATION_SCOPE_PREFIX)

export async function listDomainRecords<T extends DomainTable>(
  ctx: QueryCtx,
  table: T,
  user: ScopedUser,
  args: { moduleId: Doc<T>["moduleId"]; status?: DomainStatus; restaurantExternalId?: string; search?: string; paginationOpts: PaginationOptions },
): Promise<PaginationResult<Doc<T>>> {
  const network = user.restaurantScopes.includes("*")
  // A branch user reads their restaurants; one restaurant narrows the index directly.
  const restaurant = args.restaurantExternalId ?? (!network && user.restaurantScopes.length === 1 ? user.restaurantScopes[0] : undefined)
  const scopes = network || restaurant ? null : user.restaurantScopes.slice(0, MAX_SCOPE_FILTER)
  const search = args.search?.trim().toLocaleLowerCase("ru")
  const moduleId = args.moduleId as BaseModuleId
  const source = table as Base

  if (search) {
    return ctx.db
      .query(source)
      .withSearchIndex(SEARCH_INDEX[table] as "search_finance_records", (q) => {
        let scoped = q.search("searchText", search).eq("moduleId", moduleId)
        if (args.status) scoped = scoped.eq("status", args.status)
        if (restaurant) scoped = scoped.eq("restaurantExternalId", restaurant)
        return scoped
      })
      .filter((q) => (scopes ? q.or(...scopes.map((scope) => q.eq(q.field("restaurantExternalId"), scope))) : true))
      .paginate(args.paginationOpts) as unknown as Promise<PaginationResult<Doc<T>>>
  }

  const base = restaurant
    ? ctx.db.query(source).withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", moduleId).eq("restaurantExternalId", restaurant))
    : args.status
      ? ctx.db.query(source).withIndex("by_module_status_date", (q) => q.eq("moduleId", moduleId).eq("status", args.status!))
      : ctx.db.query(source).withIndex("by_module_status_date", (q) => q.eq("moduleId", moduleId))
  return base
    .order("desc")
    .filter((q) =>
      q.and(
        restaurant && args.status ? q.eq(q.field("status"), args.status) : true,
        scopes ? q.or(...scopes.map((scope) => q.eq(q.field("restaurantExternalId"), scope))) : true,
      ),
    )
    .paginate(args.paginationOpts) as unknown as Promise<PaginationResult<Doc<T>>>
}

async function recordByExternalId<T extends DomainTable>(ctx: QueryCtx, table: T, externalId: string) {
  return (await ctx.db.query(table as Base).withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()) as Doc<T> | null
}

export async function getDomainRecord<T extends DomainTable>(ctx: QueryCtx, table: T, user: ScopedUser, moduleId: Doc<T>["moduleId"], externalId: string) {
  const record = await recordByExternalId(ctx, table, externalId)
  if (!record || record.moduleId !== moduleId) return null
  if (!user.restaurantScopes.includes("*") && !user.restaurantScopes.includes(record.restaurantExternalId)) return null
  return record
}

export type SaveDomainRecordArgs = {
  externalId?: string
  expectedVersion?: number
  name: string
  /** A restaurant, or organizationScopeId(…) for a network-wide record. */
  restaurantExternalId: string
  businessDate: string
  amount: number
  debitAccountExternalId?: string
  creditAccountExternalId?: string
  cashflowCategoryExternalId?: string
  counterpartyExternalId?: string
  data: Doc<Base>["data"]
  /** Top-level fields a module derives from its data (counterparties: bin). */
  bin?: string
  /** platformRecords: the module's lookup key and equipment routing. */
  lookupKey?: string
  routing?: Doc<"platformRecords">["routing"]
}

// Long text (a print template, a JSON value) is not searched: it would only bloat the search index.
function searchTextOf(record: { number: string; name: string; data: Doc<Base>["data"] }) {
  const values = Object.values(record.data).filter((value) => typeof value === "number" || (typeof value === "string" && value.length <= 200))
  return [record.number, record.name, ...values].join(" ").toLocaleLowerCase("ru")
}

/** The organization and restaurant (or organization scope) a record belongs to. */
async function recordOwner(ctx: QueryCtx, restaurantExternalId: string) {
  if (isOrganizationScope(restaurantExternalId)) {
    const organizationExternalId = restaurantExternalId.slice(ORGANIZATION_SCOPE_PREFIX.length)
    const organization = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", organizationExternalId)).unique()
    if (!organization) throw new ConvexError("Организация не найдена")
    return { organizationExternalId, restaurantExternalId }
  }
  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurantExternalId)).unique()
  if (!restaurant) throw new ConvexError("Ресторан не найден")
  return { organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId }
}

export async function saveDomainRecord<T extends DomainTable>(ctx: MutationCtx, table: T, actorEmail: string, module: ModuleDefinition<T>, args: SaveDomainRecordArgs): Promise<Doc<T>> {
  const name = args.name.trim()
  if (!name) throw new ConvexError("Укажите название")
  if (!Number.isInteger(args.amount) || args.amount < 0) throw new ConvexError("Сумма должна быть целым неотрицательным числом тенге")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.businessDate)) throw new ConvexError("Некорректная дата")
  if (args.debitAccountExternalId && args.debitAccountExternalId === args.creditAccountExternalId) throw new ConvexError("Дебет и кредит должны отличаться")

  const owner = await recordOwner(ctx, args.restaurantExternalId)
  const existing = args.externalId ? await recordByExternalId(ctx, table, args.externalId) : null
  if (args.externalId && (!existing || existing.moduleId !== module.moduleId)) throw new ConvexError("Запись не найдена")
  const periodLocked = module.periodLocked !== false
  if (existing) {
    if (!LIFECYCLES[module.lifecycle].editable.includes(existing.status)) throw new ConvexError("Запись в этом статусе нельзя изменить")
    if (args.expectedVersion !== undefined && args.expectedVersion !== existing.version) throw new ConvexError("Запись изменена другим пользователем — обновите страницу")
    if (existing.restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Ресторан записи менять нельзя")
    if (periodLocked) await assertPeriodOpen(ctx, { organizationExternalId: existing.organizationExternalId, restaurantExternalId: existing.restaurantExternalId, businessDate: existing.businessDate, moduleId: module.moduleId })
  }
  if (periodLocked) await assertPeriodOpen(ctx, { organizationExternalId: owner.organizationExternalId, restaurantExternalId: owner.restaurantExternalId, businessDate: args.businessDate, moduleId: module.moduleId })

  const now = Date.now()
  const fields = {
    name,
    businessDate: args.businessDate,
    amount: args.amount,
    data: args.data,
    ...(table === "financeRecords"
      ? {
          debitAccountExternalId: args.debitAccountExternalId,
          creditAccountExternalId: args.creditAccountExternalId,
          cashflowCategoryExternalId: args.cashflowCategoryExternalId,
          counterpartyExternalId: args.counterpartyExternalId,
          ...(args.bin !== undefined ? { bin: args.bin } : {}),
        }
      : { lookupKey: args.lookupKey, routing: args.routing }),
  }
  let record: Doc<T>
  if (existing) {
    const next = { ...fields, version: existing.version + 1, updatedAt: now, searchText: searchTextOf({ number: existing.number, name, data: args.data }) }
    await ctx.db.patch(existing._id, next as never)
    record = { ...existing, ...next }
  } else {
    const number = await nextNumber(ctx, { moduleId: module.moduleId, prefix: module.prefix, organizationExternalId: owner.organizationExternalId, businessDate: args.businessDate })
    const externalId = `${module.moduleId}-${crypto.randomUUID()}`
    const id = await ctx.db.insert(table, {
      ...fields,
      externalId,
      moduleId: module.moduleId,
      number,
      status: LIFECYCLES[module.lifecycle].initial,
      organizationExternalId: owner.organizationExternalId,
      restaurantExternalId: owner.restaurantExternalId,
      searchText: searchTextOf({ number, name, data: args.data }),
      version: 1,
      createdAt: now,
      updatedAt: now,
    } as never)
    record = (await ctx.db.get(id))! as Doc<T>
  }

  await writeOfficeAudit(ctx, actorEmail, {
    action: `${module.moduleId}.${existing ? "update" : "create"}`,
    summary: `${module.label} ${record.number}: ${existing ? "изменение" : "создание"}`,
    resourceType: module.moduleId,
    resourceExternalId: record.externalId,
    ...eventScope(record.organizationExternalId, record.restaurantExternalId),
    capability: `office.${module.moduleId}.edit`,
    details: { number: record.number, version: record.version },
  })
  await appendOutboxEvent(ctx, {
    aggregateType: module.moduleId,
    aggregateExternalId: record.externalId,
    eventType: `domain-record.${existing ? "updated" : "created"}`,
    ...eventScope(record.organizationExternalId, record.restaurantExternalId),
    payload: { number: record.number, version: record.version },
  })
  return record
}

/** Audit and outbox scope: a network-wide record has an organization and no restaurant. */
function eventScope(organizationExternalId: string, restaurantExternalId: string) {
  return isOrganizationScope(restaurantExternalId) ? { organizationExternalId } : { restaurantExternalId }
}

/** The right a transition needs — handlers check it before calling transitionDomainRecord. */
export function transitionCapability(module: ModuleDefinition, action: DomainAction) {
  const transition = transitionFor(module.lifecycle, action)
  if (!transition) throw new ConvexError("Действие недоступно для этого раздела")
  return `office.${module.moduleId}.${transition.capability}`
}

export type TransitionHooks<T extends DomainTable = "financeRecords"> = {
  beforePost?: (record: Doc<T>) => Promise<void>
  afterPost?: (record: Doc<T>) => Promise<void>
  beforeReverse?: (record: Doc<T>) => Promise<void>
  beforeCancel?: (record: Doc<T>) => Promise<void>
  /** publish: e.g. check the record once more and retire the version it replaces. */
  beforePublish?: (record: Doc<T>) => Promise<void>
  afterPublish?: (record: Doc<T>) => Promise<void>
}

export async function transitionDomainRecord<T extends DomainTable>(
  ctx: MutationCtx,
  table: T,
  actorEmail: string,
  user: ScopedUser,
  module: ModuleDefinition<T>,
  args: { externalId: string; action: DomainAction; expectedVersion: number; reason?: string },
  hooks: TransitionHooks<T> = {},
): Promise<Doc<T>> {
  const transition = transitionFor(module.lifecycle, args.action)
  if (!transition) throw new ConvexError("Действие недоступно для этого раздела")
  const record = await recordByExternalId(ctx, table, args.externalId)
  if (!record || record.moduleId !== module.moduleId || !(user.restaurantScopes.includes("*") || user.restaurantScopes.includes(record.restaurantExternalId))) {
    throw new ConvexError("Запись не найдена")
  }
  if (record.version !== args.expectedVersion) throw new ConvexError("Запись изменена другим пользователем — обновите страницу")
  if (!transition.from.includes(record.status)) throw new ConvexError(transitionError(args.action, record.status))
  if ((args.action === "reverse" || args.action === "cancel") && !args.reason?.trim()) throw new ConvexError("Укажите причину")
  if (module.periodLocked !== false) {
    await assertPeriodOpen(ctx, { organizationExternalId: record.organizationExternalId, restaurantExternalId: record.restaurantExternalId, businessDate: record.businessDate, moduleId: module.moduleId })
  }

  if (args.action === "post") await hooks.beforePost?.(record)
  if (args.action === "reverse") await hooks.beforeReverse?.(record)
  if (args.action === "cancel") await hooks.beforeCancel?.(record)
  if (args.action === "publish") await hooks.beforePublish?.(record)
  const now = Date.now()
  const patch = {
    status: transition.to,
    version: record.version + 1,
    updatedAt: now,
    ...(transition.to === "posted" ? { postedAt: now } : {}),
    ...(transition.to === "reversed" ? { reversedAt: now } : {}),
  }
  await ctx.db.patch(record._id, patch as never)
  const updated = { ...record, ...patch }
  if (args.action === "post") await hooks.afterPost?.(updated)
  if (args.action === "publish") await hooks.afterPublish?.(updated)

  await writeOfficeAudit(ctx, actorEmail, {
    action: `${module.moduleId}.${args.action}`,
    summary: `${module.label} ${record.number}: ${args.action}${args.reason ? ` — ${args.reason.trim()}` : ""}`,
    resourceType: module.moduleId,
    resourceExternalId: record.externalId,
    ...eventScope(record.organizationExternalId, record.restaurantExternalId),
    capability: `office.${module.moduleId}.${transition.capability}`,
    details: { from: record.status, to: transition.to, reason: args.reason?.trim() },
  })
  await appendOutboxEvent(ctx, {
    aggregateType: module.moduleId,
    aggregateExternalId: record.externalId,
    eventType: `domain-record.${args.action}`,
    ...eventScope(record.organizationExternalId, record.restaurantExternalId),
    payload: { from: record.status, to: transition.to },
  })
  return updated
}
