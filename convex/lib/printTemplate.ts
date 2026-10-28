// Safe print templates (W3-ADM-10, POS-DESIGN §6.6): a Mustache-like language shared by the server
// (validation on save, renderPrintTemplate) and the client (office preview, POS printing) — pure TS.
//
//   {{order.number}}            a value; always printed as text (no HTML, no JS, no unescaped form)
//   {{#lines}} … {{/lines}}     a list section (each item) or a condition on a field
//   {{^order.table}} … {{/…}}   an inverted section
//   {{! comment }}              ignored
//
// Layout lives in the template text only, never in values: a line starting with `[center]`, `[right]`,
// `[bold]`, `[small]`, `[large]`, `[box]` or `[total]` (combinable), `left || right` for two columns,
// `---` / `===` for dividers and `[logo]` for the restaurant's name as a heading (no client logo image). A value with «||», «[bold]» or a line
// break prints as plain text. Unknown placeholders are validation errors; the output is a list of lines
// that the print form escapes (printLinesHtml) and the office preview renders as React text.

export const PRINT_DOCUMENT_TYPES = ["receipt", "precheck", "kitchen", "label", "invoice", "report", "x-report", "z-report"] as const
export type PrintDocumentType = (typeof PRINT_DOCUMENT_TYPES)[number]

export const PRINT_DOCUMENT_LABELS: Record<PrintDocumentType, string> = {
  receipt: "Чек продажи",
  precheck: "Предчек",
  kitchen: "Кухонный бегунок",
  label: "Этикетка",
  invoice: "Накладная",
  report: "Отчёт",
  "x-report": "X-отчёт",
  "z-report": "Z-отчёт",
}

export const PRINT_LANGUAGES = ["ru", "kk", "en"] as const
export type PrintLanguage = (typeof PRINT_LANGUAGES)[number]
export const PRINT_LANGUAGE_LABELS: Record<PrintLanguage, string> = { ru: "Русский", kk: "Қазақша", en: "English" }

export const PRINT_WIDTHS = [58, 80] as const
export type PrintWidth = (typeof PRINT_WIDTHS)[number]

export const MAX_TEMPLATE_LENGTH = 10_000
export const MAX_COPIES = 5
const MAX_OUTPUT_LINES = 2_000
const MAX_DEPTH = 6

// ── Placeholders ─────────────────────────────────────────────────────────────

type FieldCatalog = Record<string, string>
export type PlaceholderCatalog = { fields: FieldCatalog; sections: Record<string, { label: string; fields: FieldCatalog }> }

const PLACE: FieldCatalog = { "organization.name": "Юрлицо", "restaurant.name": "Ресторан", "restaurant.address": "Адрес ресторана", "terminal.name": "Касса" }

const ORDER: PlaceholderCatalog = {
  fields: {
    ...PLACE,
    "cashier.name": "Кассир",
    "order.number": "Номер заказа",
    "order.table": "Стол",
    "order.hall": "Зал",
    "order.type": "Тип заказа",
    "order.itemsCount": "Позиций («3 позиции»)",
    "order.createdAt": "Создан",
    "order.paidAt": "Оплачен",
    "order.status": "Статус",
    "order.comment": "Комментарий",
    "totals.subtotal": "Сумма заказа",
    "totals.hasDiscount": "Есть скидка (условие)",
    "totals.discount": "Скидка",
    "totals.discountLabel": "Название скидки",
    "totals.hasServiceCharge": "Есть обслуживание (условие)",
    "totals.serviceChargePercent": "Обслуживание, %",
    "totals.serviceCharge": "Обслуживание",
    "totals.total": "Итого",
    "totals.hasPayments": "Есть оплаты (условие)",
  },
  sections: {
    lines: { label: "Позиции", fields: { name: "Название", quantity: "Количество", amount: "Сумма", details: "Размер и модификаторы" } },
    payments: { label: "Оплаты", fields: { name: "Способ оплаты", amount: "Сумма", refund: "Возврат (условие)", hasChange: "Есть сдача (условие)", tendered: "Получено", change: "Сдача" } },
  },
}

