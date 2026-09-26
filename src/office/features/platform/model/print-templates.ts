import { almatyBusinessDate } from "@/shared/lib/almaty-time"

import { MAX_COPIES, PRINT_DOCUMENT_LABELS, PRINT_DOCUMENT_TYPES, PRINT_LANGUAGES, SANDYQ_PRINT_TEMPLATES, validatePrintTemplate, type PrintDocumentType, type PrintLanguage } from "../../../../../convex/lib/printTemplate"
import type { PlatformRecord, SavePlatformRecordArgs } from "../data/use-platform-records"

// The «Шаблон печати» card (W3-ADM-10): draft ⇄ record, the office-side checks (the same renderer as the
// server, so a typo never reaches it) and the first text of a new template.

export interface PrintTemplateDraft {
  name: string
  restaurantExternalId: string
  documentType: PrintDocumentType
  language: PrintLanguage
  copies: string
  widthMm: 58 | 80
  template: string
}

const STARTERS: Record<PrintDocumentType, string> = {
  ...(Object.fromEntries(SANDYQ_PRINT_TEMPLATES.map((seed) => [seed.documentType, seed.template])) as Partial<Record<PrintDocumentType, string>>),
  kitchen: `[center][bold]{{station.name}}
[center][large]Заказ №{{order.number}}
[center]{{order.table}} · {{order.type}}
---
{{#lines}}
[bold]{{quantity}} × {{name}}
[small]   {{details}}
{{/lines}}
{{#order.comment}}
[box]{{order.comment}}
{{/order.comment}}
---
[small]{{order.createdAt}} · {{cashier.name}}`,
  label: `[center][bold]{{product.name}}
[center]{{product.weight}}
---
[small]Состав: {{product.composition}}
Изготовлено || {{product.madeAt}}
[bold]Годен до || {{product.expiresAt}}
[center][small]{{restaurant.name}}`,
  invoice: `[center][small]{{organization.name}}
[center][bold]{{document.title}} {{document.number}}
[center]{{document.date}}
---
Контрагент || {{counterparty.name}}
Склад || {{warehouse.name}}
---
{{#lines}}
{{name}} || {{amount}}
[small]   {{quantity}} {{unit}} × {{price}}
{{/lines}}
[total]ИТОГО || {{totals.total}}`,
  report: `[center][bold]{{report.title}}
[center]{{restaurant.name}}
[center][small]{{report.period}}
---
{{#rows}}
{{label}} || {{value}}
{{/rows}}
---
[small]Сформирован {{report.generatedAt}}`,
} as Record<PrintDocumentType, string>

export const starterTemplate = (documentType: PrintDocumentType) => STARTERS[documentType]

const text = (value: unknown) => (typeof value === "string" ? value : "")

export function printTemplateDraftOf(record: PlatformRecord | null, restaurantExternalId: string): PrintTemplateDraft {
  const documentType = (PRINT_DOCUMENT_TYPES as readonly string[]).includes(text(record?.data.documentType)) ? (record!.data.documentType as PrintDocumentType) : "receipt"
  return {
    name: record?.name ?? "",
    restaurantExternalId: record?.restaurantExternalId ?? restaurantExternalId,
    documentType,
    language: (PRINT_LANGUAGES as readonly string[]).includes(text(record?.data.language)) ? (record!.data.language as PrintLanguage) : "ru",
    copies: String(typeof record?.data.copies === "number" ? record.data.copies : 1),
    widthMm: record?.data.widthMm === 58 ? 58 : 80,
    template: record ? text(record.data.template) : starterTemplate(documentType),
  }
}

/** «Новая версия» of a published or inactive template: the same fields in a new draft. */
export function nextVersionDraft(record: PlatformRecord): PrintTemplateDraft {
  const draft = printTemplateDraftOf(record, record.restaurantExternalId)
  return { ...draft, name: /\(новая версия\)$/.test(draft.name) ? draft.name : `${draft.name} (новая версия)` }
}

export type DraftErrors<K extends string> = Partial<Record<K, string>>

export function validatePrintTemplateDraft(draft: PrintTemplateDraft): DraftErrors<keyof PrintTemplateDraft> {
  const errors: DraftErrors<keyof PrintTemplateDraft> = {}
  if (!draft.name.trim()) errors.name = "Укажите название шаблона"
  if (!draft.restaurantExternalId) errors.restaurantExternalId = "Выберите область"
  const copies = Number(draft.copies)
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) errors.copies = `От 1 до ${MAX_COPIES}`
  const templateErrors = validatePrintTemplate(draft.template, draft.documentType)
  if (templateErrors.length) errors.template = `Исправьте ошибки шаблона: ${templateErrors.length}`
  return errors
}

export function printTemplateSaveArgs(draft: PrintTemplateDraft, record: PlatformRecord | null): SavePlatformRecordArgs {
  return {
    moduleId: "print-templates",
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    name: draft.name.trim(),
    restaurantExternalId: draft.restaurantExternalId,
    businessDate: record?.businessDate ?? almatyBusinessDate(Date.now()),
    data: { documentType: draft.documentType, language: draft.language, copies: Number(draft.copies), widthMm: draft.widthMm, template: draft.template },
  }
}

export const DOCUMENT_TYPE_OPTIONS = PRINT_DOCUMENT_TYPES.map((value) => ({ value, label: PRINT_DOCUMENT_LABELS[value] }))
