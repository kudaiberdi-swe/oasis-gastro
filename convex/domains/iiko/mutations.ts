import { v } from "convex/values"

import { internalMutation } from "../../_generated/server"
import { applySupplier, applyTerminal, applyUnit, applyWarehouse, supplierArgs, terminalArgs, unitArgs, warehouseArgs } from "./projections"

// --- Run tracking (called from scripts/iiko/import-convex.mjs via `npx convex run`) -------

export const beginRun = internalMutation({
  args: { runExternalId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("iikoImportRuns").withIndex("by_external_id", (q) => q.eq("runExternalId", args.runExternalId)).unique()
    const value = { runExternalId: args.runExternalId, status: "running" as const, startedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert("iikoImportRuns", value)
  },
})

export const completeRun = internalMutation({
  args: { runExternalId: v.string(), counts: v.object({ departments: v.number(), employees: v.number() }), countsByEndpoint: v.optional(v.record(v.string(), v.number())) },
  handler: async (ctx, args) => {
    const run = await ctx.db.query("iikoImportRuns").withIndex("by_external_id", (q) => q.eq("runExternalId", args.runExternalId)).unique()
    if (!run) return
    await ctx.db.patch(run._id, { status: "completed", completedAt: Date.now(), counts: args.counts, ...(args.countsByEndpoint ? { countsByEndpoint: args.countsByEndpoint } : {}) })
  },
})

export const failRun = internalMutation({
  args: { runExternalId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.query("iikoImportRuns").withIndex("by_external_id", (q) => q.eq("runExternalId", args.runExternalId)).unique()
    if (!run) return
    await ctx.db.patch(run._id, { status: "failed", completedAt: Date.now(), error: args.error })
  },
})

export const recordEndpointState = internalMutation({
  args: { endpointKey: v.string(), status: v.union(v.literal("ok"), v.literal("error"), v.literal("unsupported")), message: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("iikoEndpointStates").withIndex("by_endpoint_key", (q) => q.eq("endpointKey", args.endpointKey)).unique()
    const value = { endpointKey: args.endpointKey, lastStatus: args.status, lastRunAt: Date.now(), message: args.message }
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert("iikoEndpointStates", value)
  },
})

// --- Master-data import — GET-only source, never writes back to iiko ----------------------

/**
 * Upserts one department into the read-only mirror, and — only when its content actually
 * changed (payloadHash differs from the last import) — projects it into the canonical
 * organizations/restaurants tables that the rest of the app reads from. JURPERSON rows become
 * organizations; DEPARTMENT rows become restaurants.
 */
const departmentArgs = {
  externalId: v.string(),
  parentExternalId: v.optional(v.string()),
  code: v.optional(v.string()),
  name: v.string(),
  type: v.string(),
  payloadHash: v.string(),
}

const employeeArgs = {
  externalId: v.string(),
  code: v.optional(v.string()),
  displayName: v.string(),
  mainRoleCode: v.optional(v.string()),
  departmentCodes: v.array(v.string()),
  active: v.boolean(),
  payloadHash: v.string(),
}

async function applyDepartment(ctx: any, args: any) {
  const mirrorKey = `departments:${args.externalId}`
  const existingMirror = await ctx.db.query("iikoMirrorRecords").withIndex("by_mirror_key", (q: any) => q.eq("mirrorKey", mirrorKey)).unique()
  if (existingMirror && existingMirror.payloadHash === args.payloadHash) return { changed: false }

  const now = Date.now()
  const existingDept = await ctx.db.query("iikoDepartments").withIndex("by_external_id", (q: any) => q.eq("externalId", args.externalId)).unique()
  const deptValue = { externalId: args.externalId, parentExternalId: args.parentExternalId, code: args.code, name: args.name, type: args.type, sourceHash: args.payloadHash, importedAt: now }
  if (existingDept) await ctx.db.patch(existingDept._id, deptValue)
  else await ctx.db.insert("iikoDepartments", deptValue)

  if (args.type === "JURPERSON") {
    const existingOrg = await ctx.db.query("organizations").withIndex("by_external_id", (q: any) => q.eq("externalId", args.externalId)).unique()
    const orgValue = { externalId: args.externalId, name: args.name, currency: "KZT", timezone: "Asia/Almaty", active: true, sourceSystem: "iiko-server", sourceHash: args.payloadHash, importedAt: now }
    if (existingOrg) await ctx.db.patch(existingOrg._id, orgValue)
    else await ctx.db.insert("organizations", orgValue)
  } else if (args.type === "DEPARTMENT") {
    const existingRestaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q: any) => q.eq("externalId", args.externalId)).unique()
    const restaurantValue = {
      externalId: args.externalId,
      organizationExternalId: args.parentExternalId ?? "",
      name: args.name,
      address: args.name,
      timezone: "Asia/Almaty",
      active: true,
      sourceSystem: "iiko-server",
      sourceHash: args.payloadHash,
      importedAt: now,
    }
    if (existingRestaurant) await ctx.db.patch(existingRestaurant._id, restaurantValue)
    else await ctx.db.insert("restaurants", restaurantValue)
  }

  if (existingMirror) await ctx.db.patch(existingMirror._id, { payloadHash: args.payloadHash, importedAt: now })
  else await ctx.db.insert("iikoMirrorRecords", { mirrorKey, endpointKey: "corporation/departments", recordExternalId: args.externalId, payloadHash: args.payloadHash, importedAt: now })
  return { changed: true }
}