const SHIFT_FIELDS: FieldCatalog = {
  ...PLACE,
  "report.number": "Номер отчёта",
  "shift.number": "Номер смены",
  "shift.businessDate": "Операционная дата",
  "shift.openedAt": "Смена открыта",
  "shift.duration": "Длительность",
  "shift.openedBy": "Открыл смену",
  "sales.menuTotal": "Сумма по меню",
  "sales.discounts": "Скидки",
  "sales.discountedOrders": "Заказов со скидкой",
  "sales.serviceCharge": "Сервисный сбор",
  "sales.payments": "Оплаты",
  "sales.paymentOrders": "Оплаченных заказов",
  "sales.refunds": "Возвраты",
  "sales.refundOrders": "Заказов с возвратом",
  "sales.net": "Чистая выручка",
  "sales.averageCheck": "Средний чек",
  "cash.opening": "Остаток при открытии",
  "cash.sales": "Наличные продажи",
  "cash.refunds": "Наличные возвраты",
  "cash.in": "Внесения",
  "cash.inCount": "Внесений",
  "cash.out": "Изъятия",
  "cash.outCount": "Изъятий",
  "cash.expected": "Ожидается в кассе",
  "orders.paid": "Оплачено заказов",
  "orders.partiallyRefunded": "Частичный возврат",
  "orders.refunded": "Полный возврат",
  "orders.cancelled": "Отменено",
  "orders.cancelledAmount": "Сумма отмен",
  "orders.open": "Открыто",
  "orders.openTotal": "Сумма открытых",
  "orders.held": "Отложено",
  "orders.heldTotal": "Сумма отложенных",
  "orders.unfinished": "Незавершённых",
  "orders.hasUnfinished": "Есть незавершённые (условие)",
}

const METHODS = { label: "Способы оплаты", fields: { name: "Способ", net: "Итого", sales: "Оплаты", saleCount: "Оплат", refunds: "Возвраты", refundCount: "Возвратов" } }

export const PRINT_PLACEHOLDERS: Record<PrintDocumentType, PlaceholderCatalog> = {
  receipt: ORDER,
  precheck: ORDER,
  kitchen: {
    fields: { ...PLACE, "station.name": "Цех", "order.number": "Номер заказа", "order.table": "Стол", "order.type": "Тип заказа", "order.createdAt": "Отправлен", "order.comment": "Комментарий", "cashier.name": "Кассир" },
    sections: { lines: { label: "Позиции", fields: { name: "Название", quantity: "Количество", details: "Размер и модификаторы" } } },
  },
  label: {
    fields: { ...PLACE, "product.name": "Продукт", "product.weight": "Вес / объём", "product.composition": "Состав", "product.madeAt": "Изготовлено", "product.expiresAt": "Годен до" },
    sections: {},
  },
  invoice: {
    fields: { ...PLACE, "document.title": "Документ", "document.number": "Номер", "document.date": "Дата", "counterparty.name": "Контрагент", "warehouse.name": "Склад", "totals.total": "Итого" },
    sections: { lines: { label: "Строки", fields: { name: "Позиция", quantity: "Количество", unit: "Ед.", price: "Цена", amount: "Сумма" } } },
  },
  report: {
    fields: { ...PLACE, "report.title": "Отчёт", "report.period": "Период", "report.generatedAt": "Сформирован" },
    sections: { rows: { label: "Строки", fields: { label: "Показатель", value: "Значение" } } },
  },
  "x-report": {
    fields: { ...SHIFT_FIELDS, "report.sequence": "Номер X-отчёта в смене", "report.generatedAt": "Сформирован", "report.operator": "Оператор" },
    sections: { methods: METHODS },
  },
  "z-report": {
    fields: { ...SHIFT_FIELDS, "shift.closedAt": "Смена закрыта", "shift.closedBy": "Закрыл смену", "cash.counted": "Пересчитано", "cash.variance": "Расхождение" },
    sections: { methods: METHODS },
  },
}

export const LINE_MARKERS = ["center", "right", "bold", "small", "large", "box", "total"] as const
type LineMarker = (typeof LINE_MARKERS)[number]

