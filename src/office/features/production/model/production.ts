import type { FunctionArgs } from "convex/server"

import { api } from "../../../../../convex/_generated/api"

// «Производство и логистика» (W2-PRD-01…06): one register and one editor for the six document kinds of
// convex/domains/production/documents.ts, configured per type. Pure functions only — the server numbers,
// prices and posts; the client never computes a cost (B-17).

export type ProductionDocType = FunctionArgs<typeof api.domains.production.documents.listDocuments>["type"]
export type ProductionStatus = "draft" | "pending-approval" | "approved" | "posted" | "completed" | "reversed" | "cancelled"

/** document: draft → posted → reversed; approval: draft → pending-approval → approved → posted; purchase: … → approved → completed. */
export type Lifecycle = "document" | "approval" | "purchase"
/** What a line is: a preparation (production), a stock item, an item with «Вход / Выход», an item with the expected price. */
export type LineMode = "preparation" | "item" | "directional" | "purchase"

export interface ProductionTypeConfig {
  type: ProductionDocType
  /** URL section and rights: office.<section>.view|edit|post|approve|reverse|cancel. */
  section: string
  title: string
  entityLabel: string
  newLabel: string
  lifecycle: Lifecycle
  lineMode: LineMode
  sourceLabel: string | null
  destinationLabel: string | null
  supplier: boolean
  expectedDate: boolean
  concept: boolean
  /** Internal order: the warehouses may belong to different restaurants of one organization. */
  crossRestaurant: boolean
  searchPlaceholder: string
  linesTitle: string
}

const base = { supplier: false, expectedDate: false, concept: false, crossRestaurant: false, newLabel: "Новая запись", linesTitle: "Позиции" }

export const PRODUCTION_TYPES: Record<ProductionDocType, ProductionTypeConfig> = {
  production: {
    ...base,
    type: "production",
    section: "production",
    title: "Акты приготовления",
    entityLabel: "Акт приготовления",
    newLabel: "Новый акт",
    lifecycle: "document",
    lineMode: "preparation",
    sourceLabel: "Со склада · списать ингредиенты",
    destinationLabel: "На склад · оприходовать заготовку",
    concept: true,
    searchPlaceholder: "Номер, концепция или комментарий",
    linesTitle: "Заготовки",
  },
  processing: {
    ...base,
    type: "processing",
    section: "processing-acts",
    title: "Акты переработки",
    entityLabel: "Акт переработки",
    lifecycle: "document",
    lineMode: "directional",
    sourceLabel: "Со склада · сырьё",
    destinationLabel: "На склад · выход продукции",
    searchPlaceholder: "Поиск: акты переработки",
  },
  assembly: {
    ...base,
    type: "assembly",
    section: "assembly-acts",
    title: "Акты разбора",
    entityLabel: "Акт разбора",
    lifecycle: "document",
    lineMode: "directional",
    sourceLabel: "Со склада · что разбираем",
    destinationLabel: "На склад · составляющие",
    searchPlaceholder: "Поиск: акты разбора",
  },
  sales: {
    ...base,
    type: "sales",
    section: "sales-acts",
    title: "Акты реализации",
    entityLabel: "Акт реализации",
    lifecycle: "document",
    lineMode: "item",
    sourceLabel: "Со склада",
    destinationLabel: null,
    searchPlaceholder: "Поиск: акты реализации",
  },
  "internal-order": {
    ...base,
    type: "internal-order",
    section: "internal-orders",
    title: "Внутренние заказы",
    entityLabel: "Внутренний заказ",
    lifecycle: "approval",
    lineMode: "item",
    sourceLabel: "Откуда · склад-источник",
    destinationLabel: "Куда · склад назначения",
    crossRestaurant: true,
    searchPlaceholder: "Поиск: внутренние заказы",
  },
  "purchase-order": {
    ...base,
    type: "purchase-order",
    section: "purchase-orders",
    title: "Заказы поставщикам",
    entityLabel: "Заказ поставщику",
    lifecycle: "purchase",
    lineMode: "purchase",
    sourceLabel: null,
    destinationLabel: "Склад назначения",
    supplier: true,
    expectedDate: true,
    searchPlaceholder: "Поиск: заказы поставщикам",
  },
}

