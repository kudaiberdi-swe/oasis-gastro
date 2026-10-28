import { v, ConvexError } from "convex/values"
import type { WithoutSystemFields } from "convex/server"

import { internal } from "../../_generated/api"
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "../../_generated/server"
import type { Doc, Id, TableNames } from "../../_generated/dataModel"
import schema from "../../schema"
import { isValidKzBin } from "../../lib/bin"
import { settleOrder } from "../../lib/checkoutCore"
import { envValue } from "../../lib/env"
import { createKitchenTicket } from "../../lib/kitchen"
import { postJournalEntry } from "../../lib/ledger"
import { calculateOrderTotal, calculateServiceCharge } from "../../lib/money"
import { nextNumber } from "../../lib/numbering"
import { createObligation } from "../../lib/obligations"
import { resolveOrderType } from "../../lib/orderPricing"
import { resolvePrice } from "../../lib/pricing"
import { applyStockMovement } from "../../lib/stockAccounting"
import { stockAccountOf } from "../../lib/stockPosting"
import { almatyDayStart, businessDateFor, DAY_MS } from "../../lib/time"
import { nextDeliveryNumber } from "../delivery/shared"
import { buildXReportSnapshot } from "../shifts/queries"
import {
  branchAddress,
  branchName,
  dishExternalId,
  FIRST_NAMES,
  GUEST_COUNT,
  INITIALS,
  SHAFRAN_BRANCHES,
  SHAFRAN_CATEGORIES,
  SHAFRAN_DELIVERY_SOURCES,
  SHAFRAN_DEMO_RESTAURANT,
  SHAFRAN_DISHES,
  SHAFRAN_INGREDIENTS,
  SHAFRAN_ORGANIZATION,
  SHAFRAN_SUPPLIERS,
  type SupplierKey,
} from "./shafranData"

// Demo chain «Шафран» on the DEV deployment (scripts/seed-shafran.mjs): wipe the client's data, seed the
// synthetic chain, then ~30 days of sales through the real settlement core (checkoutCore.settleOrder), so
// facts, stock, journal, kitchen tickets and loyalty are exactly what the POS would have written.
// Every function refuses to run anywhere but dapper-lobster-404 — also when called with `--prod`.

const DEV_DEPLOYMENT = "dapper-lobster-404"
const ORG = SHAFRAN_ORGANIZATION.externalId
const SEED_ACTOR = "seed:shafran"

/** The deployment's own URL (built-in CONVEX_CLOUD_URL) must be the dev one; prod and anything else are refused. */
export function assertDevDeployment() {
  const url = envValue("CONVEX_CLOUD_URL") ?? ""
  let host = ""
  try {
    host = new URL(url).hostname
  } catch {
    host = ""
  }
  if (host.split(".")[0] !== DEV_DEPLOYMENT) throw new ConvexError(`Демо-данные «Шафран» — только для dev-развёртывания ${DEV_DEPLOYMENT}`)
}

// ── Wipe ────────────────────────────────────────────────────────────────────────────────────────
// Kept: sign-in (Convex Auth tables, office users and roles — their scopes are re-pointed below) and the
// client-neutral reference setup (chart of accounts, retail settings, KZ payroll rules, shift types).
const KEEP = new Set<string>(["users", "authAccounts", "authSessions", "authRefreshTokens", "authVerificationCodes", "authVerifiers", "authRateLimits", "officeRoles", "officeUsers", "accounts", "retailSettings", "payrollRules", "shiftTypes", "workforceSettings", "apiNonces"])
export const WIPE_TABLES = (Object.keys(schema.tables) as TableNames[]).filter((table) => !KEEP.has(table)).sort()
const WIPE_PAGE = 250
const STORAGE_PAGE = 50

export const wipePage = internalMutation({
  args: { table: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertDevDeployment()
    if (!WIPE_TABLES.includes(args.table as TableNames)) throw new ConvexError(`Таблица ${args.table} не очищается`)
    const page = await ctx.db.query(args.table as TableNames).paginate({ numItems: WIPE_PAGE, cursor: null })
    for (const row of page.page) await ctx.db.delete(row._id)
    return page.page.length
  },
})

/** Stored files (dish photos, rendered report files) are all client data on dev. */
export const wipeStoragePage = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    assertDevDeployment()
    const files = await ctx.db.system.query("_storage").take(STORAGE_PAGE)
    for (const file of files) await ctx.storage.delete(file._id)
    return files.length
  },
})

export const wipeAll = internalAction({
  args: {},
  returns: v.record(v.string(), v.number()),
  handler: async (ctx) => {
    assertDevDeployment()
    const deleted: Record<string, number> = {}
    for (const table of WIPE_TABLES) {
      let total = 0
      for (;;) {
        const count: number = await ctx.runMutation(internal.domains.seed.shafran.wipePage, { table })
        total += count
        if (count < WIPE_PAGE) break
      }
      if (total) deleted[table] = total
    }
    let files = 0
    for (;;) {
      const count: number = await ctx.runMutation(internal.domains.seed.shafran.wipeStoragePage, {})
      files += count
      if (count < STORAGE_PAGE) break
    }
    if (files) deleted.storageFiles = files
    return deleted
  },
})

// ── Deterministic randomness ────────────────────────────────────────────────────────────────────
function rngFor(seed: string) {
  let state = 2166136261
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619)
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T>(random: () => number, items: readonly T[], weight: (item: T) => number = () => 1) => {
  const total = items.reduce((sum, item) => sum + weight(item), 0)
  let roll = random() * total
  for (const item of items) {
    roll -= weight(item)
    if (roll <= 0) return item
  }
  return items[items.length - 1]
}

// ── People and chain structure ──────────────────────────────────────────────────────────────────
const personName = (index: number) => `${FIRST_NAMES[(index * 7) % FIRST_NAMES.length]} ${INITIALS[(index * 5) % INITIALS.length]}`
const pad = (value: number, size = 2) => String(value).padStart(size, "0")
const branchNumber = (restaurantExternalId: string) => SHAFRAN_BRANCHES.findIndex((branch) => branch.externalId === restaurantExternalId) + 1
const cashierCode = (restaurantExternalId: string) => `21${pad(branchNumber(restaurantExternalId))}`
const guestExternalId = (index: number) => `shafran-guest-${pad(index + 1, 3)}`
const guestPhone = (index: number) => `7000000${pad(index + 1, 4)}` // +7 000 … — no such operator code