/** For the editor's hint next to the placeholder list. */
export const LAYOUT_HINTS: [syntax: string, meaning: string][] = [
  ["[center] [right]", "выравнивание строки"],
  ["[bold] [small] [large]", "жирный, мелкий, крупный"],
  ["[box] [total]", "рамка, итоговая строка"],
  ["слева || справа", "две колонки"],
  ["--- / ===", "пунктирный / сплошной разделитель"],
  ["[logo]", "название ресторана крупно"],
  ["{{#список}} … {{/список}}", "повтор или условие"],
  ["{{^поле}} … {{/поле}}", "если поле пустое"],
]

// ── Parsing ──────────────────────────────────────────────────────────────────

export type PrintTemplateError = { line: number; message: string }

type Node = { type: "text"; value: string } | { type: "var"; path: string; line: number } | { type: "section"; name: string; inverted: boolean; line: number; children: Node[] }

type Token = { type: "text"; value: string } | { type: "var" | "open" | "close"; name: string; inverted?: boolean; line: number }

const PATH = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/
const TAG = /\{\{([\s\S]*?)\}\}/g

function tokenize(template: string, errors: PrintTemplateError[]): Token[] {
  const tokens: Token[] = []
  const lines = template.replace(/\r\n?/g, "\n").split("\n")
  lines.forEach((text, index) => {
    const line = index + 1
    const lineTokens: Token[] = []
    let last = 0
    let tags = 0
    let onlyBlocks = true
    for (const match of text.matchAll(TAG)) {
      if (match.index > last) lineTokens.push({ type: "text", value: text.slice(last, match.index) })
      last = match.index + match[0].length
      const raw = match[1]
      const body = raw.trim()
      tags += 1
      if (body.startsWith("!")) continue
      if (raw.startsWith("{") || body.startsWith("{") || body.startsWith("&")) {
        errors.push({ line, message: "Вывод без экранирования ({{{…}}} и {{&…}}) запрещён" })
        continue
      }
      if (body.startsWith(">")) {
        errors.push({ line, message: "Вложенные шаблоны ({{>…}}) не поддерживаются" })
        continue
      }
      const sigil = body[0]
      const name = sigil === "#" || sigil === "^" || sigil === "/" ? body.slice(1).trim() : body
      if (!PATH.test(name)) {
        errors.push({ line, message: `Некорректный плейсхолдер {{${body}}}` })
        continue
      }
      if (sigil === "#" || sigil === "^") lineTokens.push({ type: "open", name, inverted: sigil === "^", line })
      else if (sigil === "/") lineTokens.push({ type: "close", name, line })
      else {
        lineTokens.push({ type: "var", name, line })
        onlyBlocks = false
      }
    }
    const rest = text.slice(last)
    if (rest.includes("{{") || rest.includes("}}")) errors.push({ line, message: "Незакрытые фигурные скобки — плейсхолдер пишется в одной строке: {{поле}}" })
    if (rest) lineTokens.push({ type: "text", value: rest })
    // A line of section tags only (Mustache «standalone») leaves no blank line on paper.
    const standalone = tags > 0 && onlyBlocks && lineTokens.every((token) => token.type !== "text" || !token.value.trim())
    if (standalone) tokens.push(...lineTokens.filter((token) => token.type !== "text"))
    else {
      tokens.push(...lineTokens)
      if (index < lines.length - 1) tokens.push({ type: "text", value: "\n" })
    }
  })
  return tokens
}

function parse(template: string, errors: PrintTemplateError[]): Node[] {
  const root: Node[] = []
  const stack: Extract<Node, { type: "section" }>[] = []
  const target = () => (stack.length ? stack[stack.length - 1].children : root)
  for (const token of tokenize(template, errors)) {
    if (token.type === "text") target().push({ type: "text", value: token.value })
    else if (token.type === "var") target().push({ type: "var", path: token.name, line: token.line })
    else if (token.type === "open") {
      if (stack.length >= MAX_DEPTH) {
        errors.push({ line: token.line, message: `Слишком глубокая вложенность секций (больше ${MAX_DEPTH})` })
        continue
      }
      const section = { type: "section" as const, name: token.name, inverted: Boolean(token.inverted), line: token.line, children: [] }
      target().push(section)
      stack.push(section)
    } else {
      const open = stack[stack.length - 1]
      if (!open) errors.push({ line: token.line, message: `Закрывающий тег {{/${token.name}}} без открывающего` })
      else if (open.name !== token.name) errors.push({ line: token.line, message: `Ожидался {{/${open.name}}}, а не {{/${token.name}}}` })
      else stack.pop()
    }
  }
  for (const open of stack) errors.push({ line: open.line, message: `Секция {{#${open.name}}} не закрыта` })
  return root
}

