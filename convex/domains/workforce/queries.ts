import type { QueryCtx } from "../../_generated/server"
import { query } from "../../_generated/server"
import { hasNetworkScope, hasScope, requireOfficeCapability, restaurantScopeFilter } from "../../lib/officeAccess"
import { listOperationalRestaurants } from "../../lib/restaurants"

// Phase 3's iiko import writes its own restaurants row per department (see
// lib/restaurants.ts) — a city that already has a Phase-1-seeded, terminal-bound restaurant ends
// up with TWO rows sharing a city but not an externalId ("Sandyq Шымкент" seeded vs. "Sandyq
// Шымкент" iiko-imported). A cashier can only ever be assigned to the seeded one — it's the only
// one with a posTerminals row — so branch resolution below prefers it whenever the city matches.
const CITY_ALIASES: [string, string[]][] = [
  ["almaty", ["алматы"]],
  ["shymkent", ["шымкент"]],
  ["turkistan", ["түркістан", "туркестан", "turkestan"]],
]

function cityKeyOf(name: string): string | null {
  const normalized = name.toLocaleLowerCase("ru")
  return CITY_ALIASES.find(([, aliases]) => aliases.some((alias) => normalized.includes(alias)))?.[0] ?? null
}

/**
 * iikoEmployees only carries department *codes* (e.g. "TUR", "SHM") — resolves each to the
 * matching restaurant via iikoDepartments (DEPARTMENT rows share their externalId with the
 * restaurant they became on import; `code` is the short code iiko actually put on the employee),
 * then swaps in the operational (terminal-bound) restaurant when the city matches one.
 */
async function resolveBranchesByDepartmentCode(ctx: QueryCtx) {
  const [departments, restaurants, operational] = await Promise.all([
    ctx.db.query("iikoDepartments").collect(),
    ctx.db.query("restaurants").collect(),
    listOperationalRestaurants(ctx),
  ])
  const restaurantByExternalId = new Map(restaurants.map((restaurant) => [restaurant.externalId, restaurant]))
  const operationalByCityKey = new Map<string, { externalId: string; name: string }>()
  for (const restaurant of operational) {
    const key = cityKeyOf(restaurant.name)
    if (key) operationalByCityKey.set(key, { externalId: restaurant.externalId, name: restaurant.name })
  }

  const byCode = new Map<string, { externalId: string; name: string }[]>()
  for (const department of departments) {
    if (!department.code) continue
    const restaurant = restaurantByExternalId.get(department.externalId)
    if (!restaurant) continue
    const cityKey = cityKeyOf(restaurant.name)
    const resolved = (cityKey && operationalByCityKey.get(cityKey)) || { externalId: restaurant.externalId, name: restaurant.name }
    const list = byCode.get(department.code) ?? []
    list.push(resolved)
    byCode.set(department.code, list)
  }
  return byCode
}

export const listBranches = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.employees.view")
    const inScope = restaurantScopeFilter(user)
    return (await listOperationalRestaurants(ctx)).filter((restaurant) => inScope(restaurant.externalId))
  },
})

export const listPosEmployees = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.employees.view")
    const employees = await ctx.db.query("employees").withIndex("by_role_name").collect()
    const restaurants = await ctx.db.query("restaurants").collect()
    const restaurantById = new Map(restaurants.map((restaurant) => [restaurant._id, restaurant]))
    const visible = employees.filter(
      (employee) => hasNetworkScope(user) || employee.restaurantIds.some((id) => { const r = restaurantById.get(id); return r !== undefined && hasScope(user.restaurantScopes, r.externalId) }),
    )
    return visible.map((employee) => {
      const { pinSalt: _pinSalt, pinHash: _pinHash, ...rest } = employee
      return {
        ...rest,
        restaurants: employee.restaurantIds.map((id) => restaurantById.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r)).map((r) => ({ externalId: r.externalId, name: r.name })),
      }
    })
  },
})

/** Candidates for provisionPosAccess — active iiko employees not yet linked to a POS login. */
export const listUnprovisioned = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.employees.view")
    const [iikoEmployees, posEmployees, branchesByCode] = await Promise.all([
      ctx.db.query("iikoEmployees").withIndex("by_active_and_display_name", (q) => q.eq("active", true)).take(1000),
      ctx.db.query("employees").collect(),
      resolveBranchesByDepartmentCode(ctx),
    ])
    const linked = new Set(posEmployees.map((employee) => employee.iikoEmployeeExternalId).filter(Boolean))
    return iikoEmployees
      .filter((employee) => !linked.has(employee.externalId))
      .map((employee) => {
        const branches = new Map<string, { externalId: string; name: string }>()
        for (const code of employee.departmentCodes) {
          for (const branch of branchesByCode.get(code) ?? []) branches.set(branch.externalId, branch)
        }
        return { ...employee, branches: [...branches.values()] }
      })
      // Without network scope only candidates from the user's branches are shown.
      .filter((employee) => hasNetworkScope(user) || employee.branches.some((branch) => hasScope(user.restaurantScopes, branch.externalId)))
  },
})

/** A fresh, unused 6-digit code and a random 4-digit PIN — office can edit or re-request either before submitting. */
export const suggestCredentials = query({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.employees.view")
    let code = randomDigits(6)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const existing = await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", code)).unique()
      if (!existing) break
      code = randomDigits(6)
    }
    return { code, pin: randomDigits(4) }
  },
})

function randomDigits(length: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) => byte % 10).join("")
}