export type StatusTab = { value: "all" | ProductionStatus; label: string }

/** Lifecycle tabs of OFFICE-DESIGN §3.5 (instead of bahandi's same five everywhere). */
export const LIFECYCLE_TABS: Record<Lifecycle, StatusTab[]> = {
  document: [
    { value: "all", label: "Все" },
    { value: "draft", label: "Черновики" },
    { value: "posted", label: "Проведённые" },
    { value: "reversed", label: "Сторно" },
  ],
  approval: [
    { value: "all", label: "Все" },
    { value: "draft", label: "Черновики" },
    { value: "pending-approval", label: "На согласовании" },
    { value: "approved", label: "Согласованные" },
    { value: "posted", label: "Проведённые" },
  ],
  purchase: [
    { value: "all", label: "Все" },
    { value: "draft", label: "Черновики" },
    { value: "pending-approval", label: "На согласовании" },
    { value: "approved", label: "Согласованные" },
    { value: "completed", label: "Завершённые" },
  ],
}

export type DocAction = "save" | "submit" | "approve" | "post" | "cancel" | "reverse" | "create-receipt" | "open-receipt"

export const ACTION_LABELS: Record<DocAction, string> = {
  save: "Сохранить",
  submit: "Отправить на согласование",
  approve: "Согласовать",
  post: "Провести",
  cancel: "Отменить документ",
  reverse: "Сторнировать",
  "create-receipt": "Создать приходную накладную",
  "open-receipt": "Открыть приходную накладную",
}

/** The right each action needs; the server checks it again. */
export function actionCapability(config: Pick<ProductionTypeConfig, "section">, action: DocAction) {
  if (action === "create-receipt") return "office.receipts.edit"
  if (action === "open-receipt") return "office.receipts.view"
  if (action === "save" || action === "submit") return `office.${config.section}.edit`
  return `office.${config.section}.${action}`
}

export interface DocumentActions {
  /** One primary per screen (OFFICE-DESIGN §3.4). */
  primary: DocAction | null
  secondary: DocAction[]
  danger: DocAction[]
}

/**
 * Header buttons for a status: actions without the right are hidden, not disabled (OFFICE-DESIGN §7).
 * `saved` — the document exists on the server (a new one can't be cancelled yet).
 */
export function documentActions(
  config: Pick<ProductionTypeConfig, "section" | "lifecycle">,
  status: ProductionStatus,
  can: (capability: string) => boolean,
  options: { saved: boolean; receiptExternalId?: string | null },
): DocumentActions {
  const allowed = (action: DocAction) => can(actionCapability(config, action))
  const result: DocumentActions = { primary: null, secondary: [], danger: [] }
  const approval = config.lifecycle !== "document"
  const cancellable = options.saved && allowed("cancel")
  switch (status) {
    case "draft":
      if (approval ? allowed("submit") : allowed("post")) result.primary = approval ? "submit" : "post"
      if (allowed("save")) result.secondary.push("save")
      if (cancellable) result.danger.push("cancel")
      break
    case "pending-approval":
      if (allowed("approve")) result.primary = "approve"
      if (cancellable) result.danger.push("cancel")
      break
    case "approved":
      if (config.lifecycle === "purchase") {
        if (options.receiptExternalId) {
          if (allowed("open-receipt")) result.primary = "open-receipt"
        } else {
          if (allowed("create-receipt")) result.primary = "create-receipt"
          if (cancellable) result.danger.push("cancel")
        }
      } else {
        if (allowed("post")) result.primary = "post"
        if (cancellable) result.danger.push("cancel")
      }
      break
    case "posted":
      if (config.lifecycle !== "purchase" && allowed("reverse")) result.danger.push("reverse")
      break
    case "completed":
      if (options.receiptExternalId && allowed("open-receipt")) result.secondary.push("open-receipt")
      break
    default:
      break
  }
  // Without a primary (no post right) «Сохранить» takes its place.
  if (!result.primary && result.secondary[0] === "save") result.primary = result.secondary.shift()!
  return result
}

