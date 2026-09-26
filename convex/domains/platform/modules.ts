import { ConvexError } from "convex/values"
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../../_generated/dataModel"
import { isOrganizationScope, organizationScopeId, ORGANIZATION_SCOPE_PREFIX, type SaveDomainRecordArgs, type TransitionHooks } from "../../lib/domainRecords"
import { writeOfficeAudit } from "../../lib/officeAccess"
import { formatTemplateError, MAX_COPIES, PRINT_DOCUMENT_TYPES, PRINT_LANGUAGES, PRINT_WIDTHS, validatePrintTemplate, type PrintDocumentType } from "../../lib/printTemplate"
import { parseSettingValue, settingDefinition, settingLookupKey, SETTING_SCOPES, type SettingScope } from "../../lib/settings"
import type { PlatformModuleId } from "./validators"

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>
type Data = SaveDomainRecordArgs["data"]
type PlatformRecord = Doc<"platformRecords">

// Module rules on top of the domain-record engine for print templates, equipment and system settings
// (W3-ADM-10…12): what each module's data must hold, the lookup key it is found by, and publishing
// one version of a template or setting retiring the one it replaces.

const text = (data: Data, key: string) => (typeof data[key] === "string" ? (data[key] as string).trim() : "")

export const EQUIPMENT_TYPES = ["receipt-printer", "kitchen-printer", "fiscal-register", "scale", "kds", "payment-terminal"] as const
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number]
/** Devices a kitchen station can print or show on (routing targets and sources). */
export const ROUTING_DEVICES: readonly EquipmentType[] = ["receipt-printer", "kitchen-printer", "kds"]
/** The equipment record itself as a routing target (a new record has no externalId yet). */
export const SELF_TARGET = "self"
const MAX_ROUTING_RULES = 30

async function terminalOf(ctx: QueryCtx, terminalExternalId: string) {
  const terminal = await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", terminalExternalId)).unique()
  if (!terminal) throw new ConvexError("Терминал не найден")
  const restaurant = await ctx.db.get(terminal.restaurantId)
  return { terminal, restaurantExternalId: restaurant?.externalId }
}

