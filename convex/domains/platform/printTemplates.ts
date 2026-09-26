import { ConvexError, v } from "convex/values"

import { internalMutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import { getDomainRecord, organizationScopeId } from "../../lib/domainRecords"
import { nextNumber } from "../../lib/numbering"
import { requireOfficeCapability } from "../../lib/officeAccess"
import { formatTemplateError, PRINT_DOCUMENT_TYPES, PRINT_SAMPLES, renderPrintTemplate as render, SANDYQ_PRINT_TEMPLATES, type PrintDocumentType } from "../../lib/printTemplate"
import { almatyBusinessDate } from "../../lib/time"

// «Шаблоны печати» (W3-ADM-10): the preview render on demo data, the published template a print form
// uses (restaurant first, then the organization), and the Sandyq seed templates (POS-DESIGN §6.6).

const documentType = v.union(...PRINT_DOCUMENT_TYPES.map((type) => v.literal(type)))

/** The preview: a saved template (by externalId) or a draft from the editor, rendered on demo data. */
export const renderPrintTemplate = query({
  args: { externalId: v.optional(v.string()), draftTemplate: v.optional(v.string()), documentType: v.optional(documentType) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.print-templates.view")
    let template = args.draftTemplate
    let type = args.documentType
    let widthMm = 80
    if (args.externalId) {
      const record = await getDomainRecord(ctx, "platformRecords", user, "print-templates", args.externalId)
      if (!record) throw new ConvexError("Шаблон не найден")
      template = typeof record.data.template === "string" ? record.data.template : ""
      type = record.data.documentType as PrintDocumentType
      widthMm = record.data.widthMm === 58 ? 58 : 80
    }
    if (template === undefined || !type) throw new ConvexError("Передайте шаблон и тип документа")
    const { lines, errors } = render(template, type, PRINT_SAMPLES[type])
    return { lines, errors: errors.map(formatTemplateError), widthMm }
  },
})

export type ActivePrintTemplate = { externalId: string; number: string; name: string; template: string; widthMm: 58 | 80; copies: number; language: string }

/** The published template of a document type for a restaurant: its own, else its organization's; null — the built-in form. */
export async function activePrintTemplate(ctx: QueryCtx, type: PrintDocumentType, restaurant: { externalId: string; organizationExternalId: string }): Promise<ActivePrintTemplate | null> {
  for (const scope of [restaurant.externalId, organizationScopeId(restaurant.organizationExternalId)]) {
    const row = await ctx.db
      .query("platformRecords")
      .withIndex("by_module_lookup_status", (q) => q.eq("moduleId", "print-templates").eq("lookupKey", `${type}|${scope}`).eq("status", "published"))
      .order("desc")
      .first()
    if (!row || typeof row.data.template !== "string") continue
    return {
      externalId: row.externalId,
      number: row.number,
      name: row.name,
      template: row.data.template,
      widthMm: row.data.widthMm === 58 ? 58 : 80,
      copies: typeof row.data.copies === "number" ? Math.min(Math.max(1, Math.round(row.data.copies)), 5) : 1,
      language: typeof row.data.language === "string" ? row.data.language : "ru",
    }
  }
  return null
}

/**
 * Sandyq templates for the check, pre-check, X and Z (published, organization-wide) for every organization
 * with a restaurant. Idempotent: a template already seeded — or edited since — is left alone.
 */
export async function seedPrintTemplateRows(ctx: MutationCtx, dryRun = false) {
  const organizations = await ctx.db.query("organizations").take(20)
  const restaurants = await ctx.db.query("restaurants").withIndex("by_active_and_name", (q) => q.eq("active", true)).take(200)
  let created = 0
  let existing = 0
  const businessDate = almatyBusinessDate(Date.now())
  for (const organization of organizations) {
    if (!restaurants.some((restaurant) => restaurant.organizationExternalId === organization.externalId)) continue
    for (const seed of SANDYQ_PRINT_TEMPLATES) {
      const externalId = `print-templates-${organization.externalId}-${seed.documentType}`
      if (await ctx.db.query("platformRecords").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()) {
        existing += 1
        continue
      }
      created += 1
      if (dryRun) continue
      const now = Date.now()
      const number = await nextNumber(ctx, { moduleId: "print-templates", prefix: "ШП", organizationExternalId: organization.externalId, businessDate })
      await ctx.db.insert("platformRecords", {
        externalId,
        moduleId: "print-templates",
        number,
        name: seed.name,
        status: "published",
        organizationExternalId: organization.externalId,
        restaurantExternalId: organizationScopeId(organization.externalId),
        businessDate,
        amount: 0,
        data: { documentType: seed.documentType, language: "ru", copies: 1, widthMm: 80, template: seed.template },
        lookupKey: `${seed.documentType}|${organizationScopeId(organization.externalId)}`,
        searchText: [number, seed.name, seed.documentType, "ru"].join(" ").toLocaleLowerCase("ru"),
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
    }
  }
  return { created, existing, dryRun }
}

export const seedSandyqTemplates = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => seedPrintTemplateRows(ctx, args.dryRun ?? false),
})