// ── Validation ───────────────────────────────────────────────────────────────

function check(nodes: Node[], catalog: PlaceholderCatalog, scopes: FieldCatalog[], errors: PrintTemplateError[]) {
  const known = (path: string) => scopes.some((fields) => path in fields)
  for (const node of nodes) {
    if (node.type === "var") {
      if (catalog.sections[node.path]) errors.push({ line: node.line, message: `{{${node.path}}} — это список: {{#${node.path}}} … {{/${node.path}}}` })
      else if (!known(node.path)) errors.push({ line: node.line, message: `Неизвестный плейсхолдер {{${node.path}}}` })
    } else if (node.type === "section") {
      const list = catalog.sections[node.name]
      if (list && !node.inverted) check(node.children, catalog, [list.fields, ...scopes], errors)
      else if (list || known(node.name)) check(node.children, catalog, scopes, errors)
      else {
        errors.push({ line: node.line, message: `Неизвестная секция {{${node.inverted ? "^" : "#"}${node.name}}}` })
        check(node.children, catalog, scopes, errors)
      }
    }
  }
}

/** Errors of a template for a document type: syntax, unknown placeholders, forbidden forms, length. */
export function validatePrintTemplate(template: string, documentType: PrintDocumentType): PrintTemplateError[] {
  const errors: PrintTemplateError[] = []
  if (template.length > MAX_TEMPLATE_LENGTH) errors.push({ line: 0, message: `Шаблон длиннее ${MAX_TEMPLATE_LENGTH} символов` })
  if (!template.trim()) errors.push({ line: 0, message: "Шаблон пуст" })
  const nodes = parse(template, errors)
  check(nodes, PRINT_PLACEHOLDERS[documentType], [PRINT_PLACEHOLDERS[documentType].fields], errors)
  return errors
}

export function formatTemplateError(error: PrintTemplateError) {
  return error.line ? `Строка ${error.line}: ${error.message}` : error.message
}

// ── Rendering ────────────────────────────────────────────────────────────────

export type PrintValue = string | number | boolean | null | undefined | PrintData | PrintData[]
export interface PrintData {
  [key: string]: PrintValue
}

export type PrintTextLine = { kind: "text"; left: string; right?: string; align: "left" | "center" | "right"; bold: boolean; size: "small" | "normal" | "large"; box: boolean; total: boolean }
export type PrintLine = PrintTextLine | { kind: "divider"; style: "dashed" | "solid" } | { kind: "logo"; name: string }

type Chunk = { text: string; data: boolean }

function lookup(path: string, stack: PrintData[]): PrintValue {
  const [head, ...rest] = path.split(".")
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const context = stack[index]
    if (!Object.prototype.hasOwnProperty.call(context, head)) continue
    let value: PrintValue = context[head]
    for (const key of rest) {
      if (!value || typeof value !== "object" || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, key)) return undefined
      value = (value as PrintData)[key]
    }
    return value
  }
  return undefined
}

/** A value as one line of plain text: line breaks and control characters become spaces. */
function textOf(value: PrintValue) {
  if (typeof value === "string") return value.replace(/[\u0000-\u001f\u007f]+/g, " ")
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : ""
  return ""
}

function truthy(value: PrintValue) {
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value)
}

function emit(nodes: Node[], stack: PrintData[], out: Chunk[]) {
  for (const node of nodes) {
    if (out.length > MAX_OUTPUT_LINES * 20) return
    if (node.type === "text") out.push({ text: node.value, data: false })
    else if (node.type === "var") out.push({ text: textOf(lookup(node.path, stack)), data: true })
    else {
      const value = lookup(node.name, stack)
      out.push({ text: "", data: true }) // marks the line as produced by a tag (an empty result is dropped)
      if (node.inverted) {
        if (!truthy(value)) emit(node.children, stack, out)
      } else if (Array.isArray(value)) {
        for (const item of value) emit(node.children, [...stack, item], out)
      } else if (truthy(value)) {
        emit(node.children, value && typeof value === "object" ? [...stack, value] : stack, out)
      }
    }
  }
}