/** Checks and normalises a record before save; returns the fields to store (lookupKey, routing, name). */
export async function validatePlatformRecord(ctx: QueryCtx, moduleId: PlatformModuleId, args: SaveDomainRecordArgs): Promise<Partial<SaveDomainRecordArgs>> {
  const organizationLevel = isOrganizationScope(args.restaurantExternalId)
  switch (moduleId) {
    case "print-templates": {
      const documentType = text(args.data, "documentType") as PrintDocumentType
      if (!PRINT_DOCUMENT_TYPES.includes(documentType)) throw new ConvexError("Укажите тип документа")
      if (!(PRINT_LANGUAGES as readonly string[]).includes(text(args.data, "language"))) throw new ConvexError("Укажите язык: ru, kk или en")
      const copies = args.data.copies
      if (!(typeof copies === "number" && Number.isInteger(copies) && copies >= 1 && copies <= MAX_COPIES)) throw new ConvexError(`Копий — от 1 до ${MAX_COPIES}`)
      if (!(PRINT_WIDTHS as readonly unknown[]).includes(args.data.widthMm)) throw new ConvexError("Ширина ленты — 58 или 80 мм")
      const template = typeof args.data.template === "string" ? args.data.template : ""
      const errors = validatePrintTemplate(template, documentType)
      if (errors.length) throw new ConvexError(errors.slice(0, 3).map(formatTemplateError).join("; "))
      return { amount: 0, lookupKey: `${documentType}|${args.restaurantExternalId}`, routing: undefined }
    }
    case "equipment": {
      if (organizationLevel) throw new ConvexError("Оборудование привязывается к ресторану")
      const type = text(args.data, "type") as EquipmentType
      if (!EQUIPMENT_TYPES.includes(type)) throw new ConvexError("Укажите тип оборудования")
      for (const [key, label, max] of [["serial", "Серийный номер", 60], ["driver", "Драйвер / протокол", 60], ["endpoint", "Адрес / порт", 200]] as const) {
        if (text(args.data, key).length > max) throw new ConvexError(`${label} — не длиннее ${max} символов`)
      }
      if (/\s/.test(text(args.data, "endpoint"))) throw new ConvexError("Адрес / порт — без пробелов, например 192.168.1.50:9100")
      const terminalExternalId = text(args.data, "terminalExternalId")
      if (terminalExternalId) {
        const { restaurantExternalId } = await terminalOf(ctx, terminalExternalId)
        if (restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Терминал относится к другому ресторану")
      }
      const routing = (args.routing ?? []).map((rule) => ({ station: rule.station.trim(), printerExternalId: rule.printerExternalId.trim() }))
      if (routing.length && !ROUTING_DEVICES.includes(type)) throw new ConvexError("Маршрутизация печати — только у принтеров и экранов кухни")
      if (routing.length > MAX_ROUTING_RULES) throw new ConvexError(`Не больше ${MAX_ROUTING_RULES} правил маршрутизации`)
      const stations = new Set<string>()
      for (const rule of routing) {
        if (!rule.station || rule.station.length > 40) throw new ConvexError("Укажите станцию (до 40 символов)")
        if (stations.has(rule.station)) throw new ConvexError(`Станция «${rule.station}» указана дважды`)
        stations.add(rule.station)
        if (rule.printerExternalId === SELF_TARGET || rule.printerExternalId === args.externalId) continue
        const printer = await ctx.db.query("platformRecords").withIndex("by_external_id", (q) => q.eq("externalId", rule.printerExternalId)).unique()
        if (!printer || printer.moduleId !== "equipment" || printer.status !== "active" || !ROUTING_DEVICES.includes(printer.data.type as EquipmentType)) throw new ConvexError("Принтер маршрутизации не найден или отключён")
        if (printer.restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Принтер маршрутизации — из другого ресторана")
      }
      return { amount: 0, lookupKey: terminalExternalId ? `terminal|${terminalExternalId}` : undefined, routing }
    }
    case "system-settings": {
      const key = text(args.data, "key")
      const definition = settingDefinition(key)
      const scope = text(args.data, "scope") as SettingScope
      if (!SETTING_SCOPES.includes(scope)) throw new ConvexError("Укажите область: организация, ресторан или терминал")
      if (!definition.scopes.includes(scope)) throw new ConvexError(`«${definition.label}» задаётся только для: ${definition.scopes.map((item) => ({ organization: "организации", restaurant: "ресторана", terminal: "терминала" })[item]).join(", ")}`)
      const scopeExternalId = text(args.data, "scopeExternalId")
      if (!scopeExternalId) throw new ConvexError("Выберите объект области")
      if (scope === "organization" && args.restaurantExternalId !== organizationScopeId(scopeExternalId)) throw new ConvexError("Настройка организации хранится на уровне организации")
      if (scope === "restaurant" && args.restaurantExternalId !== scopeExternalId) throw new ConvexError("Ресторан настройки не совпадает с областью")
      if (scope === "terminal") {
        const { restaurantExternalId } = await terminalOf(ctx, scopeExternalId)
        if (organizationLevel || restaurantExternalId !== args.restaurantExternalId) throw new ConvexError("Терминал относится к другому ресторану")
      }
      const { stored } = parseSettingValue(key, args.data.value)
      Object.assign(args.data, { category: definition.category, valueType: definition.valueType, value: stored })
      return { amount: 0, name: definition.label, lookupKey: settingLookupKey(key, scope, scopeExternalId), routing: undefined }
    }
  }
}

/**
 * Publishing a template or a setting: the value is checked again (the rules may have changed since the
 * draft), and the published version with the same lookup key goes to «Неактивно» — one live version,
 * the old one can be published again to roll back.
 */
export function platformHooks(ctx: MutationCtx, moduleId: PlatformModuleId, actorEmail: string): TransitionHooks<"platformRecords"> {
  if (moduleId === "equipment") return {}
  return {
    beforePublish: async (record) => {
      if (moduleId === "system-settings") parseSettingValue(text(record.data, "key"), record.data.value)
      else {
        const errors = validatePrintTemplate(typeof record.data.template === "string" ? record.data.template : "", text(record.data, "documentType") as PrintDocumentType)
        if (errors.length) throw new ConvexError(errors.slice(0, 3).map(formatTemplateError).join("; "))
      }
    },
    afterPublish: async (record) => {
      if (!record.lookupKey) return
      const live = await ctx.db.query("platformRecords").withIndex("by_module_lookup_status", (q) => q.eq("moduleId", moduleId).eq("lookupKey", record.lookupKey).eq("status", "published")).take(20)
      for (const previous of live) {
        if (previous._id === record._id) continue
        await ctx.db.patch(previous._id, { status: "inactive", version: previous.version + 1, updatedAt: Date.now() })
        await writeOfficeAudit(ctx, actorEmail, {
          action: `${moduleId}.deactivate`,
          summary: `${previous.number}: заменена версией ${record.number}`,
          resourceType: moduleId,
          resourceExternalId: previous.externalId,
          ...(isOrganizationScope(previous.restaurantExternalId) ? {} : { restaurantExternalId: previous.restaurantExternalId }),
          capability: `office.${moduleId}.edit`,
          details: { from: "published", to: "inactive", replacedBy: record.externalId },
        })
      }
    },
  }
}

/** The organization of an organization-level scope id. */
export function organizationOfScope(restaurantExternalId: string) {
  return isOrganizationScope(restaurantExternalId) ? restaurantExternalId.slice(ORGANIZATION_SCOPE_PREFIX.length) : null
}

export type { PlatformRecord }
