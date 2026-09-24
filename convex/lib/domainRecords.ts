import { ConvexError } from "convex/values"
import type { GenericMutationCtx, GenericQueryCtx, PaginationOptions } from "convex/server"

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

/** Tables that follow the domain-record contract (by_external_id, by_module_status_date, by_module_restaurant_date, search). */
export type DomainTable = "financeRecords"
export type DomainRecord = Doc<DomainTable>

export type ModuleDefinition = { moduleId: DomainRecord["moduleId"]; lifecycle: Lifecycle; prefix: string; label: string }

type ScopedUser = { restaurantScopes: string[] }

const MAX_SCOPE_FILTER = 50

export async function listDomainRecords(
  ctx: QueryCtx,
  table: DomainTable,
  user: ScopedUser,
  args: { moduleId: DomainRecord["moduleId"]; status?: DomainStatus; restaurantExternalId?: string; search?: string; paginationOpts: PaginationOptions },
) {
  const network = user.restaurantScopes.includes("*")
  // A branch user reads their restaurants; one restaurant narrows the index directly.
  const restaurant = args.restaurantExternalId ?? (!network && user.restaurantScopes.length === 1 ? user.restaurantScopes[0] : undefined)
  const scopes = network || restaurant ? null : user.restaurantScopes.slice(0, MAX_SCOPE_FILTER)
  const search = args.search?.trim().toLocaleLowerCase("ru")

  if (search) {
    return ctx.db
      .query(table)
      .withSearchIndex("search_finance_records", (q) => {
        let scoped = q.search("searchText", search).eq("moduleId", args.moduleId)
        if (args.status) scoped = scoped.eq("status", args.status)
        if (restaurant) scoped = scoped.eq("restaurantExternalId", restaurant)
        return scoped
      })
      .filter((q) => (scopes ? q.or(...scopes.map((scope) => q.eq(q.field("restaurantExternalId"), scope))) : true))
      .paginate(args.paginationOpts)
  }

  const base = restaurant
    ? ctx.db.query(table).withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", args.moduleId).eq("restaurantExternalId", restaurant))
    : args.status
      ? ctx.db.query(table).withIndex("by_module_status_date", (q) => q.eq("moduleId", args.moduleId).eq("status", args.status!))
      : ctx.db.query(table).withIndex("by_module_status_date", (q) => q.eq("moduleId", args.moduleId))
  return base
    .order("desc")
    .filter((q) =>
      q.and(
        restaurant && args.status ? q.eq(q.field("status"), args.status) : true,
        scopes ? q.or(...scopes.map((scope) => q.eq(q.field("restaurantExternalId"), scope))) : true,
      ),
    )
    .paginate(args.paginationOpts)
}

export async function getDomainRecord(ctx: QueryCtx, table: DomainTable, user: ScopedUser, moduleId: DomainRecord["moduleId"], externalId: string) {
  const record = await ctx.db.query(table).withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!record || record.moduleId !== moduleId) return null
  if (!user.restaurantScopes.includes("*") && !user.restaurantScopes.includes(record.restaurantExternalId)) return null
  return record
}

export type SaveDomainRecordArgs = {
  externalId?: string
  expectedVersion?: number
  name: string
  restaurantExternalId: string
  businessDate: string
  amount: number
  debitAccountExternalId?: string
  creditAccountExternalId?: string
  cashflowCategoryExternalId?: string
  counterpartyExternalId?: string
  data: DomainRecord["data"]
  /** Top-level fields a module derives from its data (counterparties: bin). */
  bin?: string
}

function searchTextOf(record: Pick<DomainRecord, "number" | "name" | "data">) {
  const values = Object.values(record.data).filter((value) => typeof value === "string" || typeof value === "number")
  return [record.number, record.name, ...values].join(" ").toLocaleLowerCase("ru")
}