const MARKER = /^\s*\[(center|right|bold|small|large|box|total)\]/

function layout(chunks: Chunk[], brand: string): PrintLine[] {
  // Split into lines on template line breaks only; a value never starts a new line.
  const rows: Chunk[][] = [[]]
  for (const chunk of chunks) {
    if (chunk.data) {
      rows[rows.length - 1].push(chunk)
      continue
    }
    const parts = chunk.text.split("\n")
    parts.forEach((part, index) => {
      if (index > 0) rows.push([])
      if (part) rows[rows.length - 1].push({ text: part, data: false })
    })
  }
  if (rows.length > 1 && !rows[rows.length - 1].length) rows.pop() // the break before a closing standalone tag

  const lines: PrintLine[] = []
  for (const row of rows) {
    if (lines.length >= MAX_OUTPUT_LINES) break
    const fromTags = row.some((chunk) => chunk.data)
    const hasValues = row.some((chunk) => chunk.data && chunk.text)
    const templateText = row.filter((chunk) => !chunk.data).map((chunk) => chunk.text).join("")
    if (!hasValues && templateText.trim() === "[logo]") {
      lines.push({ kind: "logo", name: brand })
      continue
    }
    if (!hasValues && /^\s*(-{3,}|={3,})\s*$/.test(templateText)) {
      lines.push({ kind: "divider", style: templateText.trim().startsWith("=") ? "solid" : "dashed" })
      continue
    }
    // Markers are read from the template text at the start of the line.
    const markers = new Set<LineMarker>()
    const cells = row.filter((chunk) => !chunk.data || chunk.text) // zero-width marks of section tags
    while (cells.length && !cells[0].data) {
      const match = MARKER.exec(cells[0].text)
      if (!match) break
      markers.add(match[1] as LineMarker)
      const text = cells[0].text.slice(match[0].length)
      if (text) cells[0] = { text, data: false }
      else cells.shift()
    }
    let left = ""
    let right: string | undefined
    for (const chunk of cells) {
      const split = chunk.data || right !== undefined ? -1 : chunk.text.indexOf("||")
      if (split >= 0) {
        left += chunk.text.slice(0, split)
        right = chunk.text.slice(split + 2)
      } else if (right !== undefined) right += chunk.text
      else left += chunk.text
    }
    left = left.trim()
    right = right?.trim()
    // A line whose placeholders all came out empty is dropped; a blank template line stays.
    if (fromTags && !left && !right) continue
    lines.push({
      kind: "text",
      left,
      ...(right !== undefined ? { right } : {}),
      align: markers.has("center") ? "center" : markers.has("right") ? "right" : "left",
      bold: markers.has("bold") || markers.has("total"),
      size: markers.has("large") ? "large" : markers.has("small") ? "small" : "normal",
      box: markers.has("box"),
      total: markers.has("total"),
    })
  }
  return lines
}

/** Renders a template on data: the lines to print and the validation errors (rendering goes on regardless). */
export function renderPrintTemplate(template: string, documentType: PrintDocumentType, data: PrintData): { lines: PrintLine[]; errors: PrintTemplateError[] } {
  const errors = validatePrintTemplate(template, documentType)
  const nodes = parse(template.slice(0, MAX_TEMPLATE_LENGTH), [])
  const chunks: Chunk[] = []
  emit(nodes, [data], chunks)
  // The `[logo]` heading: the restaurant's name from the data (the organization's when there is none).
  const place = (key: string) => {
    const value = data[key]
    return value && typeof value === "object" && !Array.isArray(value) && typeof value.name === "string" ? value.name : ""
  }
  return { lines: layout(chunks, place("restaurant") || place("organization")), errors }
}

// ── Print form ───────────────────────────────────────────────────────────────

export function escapePrintText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;")
}