/** A draft is edited only by a user with the edit right; everything else is read-only (L-18). */
export function isReadOnly(status: ProductionStatus, canEdit: boolean) {
  return status !== "draft" || !canEdit
}

// ── saveDocument warnings (minimum order) ──────────────────────────────────────────────────────

/** Navigation state that carries the last save's warnings to the new document's URL. */
export interface SaveWarningsState {
  saveWarnings: string[]
}

export function saveWarningsState(warnings: readonly string[]): SaveWarningsState | null {
  return warnings.length ? { saveWarnings: [...warnings] } : null
}

/** Warnings passed by saveWarningsState (anything else — none). */
export function saveWarningsFromState(state: unknown): string[] {
  const value = state && typeof state === "object" ? (state as Partial<SaveWarningsState>).saveWarnings : undefined
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

/**
 * The last save's warnings stay until the next save — also after «Отправить на согласование» (the save
 * runs right before the submit); a closed or cancelled order no longer needs them.
 */
export function visibleSaveWarnings(status: ProductionStatus, warnings: readonly string[]): readonly string[] {
  return status === "draft" || status === "pending-approval" || status === "approved" ? warnings : []
}

export const WRITE_OFF_METHODS = [
  { value: "finished-product", label: "Готовой продукцией", hint: "Акт выпускает заготовку, продажа списывает её саму." },
  { value: "ingredients", label: "По составу", hint: "Продажа списывает ингредиенты техкарты; актом такую заготовку не выпустить." },
] as const
export type WriteOffMethod = (typeof WRITE_OFF_METHODS)[number]["value"]

export const writeOffLabel = (method: string) => WRITE_OFF_METHODS.find((option) => option.value === method)?.label ?? method

export const OUTPUT_UNITS = [
  { value: "кг", label: "кг" },
  { value: "л", label: "л" },
  { value: "шт", label: "шт" },
] as const
export type OutputUnit = (typeof OUTPUT_UNITS)[number]["value"]

// ── Ingredient demand (the «Ингредиенты к списанию» preview) ───────────────────────────────────

export interface RecipeForDemand {
  batchYield: number
  lines: { name: string; unit: string; quantity: number; inventoryItemExternalId: string | null; componentProductExternalId: string | null }[]
}

export interface DemandRow {
  key: string
  name: string
  unit: string
  quantity: number
  inventoryItemExternalId: string | null
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

/**
 * Quantities only (no money): recipe line × produced quantity / batch yield, summed per item. A preview —
 * the server re-plans with the recipe version at the act date, losses and nested preparations.
 */
export function ingredientDemand(lines: readonly { productExternalId: string; quantity: number | null }[], recipes: Readonly<Record<string, RecipeForDemand | null | undefined>>): DemandRow[] {
  const rows = new Map<string, DemandRow>()
  for (const line of lines) {
    const recipe = recipes[line.productExternalId]
    if (!recipe || line.quantity === null || !(line.quantity > 0)) continue
    const factor = line.quantity / (recipe.batchYield > 0 ? recipe.batchYield : 1)
    for (const component of recipe.lines) {
      const key = component.inventoryItemExternalId ?? component.componentProductExternalId ?? component.name
      const row = rows.get(key) ?? { key, name: component.name, unit: component.unit, quantity: 0, inventoryItemExternalId: component.inventoryItemExternalId }
      row.quantity += component.quantity * factor
      rows.set(key, row)
    }
  }
  return [...rows.values()].map((row) => ({ ...row, quantity: round3(row.quantity) })).sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

export interface StockCheckRow extends DemandRow {
  onHand: number | null
  short: boolean
}

/** Demand against the source warehouse's balances; null on-hand — unknown (no stock right or not loaded). */
export function checkStock(demand: readonly DemandRow[], balances: ReadonlyMap<string, number> | null): StockCheckRow[] {
  return demand.map((row) => {
    const onHand = balances && row.inventoryItemExternalId ? (balances.get(row.inventoryItemExternalId) ?? 0) : null
    return { ...row, onHand, short: onHand !== null && onHand + 1e-6 < row.quantity }
  })
}

/** «Название» of a domain row: the first line of the comment, else the first positions. */
export function documentTitle(document: { comment: string; lines: readonly { name: string }[] }) {
  const comment = document.comment.split("\n")[0].trim()
  if (comment) return comment
  const names = document.lines.slice(0, 2).map((line) => line.name)
  if (!names.length) return "—"
  return document.lines.length > 2 ? `${names.join(", ")} и ещё ${document.lines.length - 2}` : names.join(", ")
}

// ── «Проверка проведения» (production-control-panel) ──────────────────────────────────────────

export type CheckTone = "ok" | "warning" | "error" | "unknown"
export interface ControlCheck {
  key: "ready" | "stock" | "output" | "transfer" | "method"
  label: string
  tone: CheckTone
  detail: string
}

/**
 * What the server will check on posting, shown before the click: required fields, ingredient stock,
 * the output, the source → destination move and the write-off method (B:production.ts:314).
 */
export function productionChecks(args: {
  headerValid: boolean
  lines: readonly { ref: string; name: string; quantity: number | null }[]
  stock: readonly StockCheckRow[] | null
  sourceName: string | null
  destinationName: string | null
  sameWarehouse: boolean
  methods: ReadonlyMap<string, string> | null
}): ControlCheck[] {
  const shorts = args.stock?.filter((row) => row.short) ?? []
  const unknownStock = args.stock === null || args.stock.some((row) => row.onHand === null)
  const wrongMethod = args.methods ? args.lines.filter((line) => line.ref && args.methods!.get(line.ref) !== "finished-product") : []
  const produced = args.lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0)
  return [
    { key: "ready", label: "Проверка проведения", tone: args.headerValid ? "ok" : "error", detail: args.headerValid ? "Реквизиты и строки заполнены" : "Заполните склады и строки заготовок" },
    {
      key: "stock",
      label: "Остатки ингредиентов",
      tone: shorts.length ? "warning" : unknownStock ? "unknown" : "ok",
      detail: shorts.length
        ? `Не хватает: ${shorts.length} ${shorts.length === 1 ? "позиция" : shorts.length < 5 ? "позиции" : "позиций"} — проведение попросит подтверждения`
        : unknownStock
          ? "Остатки станут известны после выбора склада и позиций"
          : "Ингредиентов на складе достаточно",
    },
    { key: "output", label: "Движение продукции", tone: produced > 0 ? "ok" : "unknown", detail: produced > 0 ? `Выпуск: ${args.lines.length} ${args.lines.length === 1 ? "заготовка" : "заготовки"} на склад «${args.destinationName ?? "—"}»` : "Добавьте заготовки и количество" },
    {
      key: "transfer",
      label: "Перемещение между складами",
      tone: args.sourceName && args.destinationName ? "ok" : "unknown",
      detail: !args.sourceName || !args.destinationName ? "Выберите оба склада" : args.sameWarehouse ? "Списание и выпуск на одном складе" : `Ингредиенты со склада «${args.sourceName}», заготовка — на «${args.destinationName}»`,
    },
    {
      key: "method",
      label: "Метод списания",
      tone: args.methods === null ? "unknown" : wrongMethod.length ? "error" : "ok",
      detail: args.methods === null ? "Загрузка…" : wrongMethod.length ? `${wrongMethod.map((line) => `«${line.name}»`).join(", ")} списывается по составу — акт не проведётся, иначе состав спишется дважды` : "Все заготовки списываются готовой продукцией",
    },
  ]
}
