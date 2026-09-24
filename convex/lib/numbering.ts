import type { GenericMutationCtx } from "convex/server"

import type { DataModel } from "../_generated/dataModel"

type MutationCtx = GenericMutationCtx<DataModel>

/**
 * Server-side document numbers: <PREFIX>-<YYYY>-<NNNNN>, one sequence per module, organization and
 * year in documentCounters. Convex serializes the counter write, so concurrent saves get distinct numbers.
 */
export async function nextNumber(ctx: MutationCtx, args: { moduleId: string; prefix: string; organizationExternalId: string; businessDate: string }) {
  const year = args.businessDate.slice(0, 4)
  const scopeKey = `${args.moduleId}:${args.organizationExternalId}:${year}`
  const counter = await ctx.db.query("documentCounters").withIndex("by_scope_key", (q) => q.eq("scopeKey", scopeKey)).unique()
  const value = counter?.next ?? 1
  if (counter) await ctx.db.patch(counter._id, { next: value + 1 })
  else await ctx.db.insert("documentCounters", { scopeKey, next: value + 1 })
  return `${args.prefix}-${year}-${String(value).padStart(5, "0")}`
}