/** The body of the print form for rendered lines; every text is escaped, classes come from a fixed set. */
export function printLinesHtml(lines: PrintLine[]) {
  return lines
    .map((line) => {
      if (line.kind === "logo") return line.name ? `<h1 class="brand">${escapePrintText(line.name)}</h1>` : ""
      if (line.kind === "divider") return `<hr class="divider${line.style === "solid" ? " solid" : ""}">`
      const classes = [
        line.align === "center" ? "center" : line.align === "right" ? "align-right" : "",
        line.bold ? "strong" : "",
        line.size === "small" ? "muted" : line.size === "large" ? "large" : "",
        line.box ? "box" : "",
        line.total ? "total" : "",
      ].filter(Boolean)
      if (line.right !== undefined) return `<div class="${["row", ...classes].join(" ")}"><span>${escapePrintText(line.left)}</span><span>${escapePrintText(line.right)}</span></div>`
      return `<p class="${["line", ...classes].join(" ")}">${line.left ? escapePrintText(line.left) : "&nbsp;"}</p>`
    })
    .join("\n")
}

// ── Demo data for the preview ────────────────────────────────────────────────

const SAMPLE_PLACE = {
  organization: { name: "ТОО «Ресторанная сеть»" },
  restaurant: { name: "Ресторан Алматы", address: "пр. Достык, 97" },
  terminal: { name: "Касса 1" },
}

const SAMPLE_SHIFT = {
  ...SAMPLE_PLACE,
  report: { number: "X-2026-00014", sequence: 2, generatedAt: "26.09.2026, 18:40", operator: "Айгерим С. · Менеджер" },
  shift: { number: 128, businessDate: "2026-09-26", openedAt: "26.09.2026, 09:02", duration: "9 ч 38 мин", openedBy: "Айгерим С.", closedAt: "26.09.2026, 23:15", closedBy: "Айгерим С." },
  sales: { menuTotal: "412 600 ₸", discounts: "−12 300 ₸", discountedOrders: 4, serviceCharge: "58 900 ₸", payments: "459 200 ₸", paymentOrders: 37, refunds: "−4 800 ₸", refundOrders: 1, net: "454 400 ₸", averageCheck: "12 281 ₸" },
  methods: [
    { name: "Наличные", net: "118 000 ₸", sales: "118 000 ₸", saleCount: 11, refunds: "0 ₸", refundCount: 0 },
    { name: "Банковские карты", net: "281 600 ₸", sales: "286 400 ₸", saleCount: 21, refunds: "−4 800 ₸", refundCount: 1 },
    { name: "QR", net: "54 800 ₸", sales: "54 800 ₸", saleCount: 5, refunds: "0 ₸", refundCount: 0 },
  ],
  cash: { opening: "20 000 ₸", sales: "118 000 ₸", refunds: "0 ₸", in: "10 000 ₸", inCount: 1, out: "−50 000 ₸", outCount: 1, expected: "98 000 ₸", counted: "97 500 ₸", variance: "−500 ₸" },
  orders: { paid: 36, partiallyRefunded: 1, refunded: 0, cancelled: 2, cancelledAmount: "7 400 ₸", open: 1, openTotal: "9 800 ₸", held: 0, heldTotal: "0 ₸", unfinished: 1, hasUnfinished: true },
}

const SAMPLE_ORDER = {
  ...SAMPLE_PLACE,
  cashier: { name: "Айгерим С." },
  order: { number: 142, table: "Стол 7", hall: "Основной зал", type: "В зале", itemsCount: "4 позиции", createdAt: "26.09.2026, 13:05", paidAt: "26.09.2026, 13:48", status: "Оплачен", comment: "Без лука в салате" },
  lines: [
    { name: "Бешбармак", quantity: 2, amount: "11 800 ₸", details: "Большая порция" },
    { name: "Салат «Шопский»", quantity: 1, amount: "3 200 ₸", details: "" },
    { name: "Чай с молоком", quantity: 1, amount: "900 ₸", details: "Чайник" },
  ],
  totals: { subtotal: "15 900 ₸", hasDiscount: false, discount: "0 ₸", discountLabel: "", hasServiceCharge: true, serviceChargePercent: 15, serviceCharge: "2 385 ₸", total: "18 285 ₸", hasPayments: true },
  payments: [{ name: "Наличные", amount: "18 285 ₸", refund: false, hasChange: true, tendered: "20 000 ₸", change: "1 715 ₸" }],
}

