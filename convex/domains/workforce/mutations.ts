import { v, ConvexError } from "convex/values"

import { mutation } from "../../_generated/server"
import type { MutationCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { derivePinHash, randomPinSalt } from "../../lib/auth"
import { getOfficeAuthEmail, requireEmployeeInScope, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { employeeRole } from "../../lib/validators"
import { isValidPin, PIN_MAX, PIN_MIN } from "../../lib/policy"

// One PIN rule for provisioning and resets; the POS PIN pad accepts at most 6 digits.

async function resolveRestaurantIds(ctx: MutationCtx, user: { restaurantScopes: string[] }, restaurantExternalIds: string[]) {
  if (!restaurantExternalIds.length) throw new ConvexError("Выберите хотя бы один ресторан")
  const restaurantIds = []
  for (const externalId of new Set(restaurantExternalIds)) {
    await requireRestaurantScope(ctx, user, externalId)
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    if (!restaurant?.active) throw new ConvexError(`Активный ресторан не найден: ${externalId}`)
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
    const { user } = await requireOfficeCapability(ctx, "office.employees.edit")
    if (!/^\d{3,12}$/.test(args.employeeCode)) throw new ConvexError("Код сотрудника должен состоять из 3–12 цифр")
    if (!isValidPin(args.pin)) throw new ConvexError(`PIN должен состоять из ${PIN_MIN}–${PIN_MAX} цифр`)
    const email = await getOfficeAuthEmail(ctx)

    const source = await ctx.db.query("iikoEmployees").withIndex("by_external_id", (q) => q.eq("externalId", args.iikoEmployeeExternalId)).unique()
    if (!source?.active) throw new ConvexError("Активный сотрудник iiko не найден")

    const restaurantIds = await resolveRestaurantIds(ctx, user, args.restaurantExternalIds)

    const byCode = await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", args.employeeCode)).unique()
    const bySource = await ctx.db.query("employees").withIndex("by_iiko_employee_external_id", (q) => q.eq("iikoEmployeeExternalId", args.iikoEmployeeExternalId)).unique()
    if (byCode && byCode._id !== bySource?._id) throw new ConvexError("Этот код сотрудника уже используется")
    if (bySource) await requireEmployeeInScope(ctx, user, bySource)

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
    const { user } = await requireOfficeCapability(ctx, "office.employees.edit")
    const email = await getOfficeAuthEmail(ctx)
    const employee = await ctx.db.get(args.employeeId)
    if (!employee) throw new ConvexError("Сотрудник не найден")
    await requireEmployeeInScope(ctx, user, employee)
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
    const { user } = await requireOfficeCapability(ctx, "office.employees.edit")
    const email = await getOfficeAuthEmail(ctx)
    const employee = await ctx.db.get(args.employeeId)
    if (!employee) throw new ConvexError("Сотрудник не найден")
    await requireEmployeeInScope(ctx, user, employee)
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
    const { user } = await requireOfficeCapability(ctx, "office.employees.edit")
    if (!isValidPin(args.pin)) throw new ConvexError(`PIN должен состоять из ${PIN_MIN}–${PIN_MAX} цифр`)
    const email = await getOfficeAuthEmail(ctx)
    const employee = await ctx.db.get(args.employeeId)
    if (!employee) throw new ConvexError("Сотрудник не найден")
    await requireEmployeeInScope(ctx, user, employee)
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

// ── HR card (W1-HR-01) ───────────────────────────────────────────────────────

const hrFields = {
  personnelNumber: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  iin: v.optional(v.string()),
  positionExternalId: v.optional(v.string()),
  employmentDate: v.optional(v.string()),
  payType: v.optional(v.union(v.literal("hourly"), v.literal("salary"), v.literal("piecework"))),
  baseRate: v.optional(v.number()),
  applyBasicDeduction: v.optional(v.boolean()),
  admitted: v.optional(v.boolean()),
}

type HrInput = { personnelNumber?: string; phone?: string; email?: string; iin?: string; positionExternalId?: string; employmentDate?: string; payType?: "hourly" | "salary" | "piecework"; baseRate?: number; applyBasicDeduction?: boolean; admitted?: boolean }

/**
 * Normalised HR fields for a patch: a field left out (undefined) is kept, an empty string clears it, and a
 * masked value («•…», what a user without office.employees.pii sees) is kept as stored.
 */
function checkHr(input: HrInput) {
  const patch: Record<string, string | number | boolean | undefined> = {}
  const text = (key: "personnelNumber" | "phone" | "email" | "iin" | "positionExternalId" | "employmentDate") => {
    const value = input[key]
    if (value === undefined || value.includes("•")) return undefined
    patch[key] = value.trim() || undefined
    return value.trim() || undefined
  }
  const iin = text("iin")
  if (iin && !/^\d{12}$/.test(iin)) throw new ConvexError("ИИН — 12 цифр")
  const email = text("email")
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ConvexError("Некорректный email")
  const phone = text("phone")
  if (phone && !/^\+?[\d\s()-]{10,18}$/.test(phone)) throw new ConvexError("Некорректный телефон")
  const employmentDate = text("employmentDate")
  if (employmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(employmentDate)) throw new ConvexError("Некорректная дата приёма")
  text("personnelNumber")
  text("positionExternalId")
  if (input.baseRate !== undefined && !(Number.isInteger(input.baseRate) && input.baseRate >= 0)) throw new ConvexError("Ставка — целое число тенге")
  for (const key of ["payType", "baseRate", "applyBasicDeduction", "admitted"] as const) if (input[key] !== undefined) patch[key] = input[key]
  return patch as Partial<Pick<Doc<"employees">, "personnelNumber" | "phone" | "email" | "iin" | "positionExternalId" | "employmentDate" | "payType" | "baseRate" | "applyBasicDeduction" | "admitted">>
}

/** Names of the HR fields that changed — the audit never carries personal data values. */
function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys(after).filter((key) => before[key] !== after[key])
}

export const createPosEmployee = mutation({
  args: { displayName: v.string(), employeeCode: v.string(), pin: v.string(), role: employeeRole, restaurantExternalIds: v.array(v.string()), ...hrFields },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.employees.edit")
    const email = await getOfficeAuthEmail(ctx)
    const displayName = args.displayName.trim()
    if (displayName.length < 2) throw new ConvexError("Укажите ФИО")
    if (!/^\d{3,12}$/.test(args.employeeCode)) throw new ConvexError("Код сотрудника должен состоять из 3–12 цифр")
    if (!isValidPin(args.pin)) throw new ConvexError(`PIN должен состоять из ${PIN_MIN}–${PIN_MAX} цифр`)
    if (await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", args.employeeCode)).unique()) throw new ConvexError("Этот код сотрудника уже используется")
    const restaurantIds = await resolveRestaurantIds(ctx, user, args.restaurantExternalIds)
    const pinSalt = randomPinSalt()
    const pinHash = await derivePinHash(args.pin, pinSalt)
    const hr = checkHr(args)
    const employeeId = await ctx.db.insert("employees", { code: args.employeeCode, displayName, role: args.role, restaurantIds, pinSalt, pinHash, active: true, failedAttempts: 0, ...hr, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email!, { action: "workforce.create", summary: `Создан сотрудник кассы «${displayName}» (код ${args.employeeCode}, роль ${args.role})`, resourceType: "employee", resourceExternalId: args.employeeCode })
    return { employeeId, code: args.employeeCode }
  },
})

export const updateEmployeeProfile = mutation({
  args: { employeeId: v.id("employees"), displayName: v.string(), expectedUpdatedAt: v.optional(v.number()), ...hrFields },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.employees.edit")
    const email = await getOfficeAuthEmail(ctx)
    const employee = await ctx.db.get(args.employeeId)
    if (!employee) throw new ConvexError("Сотрудник не найден")
    await requireEmployeeInScope(ctx, user, employee)
    if (args.expectedUpdatedAt !== undefined && (employee.updatedAt ?? 0) !== args.expectedUpdatedAt) throw new ConvexError("Карточку изменил другой пользователь — обновите страницу")
    const displayName = args.displayName.trim()
    if (displayName.length < 2) throw new ConvexError("Укажите ФИО")
    const hr = checkHr(args)
    const changed = changedFields(employee as unknown as Record<string, unknown>, { displayName, ...hr })
    await ctx.db.patch(employee._id, { displayName, ...hr, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email!, { action: "workforce.profile.update", summary: `Изменена карточка «${displayName}» (код ${employee.code}): ${changed.join(", ") || "без изменений"}`, resourceType: "employee", resourceExternalId: employee.code })
  },
})
