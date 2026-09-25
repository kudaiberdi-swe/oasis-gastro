import { ConvexError, v } from "convex/values"

import { mutation, query } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { effectiveScopes, getOfficeAuthEmail, hasScope, requireOfficeCapability, requireOrganizationScope, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"

// «Подразделения» (W2-ADM-08): a tree per organization. No cycles, the parent is in the same organization.
// «Создать из iiko» copies a mirrored iiko department once; later imports never change it.

const kind = v.union(v.literal("restaurant"), v.literal("production"), v.literal("warehouse"), v.literal("office"), v.literal("delivery"))

export const listDepartments = query({
  args: { organizationExternalId: v.optional(v.string()), status: v.optional(v.union(v.literal("active"), v.literal("inactive"))) },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.departments.view")
    const scopes = await effectiveScopes(ctx, user, role)
    if (args.organizationExternalId) await requireOrganizationScope(ctx, user, args.organizationExternalId, role)
    const rows = args.organizationExternalId
      ? await ctx.db.query("departments").withIndex("by_org_parent", (q) => q.eq("organizationExternalId", args.organizationExternalId!)).take(200)
      : await ctx.db.query("departments").take(200)
    const visible = rows.filter((row) => hasScope(scopes.organizationScopes, row.organizationExternalId) && (!args.status || row.active === (args.status === "active")))
    // Depth-first order with levels, so the register can indent the tree.
    const children = new Map<string | undefined, Doc<"departments">[]>()
    for (const row of visible) children.set(row.parentExternalId, [...(children.get(row.parentExternalId) ?? []), row])
    const known = new Set(visible.map((row) => row.externalId))
    const ordered: (Doc<"departments"> & { level: number; managerName: string | null })[] = []
    const walk = async (parent: string | undefined, level: number) => {
      for (const row of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, "ru"))) {
        const manager = row.managerEmployeeId ? await ctx.db.get(row.managerEmployeeId) : null
        ordered.push({ ...row, level, managerName: manager?.displayName ?? null })
        await walk(row.externalId, level + 1)
      }
    }
    await walk(undefined, 0)
    for (const row of visible) if (row.parentExternalId && !known.has(row.parentExternalId) && !ordered.some((item) => item._id === row._id)) {
      ordered.push({ ...row, level: 0, managerName: null })
      await walk(row.externalId, 1)
    }
    return ordered
  },
})

export const saveDepartment = mutation({
  args: {
    externalId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    organizationExternalId: v.string(),
    restaurantExternalId: v.optional(v.string()),
    code: v.string(),
    name: v.string(),
    parentExternalId: v.optional(v.string()),
    kind,
    managerEmployeeId: v.optional(v.id("employees")),
    costCenter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.departments.edit")
    await requireOrganizationScope(ctx, user, args.organizationExternalId, role)
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    const code = args.code.trim()
    if (!name || !code) throw new ConvexError("Укажите код и название")
    if (args.restaurantExternalId) {
      await requireRestaurantScope(ctx, user, args.restaurantExternalId)
      const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId!)).unique()
      if (!restaurant || restaurant.organizationExternalId !== args.organizationExternalId) throw new ConvexError("Ресторан другой организации")
    }
    // The parent chain must stay in the organization and never come back to this department.
    let parentId = args.parentExternalId
    for (let depth = 0; parentId && depth < 30; depth += 1) {
      if (parentId === args.externalId) throw new ConvexError("Подразделение не может быть родителем самого себя")
      const parent = await ctx.db.query("departments").withIndex("by_external_id", (q) => q.eq("externalId", parentId!)).unique()
      if (!parent) throw new ConvexError("Родительское подразделение не найдено")
      if (parent.organizationExternalId !== args.organizationExternalId) throw new ConvexError("Родитель должен быть в той же организации")
      parentId = parent.parentExternalId
    }
    const now = Date.now()
    const value = { organizationExternalId: args.organizationExternalId, restaurantExternalId: args.restaurantExternalId, code, name, parentExternalId: args.parentExternalId, kind: args.kind, managerEmployeeId: args.managerEmployeeId, costCenter: args.costCenter?.trim() || undefined, updatedAt: now }
    let externalId = args.externalId
    if (externalId) {
      const existing = await ctx.db.query("departments").withIndex("by_external_id", (q) => q.eq("externalId", externalId!)).unique()
      if (!existing) throw new ConvexError("Подразделение не найдено")
      if (args.expectedVersion !== undefined && existing.version !== args.expectedVersion) throw new ConvexError("Подразделение изменил другой пользователь — обновите страницу")
      await ctx.db.patch(existing._id, { ...value, version: existing.version + 1 })
    } else {
      externalId = `department-${crypto.randomUUID()}`
      await ctx.db.insert("departments", { ...value, externalId, active: true, version: 1, createdAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: "department.save", summary: `Подразделение «${name}»`, resourceType: "department", resourceExternalId: externalId, capability: "office.departments.edit" })
    return externalId
  },
})

export const setDepartmentActive = mutation({
  args: { externalId: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.departments.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const department = await ctx.db.query("departments").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!department) throw new ConvexError("Подразделение не найдено")
    await requireOrganizationScope(ctx, user, department.organizationExternalId, role)
    await ctx.db.patch(department._id, { active: args.active, version: department.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "department.status", summary: `Подразделение «${department.name}»: ${args.active ? "включено" : "отключено"}`, resourceType: "department", resourceExternalId: department.externalId, capability: "office.departments.edit" })
  },
})

/** «Создать из iiko»: one department from the read-only mirror, linked by iikoDepartmentExternalId. */
export const createFromIiko = mutation({
  args: { iikoDepartmentExternalId: v.string(), organizationExternalId: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.departments.edit")
    await requireOrganizationScope(ctx, user, args.organizationExternalId, role)
    const email = (await getOfficeAuthEmail(ctx))!
    const source = await ctx.db.query("iikoDepartments").withIndex("by_external_id", (q) => q.eq("externalId", args.iikoDepartmentExternalId)).unique()
    if (!source) throw new ConvexError("Подразделение iiko не найдено")
    const existing = (await ctx.db.query("departments").withIndex("by_org_parent", (q) => q.eq("organizationExternalId", args.organizationExternalId)).take(200)).find((row) => row.iikoDepartmentExternalId === source.externalId)
    if (existing) return existing.externalId
    const link = await ctx.db.query("restaurantSourceLinks").withIndex("by_department", (q) => q.eq("iikoDepartmentExternalId", source.externalId)).first()
    const now = Date.now()
    const externalId = `department-iiko-${source.externalId}`
    await ctx.db.insert("departments", { externalId, organizationExternalId: args.organizationExternalId, restaurantExternalId: link?.restaurantExternalId, code: source.code ?? source.externalId.slice(0, 8), name: source.name, kind: source.type === "DEPARTMENT" ? "restaurant" : "office", active: true, sourceSystem: "iiko-server", iikoDepartmentExternalId: source.externalId, version: 1, createdAt: now, updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: "department.save", summary: `Подразделение «${source.name}» создано из iiko`, resourceType: "department", resourceExternalId: externalId, capability: "office.departments.edit" })
    return externalId
  },
})
