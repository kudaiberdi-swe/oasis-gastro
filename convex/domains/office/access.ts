import { ConvexError, v } from "convex/values"

import { mutation, query } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { allowsCapability, CAPABILITY_CATALOG, isValidCapability } from "../../lib/capabilities"
import { effectiveScopes, getOfficeAuthEmail, hasScope, requireOfficeCapability, restaurantScopeFilter, scopedRestaurants, writeOfficeAudit } from "../../lib/officeAccess"

// «Роли и права» and «Пользователи» (W1-ACL-04). An editor can never grant more than they have:
// rights, restaurants, warehouses and organizations are all bounded by the editor's own.

function normalizeCode(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")
}

/** Sections with at least one right — the «N разрешений» count on the role list. */
function grantedSections(capabilities: string[]) {
  if (capabilities.includes("*")) return CAPABILITY_CATALOG.length
  return CAPABILITY_CATALOG.filter((section) => section.actions.some((action) => allowsCapability(capabilities, `office.${section.id}.${action}`))).length
}

/** Every concrete right a capability stands for, for the "not more than the editor" rule. */
function concreteRights(capability: string): string[] {
  if (capability === "*") return CAPABILITY_CATALOG.flatMap((section) => section.actions.map((action) => `office.${section.id}.${action}`))
  const wildcard = /^office\.(.+)\.\*$/.exec(capability)
  if (wildcard) return (CAPABILITY_CATALOG.find((section) => section.id === wildcard[1])?.actions ?? []).map((action) => `office.${wildcard[1]}.${action}`)
  return [capability]
}

function exceeds(editor: Doc<"officeRoles">, capabilities: string[]) {
  if (editor.capabilities.includes("*")) return null
  return capabilities.flatMap(concreteRights).find((right) => !allowsCapability(editor.capabilities, right)) ?? null
}