type SeedEmployee = { code: string; displayName: string; role: "cashier" | "manager" | "administrator" | "kitchen"; restaurantExternalIds: string[]; position: string }
export function shafranEmployees(): SeedEmployee[] {
  const ids = SHAFRAN_BRANCHES.map((branch) => branch.externalId)
  const people: SeedEmployee[] = []
  ids.forEach((id, index) => {
    people.push({ code: `21${pad(index + 1)}`, displayName: personName(index), role: "cashier", restaurantExternalIds: [id], position: "shafran-pos-cashier" })
    people.push({ code: `22${pad(index + 1)}`, displayName: personName(index + 16), role: "kitchen", restaurantExternalIds: [id], position: "shafran-pos-cook" })
  })
  for (let area = 0; area < 4; area += 1) people.push({ code: `230${area + 1}`, displayName: personName(area + 32), role: "manager", restaurantExternalIds: ids.slice(area * 4, area * 4 + 4), position: "shafran-pos-manager" })
  people.push({ code: "2401", displayName: personName(36), role: "administrator", restaurantExternalIds: ids, position: "shafran-pos-admin" })
  return people
}

const POSITIONS = [
  { externalId: "shafran-pos-cashier", code: "КАС", name: "Кассир", payType: "hourly" as const, defaultRate: 1500, posRole: "cashier" as const },
  { externalId: "shafran-pos-cook", code: "ПОВ", name: "Повар", payType: "hourly" as const, defaultRate: 1800, posRole: "kitchen" as const },
  { externalId: "shafran-pos-manager", code: "УПР", name: "Управляющий", payType: "salary" as const, defaultRate: 450_000, posRole: "manager" as const },
  { externalId: "shafran-pos-admin", code: "АДМ", name: "Администратор сети", payType: "salary" as const, defaultRate: 600_000, posRole: "administrator" as const },
]

/** Branch price: the base price, +5 % at the busiest branches, −5 % outside Almaty and at the newest one, to 10 ₸. */
export function branchPrice(basePrice: number, branch: { load: number }) {
  const factor = branch.load >= 1.2 ? 1.05 : branch.load <= 0.8 ? 0.95 : 1
  return Math.round((basePrice * factor) / 10) * 10
}

/** The seedAll payload (domains/seed/mutations.ts) for the chain: org, branches, tills, menu, prices, staff. */
export function shafranCatalogPayload(randomHex: () => string) {
  const restaurants = SHAFRAN_BRANCHES.map((branch) => ({ externalId: branch.externalId, organizationExternalId: ORG, name: branchName(branch), address: branchAddress(branch), city: branch.city, timezone: SHAFRAN_ORGANIZATION.timezone }))
  return {
    organization: { externalId: ORG, name: SHAFRAN_ORGANIZATION.name, currency: SHAFRAN_ORGANIZATION.currency, timezone: SHAFRAN_ORGANIZATION.timezone },
    restaurants,
    terminals: SHAFRAN_BRANCHES.map((branch) => ({ externalId: `${branch.externalId}-01`, restaurantExternalId: branch.externalId, name: `Касса 1 · ${branch.address}`, terminalNumber: 1 })),
    categories: SHAFRAN_CATEGORIES.map((category, index) => ({ ...category, sortOrder: index })),
    products: SHAFRAN_DISHES.map((dish) => ({
      externalId: dishExternalId(dish.id),
      name: dish.name,
      nameKk: dish.nameKk,
      description: "",
      category: dish.category,
      categorySort: SHAFRAN_CATEGORIES.findIndex((category) => category.externalId === dish.category),
      basePrice: dish.price,
      sku: dishExternalId(dish.id),
      popular: dish.popular ?? false,
    })),
    prices: SHAFRAN_DISHES.flatMap((dish) => SHAFRAN_BRANCHES.map((branch) => ({ productExternalId: dishExternalId(dish.id), restaurantExternalId: branch.externalId, priceKzt: branchPrice(dish.price, branch) }))),
    // Nobody knows these PINs: the hash is random. Demo sign-ins come from scripts/seed-demo-logins.mjs.
    employees: shafranEmployees().map(({ position: _position, ...employee }) => ({ ...employee, pinSalt: randomHex(), pinHash: randomHex() })),
  }
}

/** A BIN that passes the control digit but can't be a real one: its registration month is 00. */
function demoBin(serial: number) {
  for (let offset = 0; offset < 50; offset += 1) {
    const stem = `000040${pad(serial * 50 + offset, 5)}`
    for (let digit = 0; digit <= 9; digit += 1) if (isValidKzBin(`${stem}${digit}`)) return `${stem}${digit}`
  }
  throw new ConvexError("Не удалось подобрать демо-БИН")
}

type KeyedTable = "units" | "positions" | "suppliers" | "inventoryItems" | "warehouses" | "deliverySources" | "loyaltyPrograms" | "guests" | "diningTables"

/** Inserts a row once per externalId (every listed table has a by_external_id index); a re-run keeps the row. */
async function upsert<T extends KeyedTable>(ctx: MutationCtx, table: T, value: WithoutSystemFields<Doc<T>>) {
  const externalId = (value as unknown as { externalId: string }).externalId
  const existing = (await (ctx.db.query(table) as any).withIndex("by_external_id", (q: any) => q.eq("externalId", externalId)).unique()) as Doc<T> | null
  if (existing) return existing._id as Id<T>
  return (await ctx.db.insert(table, value as any)) as Id<T>
}

/** Everything around the catalog: legal entity, units, positions, suppliers, stock items, warehouses, recipes,
 * delivery channels, loyalty, guests, tables, HR cards. Idempotent: rows are created once by externalId. */