export const PRINT_SAMPLES: Record<PrintDocumentType, PrintData> = {
  receipt: SAMPLE_ORDER,
  precheck: { ...SAMPLE_ORDER, order: { ...SAMPLE_ORDER.order, paidAt: "", status: "Открыт" }, payments: [], totals: { ...SAMPLE_ORDER.totals, hasPayments: false } },
  kitchen: { ...SAMPLE_PLACE, cashier: SAMPLE_ORDER.cashier, station: { name: "Горячий цех" }, order: { number: 142, table: "Стол 7", type: "В зале", createdAt: "26.09.2026, 13:07", comment: "Без лука в салате" }, lines: SAMPLE_ORDER.lines.map(({ name, quantity, details }) => ({ name, quantity, details })) },
  label: { ...SAMPLE_PLACE, product: { name: "Баурсаки", weight: "500 г", composition: "Мука, молоко, дрожжи, масло", madeAt: "26.09.2026, 08:00", expiresAt: "27.09.2026, 08:00" } },
  invoice: {
    ...SAMPLE_PLACE,
    document: { title: "Расходная накладная", number: "РН-2026-00031", date: "26.09.2026" },
    counterparty: { name: "ТОО «Дала Азық»" },
    warehouse: { name: "Основной склад" },
    lines: [
      { name: "Мука пшеничная", quantity: 25, unit: "кг", price: "420 ₸", amount: "10 500 ₸" },
      { name: "Масло сливочное", quantity: 5, unit: "кг", price: "3 900 ₸", amount: "19 500 ₸" },
    ],
    totals: { total: "30 000 ₸" },
  },
  report: {
    ...SAMPLE_PLACE,
    report: { title: "Продажи за день", period: "26.09.2026", generatedAt: "26.09.2026, 23:20" },
    rows: [
      { label: "Выручка", value: "454 400 ₸" },
      { label: "Чеков", value: "37" },
      { label: "Средний чек", value: "12 281 ₸" },
    ],
  },
  "x-report": SAMPLE_SHIFT,
  "z-report": { ...SAMPLE_SHIFT, report: { number: "Z-2026-00128" } },
}

// ── Default templates (seed, POS-DESIGN §6.6) ────────────────────────────────

const ORDER_HEADER = `[logo]
[center][small]{{organization.name}}`

const ORDER_BODY = `---
{{#lines}}
[bold]{{quantity}} × {{name}} || {{amount}}
[small]   {{details}}
{{/lines}}
{{#order.comment}}
[box]Комментарий: {{order.comment}}
{{/order.comment}}
---
Сумма заказа || {{totals.subtotal}}
{{#totals.hasDiscount}}
{{totals.discountLabel}} || {{totals.discount}}
{{/totals.hasDiscount}}
{{#totals.hasServiceCharge}}
Қызмет ақысы {{totals.serviceChargePercent}} % / Обслуживание {{totals.serviceChargePercent}} % || {{totals.serviceCharge}}
{{/totals.hasServiceCharge}}`

const SHIFT_BODY = `---
[bold]Продажи
Сумма по меню || {{sales.menuTotal}}
Скидки · {{sales.discountedOrders}} || {{sales.discounts}}
Сервисный сбор || {{sales.serviceCharge}}
Оплаты · {{sales.paymentOrders}} || {{sales.payments}}
Возвраты · {{sales.refundOrders}} || {{sales.refunds}}
[total]ЧИСТАЯ ВЫРУЧКА || {{sales.net}}
Средний чек || {{sales.averageCheck}}
---
[bold]По способам оплаты
{{#methods}}
[bold]{{name}} || {{net}}
[small]   Оплаты · {{saleCount}} || {{sales}}
[small]   Возвраты · {{refundCount}} || {{refunds}}
{{/methods}}
---
[bold]Наличные в кассе
Остаток при открытии || {{cash.opening}}
Наличные продажи || {{cash.sales}}
Наличные возвраты || {{cash.refunds}}
Внесения · {{cash.inCount}} || {{cash.in}}
Изъятия · {{cash.outCount}} || {{cash.out}}
[total]ОЖИДАЕТСЯ || {{cash.expected}}
---
[bold]Заказы
Оплачены || {{orders.paid}}
Частичный возврат || {{orders.partiallyRefunded}}
Полный возврат || {{orders.refunded}}
Отменены || {{orders.cancelled}} · {{orders.cancelledAmount}}
Открыты || {{orders.open}} · {{orders.openTotal}}
Отложены || {{orders.held}} · {{orders.heldTotal}}
{{#orders.hasUnfinished}}
[box]Незавершённых заказов: {{orders.unfinished}}
{{/orders.hasUnfinished}}`