export const listAccessControl = query({
  args: {},
  handler: async (ctx) => {
    // Either screen reads the same data: roles.view or users.view.
    const { user, role } = await requireOfficeCapability(ctx, "office.roles.view").catch(async (error) => {
      if (error instanceof ConvexError && error.data === "Недостаточно прав") return requireOfficeCapability(ctx, "office.users.view")
      throw error
    })
    const scopes = await effectiveScopes(ctx, user, role)
    const inScope = restaurantScopeFilter(user)
    const [roles, users, restaurants] = await Promise.all([
      ctx.db.query("officeRoles").withIndex("by_external_id").take(200),
      ctx.db.query("officeUsers").withIndex("by_external_id").take(200),
      scopedRestaurants(ctx, user),
    ])
    // Users within the editor's organizations (a user with no organization scope yet counts by restaurants).
    const visibleUsers = []
    for (const candidate of users) {
      const candidateScopes = await effectiveScopes(ctx, candidate)
      const sameOrganization =
        scopes.organizationScopes.includes("*") ||
        candidateScopes.organizationScopes.some((organization) => organization !== "*" && hasScope(scopes.organizationScopes, organization)) ||
        candidate.restaurantScopes.some((restaurant) => restaurant !== "*" && inScope(restaurant))
      if (sameOrganization) visibleUsers.push({ ...candidate, organizationScopes: candidateScopes.organizationScopes, warehouseScopes: candidateScopes.warehouseScopes })
    }
    return {
      roles: roles
        .map((row) => ({ ...row, fullAccess: row.capabilities.includes("*"), sectionCount: grantedSections(row.capabilities) }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
      users: visibleUsers.sort((a, b) => a.name.localeCompare(b.name, "ru")),
      restaurants: restaurants.map((row) => ({ externalId: row.externalId, name: row.name })).sort((a, b) => a.name.localeCompare(b.name, "ru")),
      catalog: CAPABILITY_CATALOG,
      editor: { email: user.email, externalId: user.externalId, fullAccess: role.capabilities.includes("*"), capabilities: role.capabilities, warehouseScopes: scopes.warehouseScopes },
    }
  },
})

export const saveRole = mutation({
  args: { externalId: v.string(), name: v.string(), fullAccess: v.boolean(), capabilities: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { role: editorRole } = await requireOfficeCapability(ctx, "office.roles.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const externalId = normalizeCode(args.externalId)
    const name = args.name.trim()
    if (!externalId || !name) throw new ConvexError("Заполните код и название роли")
    const capabilities = args.fullAccess ? ["*"] : [...new Set(args.capabilities.map((value) => value.trim()).filter(Boolean))]
    if (!capabilities.length) throw new ConvexError("Выберите хотя бы одно разрешение")
    const invalid = capabilities.find((capability) => !isValidCapability(capability))
    if (invalid) throw new ConvexError(`Неизвестное право: ${invalid}`)
    if (externalId === "administrator" && !capabilities.includes("*")) throw new ConvexError("Администратору нужен полный доступ")
    const tooMuch = exceeds(editorRole, capabilities)
    if (tooMuch) throw new ConvexError(`Нельзя выдать право, которого нет у вас: ${tooMuch}`)

    const existing = await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    if (existing) await ctx.db.patch(existing._id, { name, capabilities })
    else await ctx.db.insert("officeRoles", { externalId, name, capabilities, system: false })
    await writeOfficeAudit(ctx, email, {
      action: existing ? "office-role.update" : "office-role.create",
      summary: `Роль «${name}»: ${capabilities.includes("*") ? "полный доступ" : `${grantedSections(capabilities)} разделов`}`,
      resourceType: "office-role",
      resourceExternalId: externalId,
      capability: "office.roles.edit",
      details: { capabilities },
    })
    return externalId
  },
})

export const saveUser = mutation({
  args: {
    externalId: v.string(),
    email: v.string(),
    name: v.string(),
    roleExternalId: v.string(),
    restaurantScopes: v.array(v.string()),
    warehouseScopes: v.array(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user: editor, role: editorRole } = await requireOfficeCapability(ctx, "office.users.edit")
    const editorScopes = await effectiveScopes(ctx, editor, editorRole)
    const actorEmail = (await getOfficeAuthEmail(ctx))!
    const externalId = normalizeCode(args.externalId)
    const email = args.email.trim().toLocaleLowerCase("en-US")
    const name = args.name.trim()
    if (!externalId || !name || !/^\S+@\S+\.\S+$/.test(email)) throw new ConvexError("Заполните код, имя и корректный email")

    const role = await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", args.roleExternalId)).unique()
    if (!role) throw new ConvexError("Роль не найдена")
    const tooMuch = exceeds(editorRole, role.capabilities)
    if (tooMuch) throw new ConvexError(`Нельзя назначить роль с правом, которого нет у вас: ${tooMuch}`)

    const duplicate = await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", email)).unique()
    if (duplicate && duplicate.externalId !== externalId) throw new ConvexError("Пользователь с таким email уже существует")
    const existing = await ctx.db.query("officeUsers").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    if (existing && existing._id === editor._id && !args.active) throw new ConvexError("Нельзя отключить собственную учётную запись")

    const restaurantScopes = [...new Set(args.restaurantScopes)]
    if (!restaurantScopes.length) throw new ConvexError("Выберите хотя бы один ресторан")
    const organizations = new Set<string>()
    for (const scope of restaurantScopes) {
      if (!hasScope(editor.restaurantScopes, scope)) throw new ConvexError("Ресторан вне вашей области доступа")
      if (scope === "*") continue
      const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", scope)).unique()
      if (!restaurant) throw new ConvexError("Ресторан не найден")
      if (!hasScope(editorScopes.organizationScopes, restaurant.organizationExternalId)) throw new ConvexError("Ресторан вне вашей области доступа")
      organizations.add(restaurant.organizationExternalId)
    }
    const warehouseScopes = [...new Set(args.warehouseScopes)]
    const outside = warehouseScopes.find((scope) => !hasScope(editorScopes.warehouseScopes, scope))
    if (outside) throw new ConvexError(`Склад вне вашей области доступа: ${outside}`)
    const organizationScopes = restaurantScopes.includes("*") ? editorScopes.organizationScopes : [...organizations]

    const value = { externalId, email, name, roleExternalId: role.externalId, restaurantScopes, organizationScopes, warehouseScopes, active: args.active }
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert("officeUsers", value)
    await writeOfficeAudit(ctx, actorEmail, {
      action: existing ? "office-user.update" : "office-user.create",
      summary: `Пользователь ${email}: роль «${role.name}», ресторанов ${restaurantScopes.includes("*") ? "все" : restaurantScopes.length}${args.active ? "" : ", отключён"}`,
      resourceType: "office-user",
      resourceExternalId: externalId,
      capability: "office.users.edit",
      details: { roleExternalId: role.externalId, restaurantScopes, warehouseScopes, active: args.active },
    })
    return externalId
  },
})

export const setUserActive = mutation({
  args: { externalId: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    const { user: editor, role } = await requireOfficeCapability(ctx, "office.users.edit")
    const editorScopes = await effectiveScopes(ctx, editor, role)
    const actorEmail = (await getOfficeAuthEmail(ctx))!
    const target = await ctx.db.query("officeUsers").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!target) throw new ConvexError("Пользователь не найден")
    if (target._id === editor._id && !args.active) throw new ConvexError("Нельзя отключить собственную учётную запись")
    const targetScopes = await effectiveScopes(ctx, target)
    const reachable = editorScopes.organizationScopes.includes("*") || targetScopes.organizationScopes.every((organization) => organization !== "*" && hasScope(editorScopes.organizationScopes, organization))
    if (!reachable) throw new ConvexError("Пользователь вне вашей области доступа")
    await ctx.db.patch(target._id, { active: args.active })
    await writeOfficeAudit(ctx, actorEmail, {
      action: "office-user.update",
      summary: `Пользователь ${target.email} ${args.active ? "включён" : "отключён"}`,
      resourceType: "office-user",
      resourceExternalId: target.externalId,
      capability: "office.users.edit",
      details: { active: args.active },
    })
  },
})