export const seedReference = internalMutation({
  args: {},
  returns: v.object({ inventoryItems: v.number(), recipes: v.number(), guests: v.number(), warehouses: v.number() }),
  handler: async (ctx) => {
    assertDevDeployment()
    const now = Date.now()
    const organization = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", ORG)).unique()
    if (!organization) throw new ConvexError("Сначала seedAll: организации «Шафран» нет")
    await ctx.db.patch(organization._id, { legalName: SHAFRAN_ORGANIZATION.legalName, jurisdiction: "KZ" })

    for (const unit of [
      { externalId: "unit-kg", name: "Килограмм", shortName: "кг", dimension: "mass" as const },
      { externalId: "unit-l", name: "Литр", shortName: "л", dimension: "volume" as const },
      { externalId: "unit-pcs", name: "Штука", shortName: "шт", dimension: "count" as const },
      { externalId: "unit-portion", name: "Порция", shortName: "порц.", dimension: "portion" as const },
    ]) {
      await upsert(ctx, "units", { ...unit, precision: 3, coefficient: 1, active: true, searchText: `${unit.name} ${unit.shortName}`.toLocaleLowerCase("ru") })
    }
    const unitId = { кг: "unit-kg", л: "unit-l", шт: "unit-pcs" } as const

    for (const position of POSITIONS) await upsert(ctx, "positions", { ...position, weeklyHours: 40, active: true, version: 1, createdAt: now, updatedAt: now })

    const restaurantIds = SHAFRAN_BRANCHES.map((branch) => branch.externalId)
    for (const [index, supplier] of SHAFRAN_SUPPLIERS.entries()) {
      await upsert(ctx, "suppliers", {
        externalId: `shafran-supplier-${supplier.key}`,
        name: supplier.name,
        bin: demoBin(index + 1),
        supplierType: "external",
        vatPayer: false,
        paymentDelayDays: supplier.paymentDelayDays,
        priceDeviationPolicy: "ignore",
        allowedDeviationPercent: 0,
        restaurantExternalIds: restaurantIds,
        active: true,
        searchText: supplier.name.toLocaleLowerCase("ru"),
      })
    }

    let inventoryItems = 0
    const itemIds = new Map<string, Id<"inventoryItems">>()
    for (const [key, ingredient] of Object.entries(SHAFRAN_INGREDIENTS)) {
      const id = await upsert(ctx, "inventoryItems", { externalId: `shafran-ing-${key}`, name: ingredient.name, nameSort: ingredient.name.toLocaleLowerCase("ru"), searchText: ingredient.name.toLocaleLowerCase("ru"), unit: ingredient.unit, unitExternalId: unitId[ingredient.unit], kind: "ingredient", active: true })
      itemIds.set(key, id)
      inventoryItems += 1
    }
    for (const dish of SHAFRAN_DISHES.filter((row) => row.good)) {
      const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", dishExternalId(dish.id))).unique()
      if (!product) throw new ConvexError(`Нет товара ${dish.name}`)
      // seedAll makes every product a dish written off by ingredients; a bought-in good is a finished product.
      await ctx.db.patch(product._id, { itemType: "good", writeOffMethod: "finished-product", unitWeightKg: dish.good!.kg })
      await upsert(ctx, "inventoryItems", { externalId: `shafran-good-${dish.id}`, name: dish.name, nameSort: dish.name.toLocaleLowerCase("ru"), searchText: dish.name.toLocaleLowerCase("ru"), unit: "шт", unitExternalId: "unit-pcs", kind: "good", productExternalId: product.externalId, active: true })
      inventoryItems += 1
    }

    let recipes = 0
    const effectiveFrom = now - 180 * DAY_MS
    for (const dish of SHAFRAN_DISHES.filter((row) => row.recipe)) {
      const product = (await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", dishExternalId(dish.id))).unique())!
      recipes += 1
      if (await ctx.db.query("recipes").withIndex("by_product", (q) => q.eq("productId", product._id)).first()) continue
      const recipeId = await ctx.db.insert("recipes", { productId: product._id, createdAt: now })
      const versionId = await ctx.db.insert("recipeVersions", { recipeId, productId: product._id, version: 1, effectiveFrom, batchYield: 1, technology: "Демо-техкарта: закладка на 1 порцию.", status: "active", createdBy: SEED_ACTOR, createdAt: now })
      let sortOrder = 0
      for (const [key, quantity] of Object.entries(dish.recipe!)) {
        const ingredient = SHAFRAN_INGREDIENTS[key]
        await ctx.db.insert("recipeLines", { versionId, kind: "item", inventoryItemId: itemIds.get(key)!, name: ingredient.name, unit: ingredient.unit, quantity, unitWeightKg: ingredient.unit === "кг" ? 1 : ingredient.kg!, coldLossPercent: 0, hotLossPercent: 0, sortOrder: sortOrder++ })
      }
      await ctx.db.patch(recipeId, { activeVersionId: versionId })
    }

    let warehouses = 0
    for (const branch of SHAFRAN_BRANCHES) {
      for (const [suffix, name, kind, isSalesDefault] of [["main", "Основной склад", "storage", true], ["kitchen", "Кухня", "kitchen", false]] as const) {
        await upsert(ctx, "warehouses", { externalId: `${branch.externalId}-${suffix}`, name, shortName: name, restaurantExternalId: branch.externalId, organizationExternalId: ORG, kind, allowNegativeStock: false, internalTransfers: true, isSalesDefault, active: true, searchText: `${name} ${branch.address}`.toLocaleLowerCase("ru") })
        warehouses += 1
      }
      for (let table = 1; table <= 8; table += 1) {
        await upsert(ctx, "diningTables", { externalId: `${branch.externalId}-table-${table}`, restaurantExternalId: branch.externalId, hall: "Зал", label: `Стол ${table}`, capacity: 4, shape: "rect", x: ((table - 1) % 4) * 3, y: Math.floor((table - 1) / 4) * 3, width: 2, height: 2, rotation: 0, active: true, updatedAt: now })
      }
    }

    // TODO(client): commission of Wolt and Glovo is unknown — 0 % until Шафран gives the contract terms.
    for (const source of SHAFRAN_DELIVERY_SOURCES) {
      await upsert(ctx, "deliverySources", { ...source, restaurantExternalIds: ["*"], commissionPercent: 0, confirmationRequired: false, settlementMode: "on-closed", active: true, updatedAt: now })
    }
    await upsert(ctx, "loyaltyPrograms", { externalId: "shafran-loyalty", name: "Шафран Бонус (демо)", status: "published", programKind: "bonus", accrualPercent: 5, maxRedemptionPercent: 30, welcomeBonus: 0, startsAt: now - 365 * DAY_MS, restaurantExternalIds: ["*"], expirationDays: 180, priority: 10, createdAt: now, updatedAt: now })

    for (let index = 0; index < GUEST_COUNT; index += 1) {
      const name = personName(index + 3)
      const phone = guestPhone(index)
      await upsert(ctx, "guests", { externalId: guestExternalId(index), phone, name, points: 0, createdAt: now - (200 - (index % 150)) * DAY_MS, status: "active", organizationExternalId: ORG, consentState: "unknown", visits: 0, turnover: 0, searchText: `${name} ${phone}`.toLocaleLowerCase("ru"), updatedAt: now })
    }

    for (const person of shafranEmployees()) {
      const employee = await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", person.code)).unique()
      if (!employee) continue
      const position = POSITIONS.find((row) => row.externalId === person.position)!
      await ctx.db.patch(employee._id, { personnelNumber: `Ш-${person.code}`, positionExternalId: position.externalId, employmentDate: `2025-${pad((Number(person.code) % 12) + 1)}-01`, payType: position.payType, baseRate: position.defaultRate, admitted: true, updatedAt: now })
    }
    return { inventoryItems, recipes, guests: GUEST_COUNT, warehouses }
  },
})

/**
 * Office users keep their sign-in; a network-wide scope stays «*», a one-branch scope moves to the demo branch.
 * Demo accounts (externalId demo-*) whose e-mail is no longer in demo-logins.ts are removed with their Convex
 * Auth user, accounts and sessions; scripts/seed-demo-logins.mjs then creates the current ones.
 */
export const repointOfficeUsers = internalMutation({
  args: { demoEmails: v.array(v.string()) },
  returns: v.object({ repointed: v.number(), removedDemoUsers: v.number() }),
  handler: async (ctx, args) => {
    assertDevDeployment()
    const users = await ctx.db.query("officeUsers").withIndex("by_email").take(100)
    let removedDemoUsers = 0
    for (const user of users) {
      if (user.externalId.startsWith("demo-") && !args.demoEmails.includes(user.email)) {
        await removeAuthUser(ctx, user.email)
        await ctx.db.delete(user._id)
        removedDemoUsers += 1
        continue
      }
      const network = user.restaurantScopes.includes("*") || user.restaurantScopes.length > 1
      await ctx.db.patch(user._id, {
        restaurantScopes: network ? ["*"] : [SHAFRAN_DEMO_RESTAURANT],
        organizationScopes: user.organizationScopes?.includes("*") ? ["*"] : [ORG],
        warehouseScopes: network ? ["*"] : [`${SHAFRAN_DEMO_RESTAURANT}-main`, `${SHAFRAN_DEMO_RESTAURANT}-kitchen`],
      })
    }
    return { repointed: users.length - removedDemoUsers, removedDemoUsers }
  },
})

async function removeAuthUser(ctx: MutationCtx, email: string) {
  for (const user of await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).take(10)) {
    for (const account of await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", user._id)).take(20)) await ctx.db.delete(account._id)
    for (const session of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", user._id)).take(100)) {
      for (const token of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", session._id)).take(100)) await ctx.db.delete(token._id)
      await ctx.db.delete(session._id)
    }
    await ctx.db.delete(user._id)
  }
  // An account can outlive its user row: by the password provider's account id (the e-mail) too.
  for (const account of await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", email)).take(10)) await ctx.db.delete(account._id)
}

const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")

export const seedChain = internalAction({
  args: { demoEmails: v.array(v.string()) },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    assertDevDeployment()
    const catalog: { employees: { created: boolean }[] } = await ctx.runMutation(internal.domains.seed.mutations.seedAll, shafranCatalogPayload(randomHex))
    const reference: Record<string, number> = await ctx.runMutation(internal.domains.seed.shafran.seedReference, {})
    const officeUsers: { repointed: number; removedDemoUsers: number } = await ctx.runMutation(internal.domains.seed.shafran.repointOfficeUsers, { demoEmails: args.demoEmails })
    return { catalog: { ...catalog, employees: catalog.employees.length, employeesCreated: catalog.employees.filter((row) => row.created).length }, reference, officeUsers }
  },
})

// ── Sales history ───────────────────────────────────────────────────────────────────────────────
type OrderKind = "dine-in" | "takeaway" | "delivery"
export type PlannedOrder = { index: number; at: number; type: OrderKind; guests: number; lines: { dish: string; quantity: number }[]; method: "cash" | "card" | "qr"; guestIndex: number | null; table: number; source: string; payMinutes: number; cookMinutes: number }

const MAIN_CATEGORIES = [
  ["shafran-cat-plov", 0.22],
  ["shafran-cat-hot", 0.28],
  ["shafran-cat-dough", 0.17],
  ["shafran-cat-grill", 0.12],
  ["shafran-cat-european", 0.21],
] as const
const NOT_MAIN = new Set(["lepeshka", "baursak"])
const dishesOf = (category: string) => SHAFRAN_DISHES.filter((dish) => dish.category === category && !NOT_MAIN.has(dish.id))
const dishWeight = (dish: { popular?: boolean }) => (dish.popular ? 3 : 1)

/** Open and close (minutes from the business day start) of a branch on a date; sales end by 23:40. */
function openingWindow(branch: (typeof SHAFRAN_BRANCHES)[number], businessDate: string) {
  const weekday = new Date(`${businessDate}T00:00:00Z`).getUTCDay() || 7
  const [open, close] = branch.hours[weekday]
  return { open, close: Math.min(close, 23 * 60 + 40), weekend: weekday >= 6 }
}

/** The day's orders of a branch — a pure function of (branch, date, base volume), so chunks and re-runs agree. */
export function planDay(restaurantExternalId: string, businessDate: string, baseOrders: number): PlannedOrder[] {
  const branch = SHAFRAN_BRANCHES.find((row) => row.externalId === restaurantExternalId)
  if (!branch) throw new ConvexError(`Нет филиала ${restaurantExternalId}`)
  const random = rngFor(`${restaurantExternalId}:${businessDate}`)
  const { open, close, weekend } = openingWindow(branch, businessDate)
  const count = Math.max(1, Math.round(baseOrders * branch.load * (weekend ? 1.2 : 1) * (0.85 + 0.3 * random())))
  // Lunch and dinner peaks over the opening hours.
  const weight = (minute: number) => 1 + 2.2 * Math.exp(-(((minute - 13 * 60) / 60) ** 2)) + 1.6 * Math.exp(-(((minute - 19 * 60) / 75) ** 2))
  const minutes: number[] = []
  while (minutes.length < count) {
    const minute = open + 10 + random() * Math.max(30, close - open - 30)
    if (random() * 3.3 < weight(minute)) minutes.push(minute)
  }
  minutes.sort((a, b) => a - b)
  const dayStart = almatyDayStart(businessDate)
  const paidAt = (order: { at: number; payMinutes: number }) => order.at + order.payMinutes * 60_000
  // Numbered in payment order: sale write-offs must never be backdated against an earlier-paid check.
  return minutes.map((minute): PlannedOrder => {
    const roll = random()
    const type: OrderKind = roll < 0.12 ? "delivery" : roll < 0.42 ? "takeaway" : "dine-in"
    const guests = type === "dine-in" ? pick(random, [1, 2, 3, 4], (n) => [5, 4, 2, 1][n - 1]) : type === "takeaway" ? pick(random, [1, 2], (n) => (n === 1 ? 3 : 1)) : pick(random, [1, 2, 3], (n) => [3, 2, 1][n - 1])
    const quantities = new Map<string, number>()
    const add = (dish: string) => quantities.set(dish, (quantities.get(dish) ?? 0) + 1)
    for (let guest = 0; guest < guests; guest += 1) {
      const [category] = pick(random, MAIN_CATEGORIES, ([, share]) => share)
      add(pick(random, dishesOf(category), dishWeight).id)
      if (random() < 0.3) add(pick(random, dishesOf("shafran-cat-soups"), dishWeight).id)
      if (random() < 0.25) add(pick(random, dishesOf("shafran-cat-salads"), dishWeight).id)
      if ((category === "shafran-cat-grill" || category === "shafran-cat-european") && random() < 0.5) add(pick(random, dishesOf("shafran-cat-sides"), dishWeight).id)
      if (random() < 0.7) add(pick(random, dishesOf("shafran-cat-drinks"), dishWeight).id)
      if (random() < 0.12) add(pick(random, dishesOf("shafran-cat-desserts"), dishWeight).id)
      if (random() < 0.25) add(random() < 0.6 ? "lepeshka" : "baursak")
    }
    const source = pick(random, SHAFRAN_DELIVERY_SOURCES, (row) => (row.kind === "aggregator" ? (row.name === "Wolt" ? 0.35 : 0.25) : 0.4)).externalId
    const methodRoll = random()
    const method = type === "delivery" && source !== "shafran-delivery-own" ? "card" : methodRoll < 0.45 ? "qr" : methodRoll < 0.8 ? "card" : "cash"
    return {
      index: 0,
      at: dayStart + Math.round(minute) * 60_000,
      type,
      guests,
      lines: [...quantities].map(([dish, quantity]) => ({ dish, quantity })),
      method,
      guestIndex: random() < 0.3 ? Math.floor(random() * GUEST_COUNT) : null,
      table: 1 + Math.floor(random() * 8),
      source,
      payMinutes: 2 + Math.floor(random() * 5),
      cookMinutes: 8 + Math.floor(random() * 14),
    }
  })
    .sort((a, b) => paidAt(a) - paidAt(b))
    .map((order, index) => ({ ...order, index }))
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
const RECEIPT_EVERY_DAYS = 7

/** Stock a receipt brings: 1.25 × what the plans of the covered days consume (ingredients by recipe, goods by count). */
export function receiptDemand(restaurantExternalId: string, businessDate: string, days: number, baseOrders: number) {
  const demand = new Map<string, number>() // ingredient key, or good:<dish id>
  for (let offset = 0; offset < days; offset += 1) {
    for (const order of planDay(restaurantExternalId, addDays(businessDate, offset), baseOrders)) {
      for (const line of order.lines) {
        const dish = SHAFRAN_DISHES.find((row) => row.id === line.dish)!
        if (dish.good) demand.set(`good:${dish.id}`, (demand.get(`good:${dish.id}`) ?? 0) + line.quantity)
        for (const [key, quantity] of Object.entries(dish.recipe ?? {})) demand.set(key, (demand.get(key) ?? 0) + quantity * line.quantity)
      }
    }
  }
  return [...demand].map(([key, quantity]) => ({ key, quantity: key.startsWith("good:") || SHAFRAN_INGREDIENTS[key].unit === "шт" ? Math.ceil(quantity * 1.25) : Math.ceil(quantity * 1.25 * 10) / 10 }))
}

async function postDemoReceipts(ctx: MutationCtx, args: { restaurantExternalId: string; businessDate: string; at: number; coverDays: number; baseOrders: number; warehouse: Doc<"warehouses"> }) {
  const random = rngFor(`receipt:${args.restaurantExternalId}:${args.businessDate}`)
  const bySupplier = new Map<SupplierKey, { itemExternalId: string; quantity: number; unitCost: number }[]>()
  for (const { key, quantity } of receiptDemand(args.restaurantExternalId, args.businessDate, args.coverDays, args.baseOrders)) {
    const good = key.startsWith("good:") ? SHAFRAN_DISHES.find((dish) => `good:${dish.id}` === key)!.good! : null
    const supplier: SupplierKey = good ? "goods" : SHAFRAN_INGREDIENTS[key].supplier
    const basePrice = good ? good.cost : SHAFRAN_INGREDIENTS[key].price
    const lines = bySupplier.get(supplier) ?? []
    lines.push({ itemExternalId: good ? `shafran-good-${key.slice(5)}` : `shafran-ing-${key}`, quantity, unitCost: Math.round(basePrice * (0.97 + random() * 0.08)) })
    bySupplier.set(supplier, lines)
  }
  for (const [supplierKey, lines] of bySupplier) {
    const externalId = `shafran-receipt:${args.restaurantExternalId}:${args.businessDate}:${supplierKey}`
    if (await ctx.db.query("receipts").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()) continue
    const supplier = (await ctx.db.query("suppliers").withIndex("by_external_id", (q) => q.eq("externalId", `shafran-supplier-${supplierKey}`)).unique())!
    const number = await nextNumber(ctx, { moduleId: "receipts", prefix: "ПН", organizationExternalId: ORG, businessDate: args.businessDate })
    const resolved = []
    for (const line of lines) {
      const item = (await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", line.itemExternalId)).unique())!
      resolved.push({ ...line, item, amount: Math.round(line.quantity * line.unitCost) })
    }
    const total = resolved.reduce((sum, line) => sum + line.amount, 0)
    const now = Date.now()
    const receiptId = await ctx.db.insert("receipts", { externalId, number, date: args.at, supplierId: supplier._id, warehouseId: args.warehouse._id, restaurantExternalId: args.restaurantExternalId, organizationExternalId: ORG, invoiceNumber: `ДЕМО-${args.businessDate.replaceAll("-", "")}-${supplierKey.toUpperCase()}`, status: "posted", totalGross: total, totalVat: 0, totalNet: total, searchText: `${number} ${supplier.name}`.toLocaleLowerCase("ru"), createdAt: now, updatedAt: now, postedAt: now })
    const byAccount = new Map<string, number>()
    for (const [index, line] of resolved.entries()) {
      const lineNo = index + 1
      await ctx.db.insert("receiptLines", { receiptId, lineNo, inventoryItemId: line.item._id, quantity: line.quantity, unitCostGross: line.unitCost, vatRate: 0, amountGross: line.amount })
      const lotExternalId = `${externalId}:${lineNo}` // the posting convention of domains/purchasing/receipts.ts
      await applyStockMovement(ctx, { externalId: lotExternalId, kind: "receipt", sourceModuleId: "receipts", sourceExternalId: externalId, sourceNumber: number, warehouseId: args.warehouse._id, inventoryItemId: line.item._id, quantityDelta: line.quantity, unitCost: line.amount / line.quantity, occurredAt: args.at, actorEmail: SEED_ACTOR })
      await ctx.db.insert("stockLots", { externalId: lotExternalId, inventoryItemId: line.item._id, warehouseId: args.warehouse._id, quantity: line.quantity, remainingQuantity: line.quantity, unitCost: line.amount / line.quantity, sourceModuleId: "receipts", sourceExternalId: externalId, sourceNumber: number, receivedAt: args.at })
      const account = stockAccountOf(line.item)
      byAccount.set(account, (byAccount.get(account) ?? 0) + line.amount)
    }
    for (const [account, amount] of byAccount) {
      await postJournalEntry(ctx, { externalId: `${externalId}:je:${account}`, restaurantExternalId: args.restaurantExternalId, sourceModuleId: "receipts", sourceExternalId: externalId, sourceNumber: number, occurredAt: args.at, debitAccount: account, creditAccount: "payables", amount, description: `Приход ${number} от «${supplier.name}»`, warehouseExternalId: args.warehouse.externalId })
    }
    await createObligation(ctx, { restaurantExternalId: args.restaurantExternalId, direction: "payable", amount: total, name: `Оплата поставщику «${supplier.name}» по ${number}`, kind: "supplier", sourceModuleId: "receipts", sourceExternalId: externalId, sourceNumber: number, dueDate: addDays(args.businessDate, supplier.paymentDelayDays ?? 0), occurredAt: args.at })
  }
}

const statusAt = (now: number, times: { startedAt: number; readyAt: number; completedAt: number }) =>
  times.completedAt <= now ? ("completed" as const) : times.readyAt <= now ? ("ready" as const) : times.startedAt <= now ? ("preparing" as const) : ("queued" as const)

const CHUNK = 6

/**
 * One chunk of a branch's business day: at the first chunk the shift opens (and stock arrives on receipt days);
 * orders [from, from + CHUNK) are created and paid through settleOrder at their own past time; the last chunk
 * closes the shift with its Z-report — or, today, leaves it open with three checks still on the kitchen screen.
 * Idempotent: orders by clientOrderId, the shift by its opening time, receipts and the Z-report by key.
 */
export const seedDay = internalMutation({
  args: { restaurantExternalId: v.string(), businessDate: v.string(), startDate: v.string(), from: v.number(), baseOrders: v.number() },
  returns: v.object({ next: v.union(v.number(), v.null()), created: v.number() }),
  handler: async (ctx, args) => {
    assertDevDeployment()
    const now = Date.now()
    const today = businessDateFor(now)
    if (args.businessDate > today) throw new ConvexError("Дата в будущем")
    const branch = SHAFRAN_BRANCHES.find((row) => row.externalId === args.restaurantExternalId)
    if (!branch) throw new ConvexError(`Нет филиала ${args.restaurantExternalId}`)
    const restaurant = (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", branch.externalId)).unique())!
    let terminal = (await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", `${branch.externalId}-01`)).unique())!
    const warehouse = (await ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", `${branch.externalId}-main`)).unique())!
    const cashier = (await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", cashierCode(branch.externalId))).unique())!
    const dayStart = almatyDayStart(args.businessDate)
    const { open, close } = openingWindow(branch, args.businessDate)
    const openedAt = dayStart + (open - 30) * 60_000
    if (openedAt > now) return { next: null, created: 0 } // today, before opening

    const dayIndex = Math.round((Date.parse(`${args.businessDate}T00:00:00Z`) - Date.parse(`${args.startDate}T00:00:00Z`)) / DAY_MS)
    if (args.from === 0 && dayIndex % RECEIPT_EVERY_DAYS === 0) {
      await postDemoReceipts(ctx, { restaurantExternalId: branch.externalId, businessDate: args.businessDate, at: dayStart + (open - 90) * 60_000, coverDays: dayIndex === 0 ? RECEIPT_EVERY_DAYS + 2 : RECEIPT_EVERY_DAYS, baseOrders: args.baseOrders, warehouse })
    }
    let shift = await ctx.db.query("shifts").withIndex("by_terminal_opened", (q) => q.eq("terminalId", terminal._id).eq("openedAt", openedAt)).unique()
    if (!shift) {
      const shiftId = await ctx.db.insert("shifts", { restaurantId: restaurant._id, terminalId: terminal._id, number: dayIndex + 1, businessDate: args.businessDate, status: "open", openedBy: cashier._id, openedAt, openingCash: 20_000, openingNote: "" })
      await ctx.db.insert("shiftEvents", { shiftId, type: "open", amount: 20_000, reason: "Открытие смены", actorId: cashier._id, createdAt: openedAt })
      shift = (await ctx.db.get(shiftId))!
    }

    const plan = planDay(branch.externalId, args.businessDate, args.baseOrders)
    const products = new Map<string, Doc<"products">>()
    const productOf = async (dish: string) => {
      if (!products.has(dish)) products.set(dish, (await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", dishExternalId(dish))).unique())!)
      return products.get(dish)!
    }
    let created = 0
    for (const planned of plan.slice(args.from, args.from + CHUNK)) {
      const paidAt = planned.at + planned.payMinutes * 60_000
      if (paidAt > now - 60_000) continue // not yet happened today
      const clientOrderId = `shafran:${branch.externalId}:${args.businessDate}:${planned.index}`
      if (await ctx.db.query("orders").withIndex("by_client_order_id", (q) => q.eq("clientOrderId", clientOrderId)).unique()) continue
      const orderType = await resolveOrderType(ctx, branch.externalId, { orderType: planned.type }, planned.at)
      const lines = []
      for (const line of planned.lines) {
        const product = await productOf(line.dish)
        const { price } = await resolvePrice(ctx, { product, restaurantExternalId: branch.externalId, at: planned.at })
        lines.push({ product, quantity: line.quantity, unitPrice: price, lineTotal: price * line.quantity })
      }
      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0)
      const serviceChargeAmount = calculateServiceCharge(subtotal, 0, orderType.serviceChargePercent)
      const total = calculateOrderTotal(subtotal, 0, serviceChargeAmount)
      const guest = planned.guestIndex === null ? null : await ctx.db.query("guests").withIndex("by_external_id", (q) => q.eq("externalId", guestExternalId(planned.guestIndex!))).unique()
      terminal = (await ctx.db.get(terminal._id))!
      const number = terminal.nextOrderNumber
      await ctx.db.patch(terminal._id, { nextOrderNumber: number + 1 })
      const tableLabel = planned.type === "dine-in" ? `Стол ${planned.table}` : undefined
      const orderId = await ctx.db.insert("orders", {
        number,
        orderType: orderType.serviceMode,
        orderTypeExternalId: orderType.externalId,
        orderTypeName: orderType.name,
        ...(tableLabel ? { tableLabel, hallLabel: "Зал" } : {}),
        guestCount: planned.guests,
        status: "draft",
        discountPercent: 0,
        discountAmount: 0,
        subtotal,
        serviceChargePercent: orderType.serviceChargePercent,
        serviceChargeAmount,
        total,
        ...(orderType.tag ? { retailConfigVersion: orderType.tag } : {}),
        clientOrderId,
        restaurantId: restaurant._id,
        terminalId: terminal._id,
        originatingShiftId: shift._id,
        currentShiftId: shift._id,
        createdBy: cashier._id,
        updatedBy: cashier._id,
        comment: "",
        ...(guest ? { guestId: guest._id, guestExternalId: guest.externalId } : {}),
        version: 1,
        createdAt: planned.at,
        updatedAt: planned.at,
        businessDate: args.businessDate,
        searchText: `${number} ${tableLabel ?? ""} ${lines.map((line) => `${line.product.name} ${line.product.nameKk}`).join(" ")}`.toLocaleLowerCase("ru"),
      })
      for (const line of lines) {
        await ctx.db.insert("orderLines", { orderId, clientLineId: `${clientOrderId}:${line.product.externalId}`, productId: line.product._id, productExternalId: line.product.externalId, productName: line.product.name, quantity: line.quantity, unitPrice: line.unitPrice, modifiers: [], lineTotal: line.lineTotal })
      }
      if (planned.type === "delivery") {
        const customerName = guest?.name ?? "Гость (демо)"
        const phone = guest?.phone ?? guestPhone(9998)
        const address = `ул. Примерная, ${1 + (planned.index % 120)} (демо)`
        const deliveryNumber = await nextDeliveryNumber(ctx, ORG)
        const deliveredAt = paidAt + (planned.cookMinutes + 25) * 60_000
        await ctx.db.insert("deliveryOrders", {
          externalId: `shafran-delivery:${clientOrderId}`,
          orderId,
          organizationExternalId: ORG,
          restaurantExternalId: branch.externalId,
          number: deliveryNumber,
          status: deliveredAt <= now ? "closed" : "on-way",
          ...(guest ? { guestId: guest._id } : {}),
          customerName,
          phone,
          address,
          sourceExternalId: planned.source,
          expectedAt: planned.at + 60 * 60_000,
          cookingStartAt: paidAt,
          predictedCookingCompleteAt: paidAt + planned.cookMinutes * 60_000,
          predictedDeliveryAt: planned.at + 60 * 60_000,
          ...(deliveredAt <= now ? { actualDeliveredAt: deliveredAt } : {}),
          pickedUpAt: paidAt + (planned.cookMinutes + 3) * 60_000,
          subtotal,
          deliveryFee: 0,
          total,
          paymentStatus: "paid",
          comment: "",
          version: 1,
          searchText: `${deliveryNumber} ${customerName} ${phone} ${address}`.toLocaleLowerCase("ru"),
          createdAt: planned.at,
          updatedAt: paidAt,
        })
      }
      const order = (await ctx.db.get(orderId))!
      await settleOrder(ctx, {
        order,
        shift,
        actor: { employeeId: cashier._id, restaurant, terminal },
        payments: [{ method: planned.method, amount: total, ...(planned.method === "cash" ? { tendered: Math.ceil(total / 1000) * 1000 } : {}) }],
        idempotencyKey: `shafran:${clientOrderId}`,
        source: planned.type === "delivery" ? "delivery" : "pos",
        occurredAt: paidAt,
      })
      for (const ticket of await ctx.db.query("kitchenTickets").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(10)) {
        const times = { startedAt: paidAt + 60_000, readyAt: paidAt + planned.cookMinutes * 60_000, completedAt: paidAt + (planned.cookMinutes + 2) * 60_000 }
        const status = statusAt(now, times)
        await ctx.db.patch(ticket._id, { status, updatedAt: Math.min(now, times.completedAt), ...(status !== "queued" ? { startedAt: times.startedAt } : {}), ...(status === "ready" || status === "completed" ? { readyAt: times.readyAt } : {}), ...(status === "completed" ? { completedAt: times.completedAt } : {}) })
      }
      // History needs no integration jobs: the order.paid events count as delivered.
      for (const event of await ctx.db.query("outboxEvents").withIndex("by_aggregate", (q) => q.eq("aggregateExternalId", String(orderId))).take(10)) {
        if (event.status === "pending") await ctx.db.patch(event._id, { status: "published", publishedAt: now, attempts: 1 })
      }
      created += 1
    }

    const next = args.from + CHUNK < plan.length ? args.from + CHUNK : null
    if (next === null) {
      if (args.businessDate < today) await closeShift(ctx, { shift: (await ctx.db.get(shift._id))!, terminal, cashier, closedAt: Math.max(dayStart + close * 60_000 + 15 * 60_000, (plan.at(-1)?.at ?? openedAt) + 30 * 60_000) })
      else await openChecksOnScreen(ctx, { restaurant, terminal, shift, cashier, now })
    }
    return { next, created }
  },
})

async function closeShift(ctx: MutationCtx, args: { shift: Doc<"shifts">; terminal: Doc<"posTerminals">; cashier: Doc<"employees">; closedAt: number }) {
  const { shift } = args
  if (shift.status === "closed") return
  const snapshot = await buildXReportSnapshot(ctx, shift)
  const zReportNumber = `Z-${shift.businessDate.replaceAll("-", "")}-${pad(args.terminal.terminalNumber)}-${pad(shift.number, 3)}`
  await ctx.db.patch(shift._id, { status: "closed", expectedCash: snapshot.expectedCash, countedCash: snapshot.expectedCash, variance: 0, closeNote: "", closedBy: args.cashier._id, closedAt: args.closedAt, zReportNumber })
  await ctx.db.insert("shiftEvents", { shiftId: shift._id, type: "close", amount: snapshot.expectedCash, reason: "Закрытие смены", actorId: args.cashier._id, createdAt: args.closedAt })
  await ctx.db.insert("zReports", { shiftId: shift._id, number: zReportNumber, restaurantId: shift.restaurantId, terminalId: shift.terminalId, businessDate: shift.businessDate, shiftNumber: shift.number, openedAt: shift.openedAt, closedAt: args.closedAt, closedBy: args.cashier._id, closedByName: args.cashier.displayName, openingCash: shift.openingCash, countedCash: snapshot.expectedCash, variance: 0, snapshot, nonFiscal: true, createdAt: args.closedAt })
}

/** Today: three dine-in checks still open, sent to the kitchen — one ready, one cooking, one just queued. */
async function openChecksOnScreen(ctx: MutationCtx, args: { restaurant: Doc<"restaurants">; terminal: Doc<"posTerminals">; shift: Doc<"shifts">; cashier: Doc<"employees">; now: number }) {
  const random = rngFor(`open:${args.restaurant.externalId}:${args.shift.businessDate}`)
  const orderType = await resolveOrderType(ctx, args.restaurant.externalId, { orderType: "dine-in" }, args.now)
  for (const [slot, minutesAgo, table] of [[0, 24, 2], [1, 12, 5], [2, 3, 7]] as const) {
    const clientOrderId = `shafran:${args.restaurant.externalId}:${args.shift.businessDate}:open:${slot}`
    if (await ctx.db.query("orders").withIndex("by_client_order_id", (q) => q.eq("clientOrderId", clientOrderId)).unique()) continue
    const createdAt = args.now - minutesAgo * 60_000
    if (createdAt < args.shift.openedAt) continue
    const dishes = [pick(random, dishesOf(pick(random, MAIN_CATEGORIES, ([, share]) => share)[0]), dishWeight), pick(random, dishesOf("shafran-cat-drinks"), dishWeight)]
    const lines = []
    for (const dish of dishes) {
      const product = (await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", dishExternalId(dish.id))).unique())!
      const { price } = await resolvePrice(ctx, { product, restaurantExternalId: args.restaurant.externalId, at: createdAt })
      lines.push({ product, price })
    }
    const subtotal = lines.reduce((sum, line) => sum + line.price, 0)
    const serviceChargeAmount = calculateServiceCharge(subtotal, 0, orderType.serviceChargePercent)
    const terminal = (await ctx.db.get(args.terminal._id))!
    await ctx.db.patch(terminal._id, { nextOrderNumber: terminal.nextOrderNumber + 1 })
    const orderId = await ctx.db.insert("orders", {
      number: terminal.nextOrderNumber,
      orderType: orderType.serviceMode,
      orderTypeExternalId: orderType.externalId,
      orderTypeName: orderType.name,
      tableLabel: `Стол ${table}`,
      hallLabel: "Зал",
      guestCount: 2,
      status: "draft",
      discountPercent: 0,
      discountAmount: 0,
      subtotal,
      serviceChargePercent: orderType.serviceChargePercent,
      serviceChargeAmount,
      total: calculateOrderTotal(subtotal, 0, serviceChargeAmount),
      clientOrderId,
      restaurantId: args.restaurant._id,
      terminalId: terminal._id,
      originatingShiftId: args.shift._id,
      currentShiftId: args.shift._id,
      createdBy: args.cashier._id,
      updatedBy: args.cashier._id,
      comment: "",
      version: 1,
      createdAt,
      updatedAt: createdAt,
      businessDate: args.shift.businessDate,
      kitchenSentAt: createdAt + 60_000,
      searchText: `${terminal.nextOrderNumber} Стол ${table} ${lines.map((line) => line.product.name).join(" ")}`.toLocaleLowerCase("ru"),
    })
    for (const line of lines) await ctx.db.insert("orderLines", { orderId, clientLineId: `${clientOrderId}:${line.product.externalId}`, productId: line.product._id, productExternalId: line.product.externalId, productName: line.product.name, quantity: 1, unitPrice: line.price, modifiers: [], lineTotal: line.price })
    const order = (await ctx.db.get(orderId))!
    const orderLines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(10)
    const ticketId = await createKitchenTicket(ctx, { order, lines: orderLines, restaurantId: args.restaurant._id, source: "pos", now: createdAt + 60_000 })
    if (ticketId && slot < 2) await ctx.db.patch(ticketId, slot === 0 ? { status: "ready", startedAt: createdAt + 2 * 60_000, readyAt: args.now - 2 * 60_000 } : { status: "preparing", startedAt: createdAt + 2 * 60_000 })
  }
}

/** One branch's history, chronologically (stock movements must never be backdated), chunk by chunk. */
export const seedHistory = internalAction({
  args: { restaurantExternalId: v.string(), days: v.number(), baseOrders: v.number() },
  returns: v.object({ days: v.number(), orders: v.number() }),
  handler: async (ctx, args) => {
    assertDevDeployment()
    const today = businessDateFor(Date.now())
    const startDate = addDays(today, -args.days)
    let orders = 0
    for (let offset = 0; offset <= args.days; offset += 1) {
      const businessDate = addDays(startDate, offset)
      let from: number | null = 0
      while (from !== null) {
        const result: { next: number | null; created: number } = await ctx.runMutation(internal.domains.seed.shafran.seedDay, { restaurantExternalId: args.restaurantExternalId, businessDate, startDate, from, baseOrders: args.baseOrders })
        orders += result.created
        from = result.next
      }
    }
    return { days: args.days + 1, orders }
  },
})

// ── Read-only verification ──────────────────────────────────────────────────────────────────────
export const countPage = internalQuery({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ count: v.number(), cursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    assertDevDeployment()
    if (!(args.table in schema.tables)) throw new ConvexError(`Нет таблицы ${args.table}`)
    const page = await ctx.db.query(args.table as TableNames).paginate({ numItems: 2000, cursor: args.cursor })
    return { count: page.page.length, cursor: page.continueCursor, isDone: page.isDone }
  },
})

const SUMMARY_TABLES = ["organizations", "restaurants", "posTerminals", "warehouses", "diningTables", "categories", "products", "productPrices", "inventoryItems", "recipes", "recipeLines", "suppliers", "receipts", "employees", "positions", "officeUsers", "guests", "loyaltyPrograms", "loyaltyTransactions", "deliverySources", "deliveryOrders", "shifts", "zReports", "orders", "orderLines", "payments", "kitchenTickets", "stockMovements", "stockBalances", "dailySalesFacts", "dailyStockFacts", "journalEntries", "financeRecords", "salesWithoutRecipe"] as const

/** Row counts of the seeded tables and the names still mentioning the previous client — read-only. */
export const summary = internalAction({
  args: {},
  returns: v.object({ counts: v.record(v.string(), v.number()), leftoverNames: v.array(v.string()) }),
  handler: async (ctx): Promise<{ counts: Record<string, number>; leftoverNames: string[] }> => {
    assertDevDeployment()
    const counts: Record<string, number> = {}
    for (const table of SUMMARY_TABLES) {
      let cursor: string | null = null
      let total = 0
      for (;;) {
        const page: { count: number; cursor: string; isDone: boolean } = await ctx.runQuery(internal.domains.seed.shafran.countPage, { table, cursor })
        total += page.count
        if (page.isDone) break
        cursor = page.cursor
      }
      counts[table] = total
    }
    const leftoverNames: string[] = await ctx.runQuery(internal.domains.seed.shafran.leftoverNames, {})
    return { counts, leftoverNames }
  },
})

/** Names of organizations, restaurants, products and employees that still mention the previous client. */
export const leftoverNames = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    assertDevDeployment()
    const names = [
      ...(await ctx.db.query("organizations").withIndex("by_external_id").take(100)).flatMap((row) => [row.name, row.legalName ?? ""]),
      ...(await ctx.db.query("restaurants").withIndex("by_external_id").take(100)).flatMap((row) => [row.name, row.address]),
      ...(await ctx.db.query("products").withIndex("by_external_id").take(200)).flatMap((row) => [row.name, row.nameKk]),
      ...(await ctx.db.query("employees").withIndex("by_code").take(200)).map((row) => row.displayName),
    ]
    return names.filter((name) => /sandyq|сандык|сандық/i.test(name))
  },
})
