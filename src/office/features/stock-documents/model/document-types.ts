import type { FunctionArgs } from "convex/server"

import { api } from "../../../../../convex/_generated/api"

// Stock document kinds (W1-STK-09, W2-STK-13): one register and one editor, configured per type.
// Prefixes and module ids mirror convex/lib/stockPosting.ts DOCUMENT_MODULES.

export type StockDocumentType = FunctionArgs<typeof api.domains.stockDocuments.queries.listDocuments>["type"]
export type DocumentStatus = "draft" | "posted" | "reversed"

export interface DocumentTypeConfig {
  type: StockDocumentType
  /** URL section and right prefix: office.<section>.view|edit|post|reverse. */
  section: string
  title: string
  description: string
  /** «Инвентаризация ИНВ-00001». */
  entityLabel: string
  sourceLabel: string
  /** Transfer: the destination warehouse. */
  destination: boolean
  /** Supplier return: the supplier is required. */
  supplier: boolean
  /** Outgoing invoice: «Покупатель / получатель» — a FIN counterparty or free text. */
  counterparty: boolean
  /** Outgoing invoice: «Цена продажи» per line (with VAT) — the buyer's receivable (W2-STK-13). */
  salePrice: boolean
  /** Supplier return: «На основании прихода» — a posted receipt of this supplier and warehouse. */
  basedOnReceipt: boolean
  /** Inventory: «По учёту» and «Факт» instead of «Количество». */
  inventory: boolean
  vat: boolean
  reasonRequired: boolean
}

const base = { destination: false, supplier: false, counterparty: false, salePrice: false, basedOnReceipt: false, inventory: false, vat: false, reasonRequired: false, sourceLabel: "Склад" }

export const DOCUMENT_TYPES: Record<StockDocumentType, DocumentTypeConfig> = {
  inventory: {
    ...base,
    type: "inventory",
    section: "inventories",
    title: "Инвентаризации",
    description: "Фактический пересчёт и проведение только выявленных расхождений.",
    entityLabel: "Инвентаризация",
    inventory: true,
  },
  transfer: {
    ...base,
    type: "transfer",
    section: "transfers",
    title: "Внутренние перемещения",
    description: "Атомарное движение между складами с сохранением себестоимости.",
    entityLabel: "Внутреннее перемещение",
    sourceLabel: "Склад-отправитель",
    destination: true,
  },
  writeoff: {
    ...base,
    type: "writeoff",
    section: "writeoffs",
    title: "Акты списания",
    description: "Порча, недостача и иные расходы со склада.",
    entityLabel: "Акт списания",
    reasonRequired: true,
  },
  "outgoing-invoice": {
    ...base,
    type: "outgoing-invoice",
    section: "outgoing-invoices",
    title: "Расходные накладные",
    description: "Продажа или передача продукции со склада получателю.",
    entityLabel: "Расходная накладная",
    counterparty: true,
    salePrice: true,
    vat: true,
  },
  "supplier-return": {
    ...base,
    type: "supplier-return",
    section: "supplier-returns",
    title: "Возвраты поставщикам",
    description: "Возврат поставки с уменьшением остатка и задолженности.",
    entityLabel: "Возврат поставщику",
    supplier: true,
    basedOnReceipt: true,
    vat: true,
  },
}

export const STATUS_TABS: { value: "all" | DocumentStatus; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновики" },
  { value: "posted", label: "Проведённые" },
  { value: "reversed", label: "Сторно" },
]

export const VAT_OPTIONS = [
  { value: "0", label: "Без НДС" },
  { value: "12", label: "12 %" },
]