/**
 * Upserts one employee into the read-only mirror only. Never touches the canonical `employees`
 * (POS login) table — that only happens via provisionPosAccess, deliberately, so an iiko sync
 * can never silently create or change a cashier's login credential.
 */
async function applyEmployee(ctx: any, args: any) {
  const mirrorKey = `employees:${args.externalId}`
  const existingMirror = await ctx.db.query("iikoMirrorRecords").withIndex("by_mirror_key", (q: any) => q.eq("mirrorKey", mirrorKey)).unique()
  if (existingMirror && existingMirror.payloadHash === args.payloadHash) return { changed: false }

  const now = Date.now()
  const existing = await ctx.db.query("iikoEmployees").withIndex("by_external_id", (q: any) => q.eq("externalId", args.externalId)).unique()
  const value = {
    externalId: args.externalId,
    code: args.code,
    displayName: args.displayName,
    mainRoleCode: args.mainRoleCode,
    departmentCodes: args.departmentCodes,
    active: args.active,
    sourceHash: args.payloadHash,
    importedAt: now,
  }
  if (existing) await ctx.db.patch(existing._id, value)
  else await ctx.db.insert("iikoEmployees", value)

  if (existingMirror) await ctx.db.patch(existingMirror._id, { payloadHash: args.payloadHash, importedAt: now })
  else await ctx.db.insert("iikoMirrorRecords", { mirrorKey, endpointKey: "employees", recordExternalId: args.externalId, payloadHash: args.payloadHash, importedAt: now })
  return { changed: true }
}

export const upsertDepartment = internalMutation({ args: departmentArgs, handler: applyDepartment })
export const upsertEmployee = internalMutation({ args: employeeArgs, handler: applyEmployee })

/**
 * Single-call import — the Node script uses this instead of one `npx convex run` per record. Stock
 * master data (W1-IIKO-03) is optional; skipped records are counted and reported on their endpoint.
 */
export const importBatch = internalMutation({
  args: {
    departments: v.array(v.object(departmentArgs)),
    employees: v.array(v.object(employeeArgs)),
    warehouses: v.optional(v.array(v.object(warehouseArgs))),
    terminals: v.optional(v.array(v.object(terminalArgs))),
    units: v.optional(v.array(v.object(unitArgs))),
    suppliers: v.optional(v.array(v.object(supplierArgs))),
  },
  handler: async (ctx, args) => {
    let departmentsChanged = 0
    let employeesChanged = 0
    for (const department of args.departments) {
      const result = await applyDepartment(ctx, department)
      if (result.changed) departmentsChanged += 1
    }
    for (const employee of args.employees) {
      const result = await applyEmployee(ctx, employee)
      if (result.changed) employeesChanged += 1
    }
    const changed: Record<string, number> = {}
    const skipped: Record<string, string[]> = {}
    const run = async <T,>(endpointKey: string, rows: T[] | undefined, apply: (row: T) => Promise<{ changed: boolean; skipped?: string }>) => {
      if (!rows?.length) return
      changed[endpointKey] = 0
      for (const row of rows) {
        const result = await apply(row)
        if (result.changed) changed[endpointKey] += 1
        if (result.skipped) (skipped[endpointKey] ??= []).push(result.skipped)
      }
      const list = skipped[endpointKey] ?? []
      const existing = await ctx.db.query("iikoEndpointStates").withIndex("by_endpoint_key", (q) => q.eq("endpointKey", endpointKey)).unique()
      const state = { endpointKey, lastStatus: "ok" as const, lastRunAt: Date.now(), classification: "mirrored" as const, method: "GET", recordCount: rows.length, message: list.length ? `Пропущено ${list.length}: ${list.slice(0, 5).join("; ")}` : undefined }
      if (existing) await ctx.db.patch(existing._id, state)
      else await ctx.db.insert("iikoEndpointStates", state)
    }
    await run("corporation/stores", args.warehouses, (row) => applyWarehouse(ctx, row))
    await run("corporation/terminals", args.terminals, (row) => applyTerminal(ctx, row))
    await run("v2/entities/list?rootType=MeasureUnit", args.units, (row) => applyUnit(ctx, row))
    await run("suppliers", args.suppliers, (row) => applySupplier(ctx, row))
    return { departments: args.departments.length, employees: args.employees.length, departmentsChanged, employeesChanged, changed, skipped }
  },
})

// provisionPosAccess moved to domains/workforce/mutations.ts (office-gated, audited, and
// restaurant-scope-checked) — this domain stays narrowly about read-only sync.
