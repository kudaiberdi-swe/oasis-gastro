import { v } from "convex/values"

import { mutation } from "../../_generated/server"
import type { MutationCtx } from "../../_generated/server"
import { derivePinHash, randomPinSalt } from "../../lib/auth"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { employeeRole } from "../../lib/validators"

async function resolveRestaurantIds(ctx: MutationCtx, user: { restaurantScopes: string[] }, restaurantExternalIds: string[]) {
  if (!restaurantExternalIds.length) throw new Error("Выберите хотя бы один ресторан")
  const restaurantIds = []
  for (const externalId of new Set(restaurantExternalIds)) {
    await requireRestaurantScope(ctx, user, externalId)
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    if (!restaurant?.active) throw new Error(`Активный ресторан не найден: ${externalId}`)
    restaurantIds.push(restaurant._id)
  }
  return restaurantIds
}

/**
 * Turns an imported iiko employee into a working cashier login. The code + PIN are always
 * chosen and hashed here, locally — iiko never supplies, sees, or influences a credential.
 */
export const provisionPosAccess = mutation({
  args: {
    iikoEmployeeExternalId: v.string(),
    employeeCode: v.string(),
    pin: v.string(),
    role: employeeRole,
    restaurantExternalIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.workforce.*")
    if (!/^\d{4,12}$/.test(args.employeeCode)) throw new Error("Код сотрудника должен состоять из 4–12 цифр")
    if (!/^\d{4,12}$/.test(args.pin)) throw new Error("PIN должен состоять из 4–12 цифр")
    const email = await getOfficeAuthEmail(ctx)

    const source = await ctx.db.query("iikoEmployees").withIndex("by_external_id", (q) => q.eq("externalId", args.iikoEmployeeExternalId)).unique()
    if (!source?.active) throw new Error("Активный сотрудник iiko не найден")

    const restaurantIds = await resolveRestaurantIds(ctx, user, args.restaurantExternalIds)

    const byCode = await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", args.employeeCode)).unique()
    const bySource = await ctx.db.query("employees").withIndex("by_iiko_employee_external_id", (q) => q.eq("iikoEmployeeExternalId", args.iikoEmployeeExternalId)).unique()
    if (byCode && byCode._id !== bySource?._id) throw new Error("Этот код сотрудника уже используется")

    const pinSalt = randomPinSalt()
    const pinHash = await derivePinHash(args.pin, pinSalt)
    const value = {
      code: args.employeeCode,
      displayName: source.displayName,
      role: args.role,
      restaurantIds,
      pinSalt,
      pinHash,
      active: true,
      failedAttempts: 0,
      iikoEmployeeExternalId: args.iikoEmployeeExternalId,
    }
    if (bySource) await ctx.db.patch(bySource._id, value)
    else await ctx.db.insert("employees", value)

    await writeOfficeAudit(ctx, email!, {
      action: "workforce.provision",
      summary: `Выдан доступ в кассу: «${source.displayName}» (код ${args.employeeCode}, роль ${args.role})`,
      resourceType: "employee",
      resourceExternalId: args.employeeCode,
    })
    return { code: args.employeeCode }
  },
})

export const setEmployeeActive = mutation({
  args: { employeeId: v.id("employees"), active: v.boolean() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.workforce.*")
    const email = await getOfficeAuthEmail(ctx)
    const employee = await ctx.db.get(args.employeeId)
    if (!employee) throw new Error("Сотрудник не найден")
    await ctx.db.patch(args.employeeId, { active: args.active, ...(args.active ? { failedAttempts: 0, lockedUntil: undefined } : {}) })
    await writeOfficeAudit(ctx, email!, {
      action: args.active ? "workforce.activate" : "workforce.deactivate",
      summary: `${args.active ? "Включён" : "Отключён"} доступ в кассу: «${employee.displayName}» (код ${employee.code})`,
      resourceType: "employee",
      resourceExternalId: employee.code,
    })
  },
})

export const updateEmployeeAssignment = mutation({
  args: { employeeId: v.id("employees"), role: employeeRole, restaurantExternalIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.workforce.*")
    const email = await getOfficeAuthEmail(ctx)
    const employee = await ctx.db.get(args.employeeId)
    if (!employee) throw new Error("Сотрудник не найден")
    const restaurantIds = await resolveRestaurantIds(ctx, user, args.restaurantExternalIds)
    await ctx.db.patch(args.employeeId, { role: args.role, restaurantIds })
    await writeOfficeAudit(ctx, email!, {
      action: "workforce.assignment.update",
      summary: `Изменено назначение: «${employee.displayName}» — роль ${args.role}, филиалов: ${restaurantIds.length}`,
      resourceType: "employee",
      resourceExternalId: employee.code,
    })
  },
})

export const resetPin = mutation({
  args: { employeeId: v.id("employees"), pin: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.workforce.*")
    if (!/^\d{4,12}$/.test(args.pin)) throw new Error("PIN должен состоять из 4–12 цифр")
    const email = await getOfficeAuthEmail(ctx)
    const employee = await ctx.db.get(args.employeeId)
    if (!employee) throw new Error("Сотрудник не найден")
    const pinSalt = randomPinSalt()
    const pinHash = await derivePinHash(args.pin, pinSalt)
    await ctx.db.patch(args.employeeId, { pinSalt, pinHash, failedAttempts: 0, lockedUntil: undefined })
    await writeOfficeAudit(ctx, email!, {
      action: "workforce.pin.reset",
      summary: `Сброшен PIN: «${employee.displayName}» (код ${employee.code})`,
      resourceType: "employee",
      resourceExternalId: employee.code,
    })
  },
})