export type SeedPrintTemplate = { documentType: PrintDocumentType; name: string; template: string }

export const DEFAULT_PRINT_TEMPLATES: SeedPrintTemplate[] = [
  {
    documentType: "receipt",
    name: "Чек продажи",
    template: `${ORDER_HEADER}
[center][bold]ЧЕК ЗАКАЗА
[center][small]{{terminal.name}}
{{#order.number}}
[center][large]Заказ №{{order.number}}
{{/order.number}}
[center][small]{{#order.table}}{{order.table}} · {{/order.table}}{{order.type}} · {{order.itemsCount}}
---
Создан || {{order.createdAt}}
{{#order.paidAt}}
Оплачен || {{order.paidAt}}
{{/order.paidAt}}
{{#order.status}}
Статус || {{order.status}}
{{/order.status}}
Кассир || {{cashier.name}}
${ORDER_BODY}
[total]ИТОГО || {{totals.total}}
{{#totals.hasPayments}}
---
[bold]Оплата
{{#payments}}
{{#refund}}Возврат · {{/refund}}{{name}} || {{amount}}
{{#hasChange}}
[small]   Получено || {{tendered}}
[small]   Сдача || {{change}}
{{/hasChange}}
{{/payments}}
{{/totals.hasPayments}}
[box]НЕФИСКАЛЬНЫЙ ДОКУМЕНТ
[center]Рахмет! Спасибо за визит`,
  },
  {
    documentType: "precheck",
    name: "Предчек",
    template: `${ORDER_HEADER}
[center][bold]ПРЕДЧЕК
[center][small]{{terminal.name}}
{{#order.number}}
[center][large]Заказ №{{order.number}}
{{/order.number}}
[center][small]{{#order.table}}{{order.table}} · {{/order.table}}{{order.type}} · {{order.itemsCount}}
---
Время || {{order.createdAt}}
Кассир || {{cashier.name}}
${ORDER_BODY}
[total]К ОПЛАТЕ || {{totals.total}}
[box]НЕ ЯВЛЯЕТСЯ ЧЕКОМ
[center]Проверьте заказ перед оплатой`,
  },
  {
    documentType: "x-report",
    name: "X-отчёт",
    template: `[logo]
[center][bold]X-ОТЧЁТ
[center][small]Отчёт без гашения
[box]НЕФИСКАЛЬНЫЙ ДОКУМЕНТ
[center][small]{{#restaurant.address}}{{restaurant.address}} · {{/restaurant.address}}{{terminal.name}}
[center][bold]{{report.number}}
---
Смена || №{{shift.number}}
Опер. дата || {{shift.businessDate}}
Открыта || {{shift.openedAt}}
Сформирован || {{report.generatedAt}}
Длительность || {{shift.duration}}
Открыл смену || {{shift.openedBy}}
Оператор || {{report.operator}}
${SHIFT_BODY}
---
Оператор ____________________
[center][bold]СМЕНА НЕ ЗАКРЫТА
[center][small]Итоги не обнулены · X-отчёт №{{report.sequence}}`,
  },
  {
    documentType: "z-report",
    name: "Z-отчёт",
    template: `[logo]
[center][bold]Z-ОТЧЁТ
[center][small]Отчёт с закрытием смены
[box]НЕФИСКАЛЬНЫЙ ДОКУМЕНТ
[center][small]{{terminal.name}}
[center][bold]{{report.number}}
---
Смена || №{{shift.number}}
Опер. дата || {{shift.businessDate}}
Открыта || {{shift.openedAt}}
Закрыта || {{shift.closedAt}}
Длительность || {{shift.duration}}
Закрыл смену || {{shift.closedBy}}
${SHIFT_BODY}
---
[bold]Сверка наличных
Ожидалось || {{cash.expected}}
Пересчитано || {{cash.counted}}
[total]РАСХОЖДЕНИЕ || {{cash.variance}}
---
Кассир ____________________
Менеджер ____________________
[center][bold]СМЕНА ЗАКРЫТА`,
  },
]
