import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { query } from "../../_generated/server"
import { requireOfficeCapability, restaurantScopeFilter } from "../../lib/officeAccess"
import { DOCUMENT_MODULES } from "../../lib/stockPosting"
import { assertDocumentScope } from "./access"
import { documentStatus, stockDocumentType } from "./validators"

export const listDocuments = query({
  args: { type: stockDocumentType, status: v.optional(documentStatus), search: v.optional(v.string()), restaurantExternalId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, `office.${DOCUMENT_MODULES[args.type].moduleId}.view`)
    restaurantScopeFilter(user, args.restaurantExternalId)
    const network = user.restaurantScopes.includes("*")
    const restaurant = args.restaurantExternalId ?? (!network && user.restaurantScopes.length === 1 ? user.restaurantScopes[0] : undefined)
    if (!network && !restaurant) throw new ConvexError("Выберите ресторан")
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    if (needle) {
      return ctx.db
        .query("stockDocuments")
        .withSearchIndex("search_stock_documents", (q) => {
          let scoped = q.search("searchText", needle).eq("type", args.type)
          if (args.status) scoped = scoped.eq("status", args.status)
          if (restaurant) scoped = scoped.eq("restaurantExternalId", restaurant)
          return scoped
        })
        .paginate(args.paginationOpts)
    }
    if (restaurant) {
      return args.status
        ? ctx.db.query("stockDocuments").withIndex("by_type_restaurant_status_date", (q) => q.eq("type", args.type).eq("restaurantExternalId", restaurant).eq("status", args.status!)).order("desc").paginate(args.paginationOpts)
        : ctx.db.query("stockDocuments").withIndex("by_type_restaurant_date", (q) => q.eq("type", args.type).eq("restaurantExternalId", restaurant)).order("desc").paginate(args.paginationOpts)
    }
    return args.status
      ? ctx.db.query("stockDocuments").withIndex("by_type_status_date", (q) => q.eq("type", args.type).eq("status", args.status!)).order("desc").paginate(args.paginationOpts)
      : ctx.db.query("stockDocuments").withIndex("by_type_restaurant_date", (q) => q.eq("type", args.type)).order("desc").paginate(args.paginationOpts)
  },
})

export const getDocument = query({
  args: { type: stockDocumentType, externalId: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, `office.${DOCUMENT_MODULES[args.type].moduleId}.view`)
    const document = await ctx.db.query("stockDocuments").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!document || document.type !== args.type) return null
    await assertDocumentScope(ctx, user, role, document)
    const lines = await ctx.db.query("stockDocumentLines").withIndex("by_document", (q) => q.eq("documentId", document._id)).take(200)
    const items = await Promise.all(lines.map((line) => ctx.db.get(line.inventoryItemId)))
    return {
      ...document,
      lines: lines.map((line, index) => ({ ...line, itemExternalId: items[index]?.externalId ?? null, itemName: items[index]?.name ?? null, unit: items[index]?.unit ?? null })),
    }
  },
})
