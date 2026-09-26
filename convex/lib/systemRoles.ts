import { ConvexError } from "convex/values"
import type { GenericMutationCtx } from "convex/server"

import type { DataModel } from "../_generated/dataModel"
import { CAPABILITY_CATALOG } from "./capabilities"

type MutationCtx = GenericMutationCtx<DataModel>

/** Every allowed action of each section, expanded through the catalog (not whole `office.x.*`). */
function sectionRights(sections: string[], only?: "view") {
  return sections.flatMap((id) => {
    const section = CAPABILITY_CATALOG.find((candidate) => candidate.id === id)
    if (!section) throw new ConvexError(`Неизвестный раздел ${id}`)
    return (only ? section.actions.filter((action) => action === only) : section.actions).map((action) => `office.${id}.${action}`)
  })
}

// The seven system roles (W1-ACL-03, module sets as in bahandi-pos office.ts).
export const SYSTEM_ROLES: { externalId: string; name: string; capabilities: string[] }[] = [
  { externalId: "administrator", name: "Администратор", capabilities: ["*"] },
  {
    externalId: "restaurant-manager",
    name: "Управляющий рестораном",
    capabilities: sectionRights([
      "dashboard", "orders", "cash-shifts", "payment-types", "order-types", "discount-types", "deletion-reasons", "cash-operations", "stock", "inventories", "writeoffs",
      "production", "kitchen-board", "processing-acts", "assembly-acts", "sales-acts", "purchase-orders", "internal-orders", "kitchen-plan", "semi-finished-sheet",
      "employees", "positions", "shift-types", "schedule", "attendance", "motivation", "medical-records", "guests", "loyalty-programs", "guest-categories", "campaigns",
      "reservations", "delivery-orders", "reports",
    ]),
  },
  {
    externalId: "accountant",
    name: "Бухгалтер",
    capabilities: sectionRights([
      "dashboard", "cashflow-categories", "chart-of-accounts", "transactions", "shift-acceptance", "services", "counterparties", "accounts-payable", "payments",
      "bank-statements", "payment-calendar", "budgets", "payroll", "reports", "report-schedules",
    ]),
  },
  {
    externalId: "warehouse-manager",
    name: "Заведующий складом",
    capabilities: sectionRights([
      "dashboard", "nomenclature", "product-groups", "modifiers", "size-scales", "price-orders", "price-lists", "warehouses", "stock", "receipts", "outgoing-invoices",
      "supplier-returns", "inventories", "transfers", "writeoffs", "suppliers", "units", "production", "kitchen-board", "processing-acts", "assembly-acts", "sales-acts",
      "purchase-orders", "internal-orders", "kitchen-plan", "semi-finished-sheet", "reports",
    ]),
  },
  { externalId: "hr-payroll", name: "HR и расчётчик", capabilities: sectionRights(["dashboard", "employees", "positions", "shift-types", "schedule", "attendance", "payroll", "motivation", "medical-records", "reports"]) },
  { externalId: "loyalty-manager", name: "CRM и лояльность", capabilities: sectionRights(["dashboard", "guests", "loyalty-programs", "guest-categories", "campaigns", "reservations", "reports"]) },
  { externalId: "report-viewer", name: "Аналитик", capabilities: sectionRights(["dashboard", "reports", "report-favorites"], "view") },
]

/**
 * Actions a section gained after the system roles were seeded (W3: motivation and the external menu are
 * published, medical records go through approval). A system role that already holds a right of the section
 * gets the new ones its defaults have; a section the office took away stays away.
 */
export const ADDED_SECTION_ACTIONS: Record<string, string[]> = {
  motivation: ["approve"],
  "medical-records": ["approve", "post", "reverse", "cancel"],
  "external-menu": ["approve"],
}

function addedRights(role: { externalId: string; capabilities: string[] }, existing: string[]) {
  const defaults = SYSTEM_ROLES.find((candidate) => candidate.externalId === role.externalId)?.capabilities ?? []
  const rights: string[] = []
  for (const [section, actions] of Object.entries(ADDED_SECTION_ACTIONS)) {
    if (!existing.some((right) => right.startsWith(`office.${section}.`))) continue
    for (const action of actions) {
      const right = `office.${section}.${action}`
      if (defaults.includes(right) && !existing.includes(right)) rights.push(right)
    }
  }
  return rights
}

/**
 * Idempotent upsert of the system roles. The administrator is always "*"; other system roles are
 * created with their default rights and then left alone, so an office edit of a system role survives —
 * except for the actions added to sections the role already has (ADDED_SECTION_ACTIONS).
 */
export async function upsertSystemRoles(ctx: MutationCtx, dryRun = false) {
  let created = 0
  let updated = 0
  for (const role of SYSTEM_ROLES) {
    const existing = await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", role.externalId)).unique()
    if (!existing) {
      created += 1
      if (!dryRun) await ctx.db.insert("officeRoles", { ...role, system: true })
    } else if (!existing.system || (role.externalId === "administrator" && !(existing.capabilities.length === 1 && existing.capabilities[0] === "*"))) {
      updated += 1
      if (!dryRun) await ctx.db.patch(existing._id, { system: true, ...(role.externalId === "administrator" ? { capabilities: ["*"] } : {}) })
    } else if (role.externalId !== "administrator") {
      const added = addedRights(role, existing.capabilities)
      if (added.length) {
        updated += 1
        if (!dryRun) await ctx.db.patch(existing._id, { capabilities: [...existing.capabilities, ...added] })
      }
    }
  }
  return { created, updated, total: SYSTEM_ROLES.length, dryRun }
}