export async function saveDomainRecord(ctx: MutationCtx, table: DomainTable, actorEmail: string, module: ModuleDefinition, args: SaveDomainRecordArgs) {
  const name = args.name.trim()
  if (!name) throw new ConvexError("Укажите название")
  if (!Number.isInteger(args.amount) || args.amount < 0) throw new ConvexError("Сумма должна быть целым неотрицательным числом тенге")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.businessDate)) throw new ConvexError("Некорректная дата")
  if (args.debitAccountExternalId && args.debitAccountExternalId === args.creditAccountExternalId) throw new ConvexError("Дебет и кредит должны отличаться")

  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
  if (!restaurant) throw new ConvexError("Ресторан не найден")
  const existing = args.externalId ? await ctx.db.query(table).withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique() : null
  if (args.externalId && (!existing || existing.moduleId !== module.moduleId)) throw new ConvexError("Запись не найдена")
  if (existing) {
    if (!LIFECYCLES[module.lifecycle].editable.includes(existing.status)) throw new ConvexError("Запись в этом статусе нельзя изменить")
    if (args.expectedVersion !== undefined && args.expectedVersion !== existing.version) throw new ConvexError("Запись изменена другим пользователем — обновите страницу")
    if (existing.restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Ресторан записи менять нельзя")
    await assertPeriodOpen(ctx, { organizationExternalId: existing.organizationExternalId, restaurantExternalId: existing.restaurantExternalId, businessDate: existing.businessDate, moduleId: module.moduleId })
  }
  await assertPeriodOpen(ctx, { organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, businessDate: args.businessDate, moduleId: module.moduleId })

  const now = Date.now()
  const fields = {
    name,
    businessDate: args.businessDate,
    amount: args.amount,
    debitAccountExternalId: args.debitAccountExternalId,
    creditAccountExternalId: args.creditAccountExternalId,
    cashflowCategoryExternalId: args.cashflowCategoryExternalId,
    counterpartyExternalId: args.counterpartyExternalId,
    data: args.data,
    ...(args.bin !== undefined ? { bin: args.bin } : {}),
  }
  let record: DomainRecord
  if (existing) {
    const next = { ...fields, version: existing.version + 1, updatedAt: now, searchText: searchTextOf({ number: existing.number, name, data: args.data }) }
    await ctx.db.patch(existing._id, next)
    record = { ...existing, ...next }
  } else {
    const number = await nextNumber(ctx, { moduleId: module.moduleId, prefix: module.prefix, organizationExternalId: restaurant.organizationExternalId, businessDate: args.businessDate })
    const externalId = `${module.moduleId}-${crypto.randomUUID()}`
    const id = await ctx.db.insert(table, {
      ...fields,
      externalId,
      moduleId: module.moduleId,
      number,
      status: LIFECYCLES[module.lifecycle].initial,
      organizationExternalId: restaurant.organizationExternalId,
      restaurantExternalId: restaurant.externalId,
      searchText: searchTextOf({ number, name, data: args.data }),
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    record = (await ctx.db.get(id))!
  }

  await writeOfficeAudit(ctx, actorEmail, {
    action: `${module.moduleId}.${existing ? "update" : "create"}`,
    summary: `${module.label} ${record.number}: ${existing ? "изменение" : "создание"}`,
    resourceType: module.moduleId,
    resourceExternalId: record.externalId,
    restaurantExternalId: record.restaurantExternalId,
    capability: `office.${module.moduleId}.edit`,
    details: { number: record.number, version: record.version },
  })
  await appendOutboxEvent(ctx, {
    aggregateType: module.moduleId,
    aggregateExternalId: record.externalId,
    eventType: `domain-record.${existing ? "updated" : "created"}`,
    restaurantExternalId: record.restaurantExternalId,
    payload: { number: record.number, version: record.version },
  })
  return record
}

/** The right a transition needs — handlers check it before calling transitionDomainRecord. */
export function transitionCapability(module: ModuleDefinition, action: DomainAction) {
  const transition = transitionFor(module.lifecycle, action)
  if (!transition) throw new ConvexError("Действие недоступно для этого раздела")
  return `office.${module.moduleId}.${transition.capability}`
}

export type TransitionHooks = {
  beforePost?: (record: DomainRecord) => Promise<void>
  afterPost?: (record: DomainRecord) => Promise<void>
  beforeReverse?: (record: DomainRecord) => Promise<void>
}

export async function transitionDomainRecord(
  ctx: MutationCtx,
  table: DomainTable,
  actorEmail: string,
  user: ScopedUser,
  module: ModuleDefinition,
  args: { externalId: string; action: DomainAction; expectedVersion: number; reason?: string },
  hooks: TransitionHooks = {},
) {
  const transition = transitionFor(module.lifecycle, args.action)
  if (!transition) throw new ConvexError("Действие недоступно для этого раздела")
  const record = await ctx.db.query(table).withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
  if (!record || record.moduleId !== module.moduleId || !(user.restaurantScopes.includes("*") || user.restaurantScopes.includes(record.restaurantExternalId))) {
    throw new ConvexError("Запись не найдена")
  }
  if (record.version !== args.expectedVersion) throw new ConvexError("Запись изменена другим пользователем — обновите страницу")
  if (!transition.from.includes(record.status)) throw new ConvexError(transitionError(args.action, record.status))
  if ((args.action === "reverse" || args.action === "cancel") && !args.reason?.trim()) throw new ConvexError("Укажите причину")
  await assertPeriodOpen(ctx, { organizationExternalId: record.organizationExternalId, restaurantExternalId: record.restaurantExternalId, businessDate: record.businessDate, moduleId: module.moduleId })

  if (args.action === "post") await hooks.beforePost?.(record)
  if (args.action === "reverse") await hooks.beforeReverse?.(record)
  const now = Date.now()
  const patch = {
    status: transition.to,
    version: record.version + 1,
    updatedAt: now,
    ...(transition.to === "posted" ? { postedAt: now } : {}),
    ...(transition.to === "reversed" ? { reversedAt: now } : {}),
  }
  await ctx.db.patch(record._id, patch)
  const updated = { ...record, ...patch }
  if (args.action === "post") await hooks.afterPost?.(updated)

  await writeOfficeAudit(ctx, actorEmail, {
    action: `${module.moduleId}.${args.action}`,
    summary: `${module.label} ${record.number}: ${args.action}${args.reason ? ` — ${args.reason.trim()}` : ""}`,
    resourceType: module.moduleId,
    resourceExternalId: record.externalId,
    restaurantExternalId: record.restaurantExternalId,
    capability: `office.${module.moduleId}.${transition.capability}`,
    details: { from: record.status, to: transition.to, reason: args.reason?.trim() },
  })
  await appendOutboxEvent(ctx, {
    aggregateType: module.moduleId,
    aggregateExternalId: record.externalId,
    eventType: `domain-record.${args.action}`,
    restaurantExternalId: record.restaurantExternalId,
    payload: { from: record.status, to: transition.to },
  })
  return updated
}
