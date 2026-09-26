import { v } from "convex/values"

import type { Lifecycle } from "../../lib/lifecycles"

// Platform modules stored in platformRecords (W3-ADM-10…12, §3.0 p. 10): print templates, equipment and
// system settings. Organizations, restaurants, terminals and period locks stay in their own tables.
export const PLATFORM_MODULES = {
  "print-templates": { lifecycle: "publish", prefix: "ШП", label: "Шаблон печати" },
  equipment: { lifecycle: "master", prefix: "ОБР", label: "Оборудование" },
  "system-settings": { lifecycle: "publish", prefix: "НС", label: "Настройка системы" },
} as const satisfies Record<string, { lifecycle: Lifecycle; prefix: string; label: string }>

export type PlatformModuleId = keyof typeof PLATFORM_MODULES

export const platformModuleId = v.union(v.literal("print-templates"), v.literal("equipment"), v.literal("system-settings"))

/** Flat scalar fields of a module (not v.any()); long text (a template, a JSON value) is a string. */
export const platformRecordData = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))

/** Equipment: which kitchen station prints on which printer (W3-ADM-11). */
export const printRoutingRule = v.object({ station: v.string(), printerExternalId: v.string() })
