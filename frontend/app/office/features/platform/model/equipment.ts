import { almatyBusinessDate } from "@/shared/lib/almaty-time"

import type { PlatformRecord, RoutingRule, SavePlatformRecordArgs } from "../data/use-platform-records"

// The «Оборудование» card (W3-ADM-11): device types, the draft and the same checks as
// convex/domains/platform/modules.ts (the server checks again).

export type EquipmentType = "receipt-printer" | "kitchen-printer" | "fiscal-register" | "scale" | "kds" | "payment-terminal"

export const EQUIPMENT_TYPE_LABELS: Record<EquipmentType, string> = {
  "receipt-printer": "Принтер чеков",
  "kitchen-printer": "Кухонный принтер",
  "fiscal-register": "ККМ",
  scale: "Весы",
  kds: "Экран кухни",
  "payment-terminal": "Платёжный терминал",
}

/** Devices a kitchen station prints or shows on. */
export const ROUTING_DEVICES: EquipmentType[] = ["receipt-printer", "kitchen-printer", "kds"]
export const SELF_TARGET = "self"
export const NO_TERMINAL = "none"

export interface EquipmentDraft {
  name: string
  restaurantExternalId: string
  type: EquipmentType
  serial: string
  driver: string
  endpoint: string
  terminalExternalId: string
  routing: RoutingRule[]
}

const text = (value: unknown) => (typeof value === "string" ? value : "")

export function equipmentDraftOf(record: PlatformRecord | null, restaurantExternalId: string): EquipmentDraft {
  const type = text(record?.data.type) as EquipmentType
  return {
    name: record?.name ?? "",
    restaurantExternalId: record?.restaurantExternalId ?? restaurantExternalId,
    type: EQUIPMENT_TYPE_LABELS[type] ? type : "kitchen-printer",
    serial: text(record?.data.serial),
    driver: text(record?.data.driver) || (record ? "" : "ESC/POS"),
    endpoint: text(record?.data.endpoint),
    terminalExternalId: text(record?.data.terminalExternalId),
    routing: record?.routing?.map((rule) => ({ ...rule })) ?? [],
  }
}

export type EquipmentErrors = Partial<Record<keyof EquipmentDraft, string>> & { routingRows?: Record<number, string> }

export function validateEquipment(draft: EquipmentDraft): EquipmentErrors {
  const errors: EquipmentErrors = {}
  if (!draft.name.trim()) errors.name = "Укажите название"
  if (!draft.restaurantExternalId) errors.restaurantExternalId = "Выберите ресторан"
  if (/\s/.test(draft.endpoint.trim())) errors.endpoint = "Без пробелов, например 192.168.1.50:9100"
  const rows: Record<number, string> = {}
  const seen = new Set<string>()
  draft.routing.forEach((rule, index) => {
    const station = rule.station.trim()
    if (!station) rows[index] = "Укажите станцию"
    else if (seen.has(station)) rows[index] = "Станция указана дважды"
    else if (!rule.printerExternalId) rows[index] = "Выберите принтер"
    seen.add(station)
  })
  if (Object.keys(rows).length) errors.routingRows = rows
  return errors
}

export function equipmentSaveArgs(draft: EquipmentDraft, record: PlatformRecord | null): SavePlatformRecordArgs {
  const routes = ROUTING_DEVICES.includes(draft.type)
  return {
    moduleId: "equipment",
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    name: draft.name.trim(),
    restaurantExternalId: draft.restaurantExternalId,
    businessDate: record?.businessDate ?? almatyBusinessDate(Date.now()),
    data: { type: draft.type, serial: draft.serial.trim(), driver: draft.driver.trim(), endpoint: draft.endpoint.trim(), terminalExternalId: draft.terminalExternalId },
    routing: routes ? draft.routing.map((rule) => ({ station: rule.station.trim(), printerExternalId: rule.printerExternalId })) : [],
  }
}
