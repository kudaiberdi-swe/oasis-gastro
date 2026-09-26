// Shared toolkit for the iiko sync scripts. Ported from bahandi-pos's scripts/iiko/lib.mjs,
// trimmed to what Phase 3's master-data-only scope needs (departments + employees). The parts
// kept here (XML parsing, sanitization allowlists, hashing, the HTTP client) are proven code —
// reused as-is rather than re-derived.

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith("--")) continue
    const [rawKey, inlineValue] = item.slice(2).split("=", 2)
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (inlineValue !== undefined) result[key] = inlineValue
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) result[key] = argv[++index]
    else result[key] = true
  }
  return result
}

export function readIikoConfig({ credentialsFile = "iiko-credentials.md" } = {}) {
  let source = ""
  if (credentialsFile && fs.existsSync(credentialsFile)) source = fs.readFileSync(credentialsFile, "utf8")
  const host = process.env.IIKO_BASE_URL
    ?? source.match(/https?:\/\/[^\s/]+(?:\/resto\/api)?/i)?.[0]
    ?? source.match(/([a-z0-9.-]+\.iiko\.(?:it|ru))/i)?.[1]
  const login = process.env.IIKO_LOGIN ?? source.match(/login\s*=\s*([^\s]+)/i)?.[1]
  const password = process.env.IIKO_PASSWORD ?? source.match(/password\s*=\s*([^\s]+)/i)?.[1]
  if (!host || !login || !password) {
    throw new Error("Set IIKO_BASE_URL, IIKO_LOGIN and IIKO_PASSWORD, or pass --credentials-file")
  }
  const normalizedHost = host.startsWith("http") ? host : `https://${host}`
  const baseUrl = normalizedHost.replace(/\/+$/, "").replace(/\/resto\/api$/i, "") + "/resto/api"
  return { baseUrl, host: new URL(baseUrl).host, login, password }
}

/** Talks only to GET endpoints in this project — see endpoint-registry.mjs. */
export class IikoClient {
  constructor(config, { retries = 3 } = {}) {
    this.config = config
    this.retries = retries
    this.sessionKey = null
  }

  async login() {
    const passwordHash = crypto.createHash("sha1").update(this.config.password, "utf8").digest("hex")
    const url = new URL(`${this.config.baseUrl}/auth`)
    url.searchParams.set("login", this.config.login)
    url.searchParams.set("pass", passwordHash)
    const response = await fetch(url, { headers: { Accept: "text/plain" } })
    if (!response.ok) throw new Error(`iiko authentication failed (${response.status})`)
    this.sessionKey = (await response.text()).trim()
    if (!this.sessionKey) throw new Error("iiko authentication returned an empty session key")
  }

  async logout() {
    if (!this.sessionKey) return
    const url = new URL(`${this.config.baseUrl}/logout`)
    url.searchParams.set("key", this.sessionKey)
    try {
      await fetch(url, { headers: { Accept: "text/plain" } })
    } finally {
      this.sessionKey = null
    }
  }

  async get(endpoint, { accept = "application/xml" } = {}) {
    if (!this.sessionKey) throw new Error("iiko client is not authenticated")
    const normalizedEndpoint = endpoint.replace(/^\/+/, "").replace(/\/{2,}/g, "/")
    const url = new URL(`${this.config.baseUrl}/${normalizedEndpoint}`)
    url.searchParams.set("key", this.sessionKey)

    let lastError
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await fetch(url, { method: "GET", headers: { Accept: accept } })
        const text = await response.text()
        if (response.ok) return { text, contentType: response.headers.get("content-type") ?? accept, status: response.status }
        const error = new Error(`iiko GET /${normalizedEndpoint} failed (${response.status}): ${text.slice(0, 240)}`)
        error.status = response.status
        if (response.status < 500 && response.status !== 429) throw error
        lastError = error
      } catch (error) {
        lastError = error
        if (error?.status && error.status < 500 && error.status !== 429) throw error
      }
      if (attempt < this.retries) await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt))
    }
    throw lastError
  }
}

function attribute(tag, name) {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1]
}

/** Fetches and summarizes application.wadl — used by `--discover-only`, pulls no business data. */
export function parseWadl(xml) {
  const resources = []
  const methods = []
  let currentMethod = null
  const tokens = xml.matchAll(/<\/?(?:resource|method)\b[^>]*>|<param\b[^>]*\/?>/g)
  for (const match of tokens) {
    const token = match[0]
    if (token.startsWith("<resource")) resources.push(attribute(token, "path") ?? "")
    else if (token.startsWith("</resource")) resources.pop()
    else if (token.startsWith("<method")) {
      currentMethod = { method: attribute(token, "name") ?? "GET", operationId: attribute(token, "id") ?? "", path: `/${resources.filter(Boolean).join("/")}`.replace(/\/{2,}/g, "/") }
    } else if (token.startsWith("</method")) {
      if (currentMethod) methods.push(currentMethod)
      currentMethod = null
    }
  }
  const unique = new Map()
  for (const method of methods) {
    if (method.method === "OPTIONS") continue
    unique.set(`${method.method} ${method.path}`, method)
  }
  return [...unique.values()]
}

export function parseXml(xml) {
  const root = { name: "root", children: [], text: "" }
  const stack = [root]
  // Order matters: the `<?...?>` PI/declaration branch must come before the generic open-tag
  // branch, or `<?xml version="1.0"?>` gets read as an unclosed element named "?xml" that
  // swallows every real sibling that follows as its own children — the entire document ends
  // up nested one level too deep, under a single phantom root key.
  const tokenPattern = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--([\s\S]*?)-->|<\?[\s\S]*?\?>|<\/([^>\s]+)\s*>|<([^>\s/]+)(?:\s[^>]*)?\/>|<([^>\s/]+)(?:\s[^>]*)?>|([^<]+)/g
  for (const match of xml.matchAll(tokenPattern)) {
    if (match[1] !== undefined) stack.at(-1).text += match[1]
    else if (match[2] !== undefined) continue
    else if (match[3]) stack.pop()
    else if (match[4]) stack.at(-1).children.push({ name: stripNamespace(match[4]), children: [], text: "" })
    else if (match[5]) {
      const node = { name: stripNamespace(match[5]), children: [], text: "" }
      stack.at(-1).children.push(node)
      stack.push(node)
    } else if (match[6]?.trim()) stack.at(-1).text += decodeXml(match[6].trim())
  }
  return root.children.length ? xmlNodeToValue(root.children[0]) : null
}

function stripNamespace(value) {
  return value.replace(/^.*:/, "")
}

function decodeXml(value) {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&")
}

function xmlNodeToValue(node) {
  if (!node.children.length) return coerceScalar(node.text)
  const value = {}
  for (const child of node.children) {
    const childValue = xmlNodeToValue(child)
    if (Object.hasOwn(value, child.name)) value[child.name] = Array.isArray(value[child.name]) ? [...value[child.name], childValue] : [value[child.name], childValue]
    else value[child.name] = childValue
  }
  return value
}

function coerceScalar(value) {
  if (value === "true") return true
  if (value === "false") return false
  if (value === "") return ""
  if (/^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))) return Number(value)
  return value
}

export function parseResponse(response) {
  if (response.contentType.includes("xml")) return parseXml(response.text)
  if (!response.text.trim()) return null
  return JSON.parse(response.text)
}

/** iiko wraps list responses in a container tag (e.g. corporateItemDtoes > corporateItemDto[]) — unwrap it. */
export function recordsFromPayload(payload) {
  if (payload === null || payload === undefined) return []
  if (Array.isArray(payload)) return payload
  if (typeof payload !== "object") return [{ value: payload }]
  const arrays = Object.values(payload).filter((value) => Array.isArray(value))
  if (arrays.length) return arrays.sort((left, right) => right.length - left.length)[0]
  // A container with exactly one child object (single-record response) — unwrap one level.
  const objectValues = Object.values(payload).filter((value) => value && typeof value === "object")
  if (objectValues.length === 1) return [objectValues[0]]
  return [payload]
}

/**
 * Field allowlists per domain. Nothing outside these keys is ever read out of the source response, so
 * there's no PII-strip regex to keep in sync — a field can't leak if it was never selected. Dotted keys
 * select nested values ("groupInfo.id"); "[]" selects that key of every array element ("modifiers[].id").
 * Suppliers never bring phone, email, IIN or address.
 */
export const ALLOWLISTS = {
  workforce: ["id", "code", "name", "mainRoleId", "rolesIds", "mainRoleCode", "roleCodes", "departmentCodes", "responsibilityDepartmentCodes", "deleted", "supplier", "client", "employee"],
  organization: ["id", "parentId", "code", "name", "type", "deleted"],
  // corporation/groups: only to map terminals (restaurant sections) and cash registers to departments.
  "department-group": ["id", "name", "departmentId", "pointOfSaleDtoes.pointOfSaleDto[].id", "pointOfSaleDtoes.pointOfSaleDto[].name"],
  warehouse: ["id", "parentId", "code", "name", "type", "deleted"],
  terminal: ["id", "name", "anonymous", "deleted"],
  unit: ["id", "code", "name", "fullName", "systemName", "deleted"],
  supplier: ["id", "code", "name", "supplier", "representsStore", "deleted"],
  "product-group": ["id", "name", "parent", "num", "position", "deleted"],
  product: ["id", "name", "num", "parent", "type", "mainUnit", "defaultSalePrice", "defaultIncludedInMenu", "unitWeight", "deleted"],
  recipe: ["id", "assembledProductId", "dateFrom", "dateTo", "assembledAmount", "technologyDescription", "items[].productId", "items[].amountIn", "items[].amountMiddle", "items[].amountOut", "items[].departmentExternalIds"],
  balance: ["store", "product", "amount", "sum"],
  price: ["departmentId", "productId", "productSizeId", "prices[].dateFrom", "prices[].dateTo", "prices[].price", "prices[].included"],
  // Cash shifts: sums and dates; the manager only by iiko id (D7 — the office shows the code, not the name).
  "cash-shift": ["id", "sessionNumber", "cashRegNumber", "openDate", "closeDate", "managerId", "sessionStartCash", "salesCash", "salesCard", "salesCredit", "payIn", "payOut", "cashDiff", "payOrders", "sessionStatus", "pointOfSaleId"],
  // OLAP SALES rows renamed by extract.mjs: no waiter, guest, phone or address columns are ever requested.
  order: ["departmentId", "orderId", "orderNumber", "openTime", "orderType", "sessionId", "grossAmount", "total", "guestCount"],
}

export function sanitizeRecord(record, domain) {
  if (!record || typeof record !== "object") return record
  const keys = ALLOWLISTS[domain]
  if (!keys) throw new Error(`No sanitizer for domain: ${domain}`)
  return select(record, keys)
}

function select(record, keys) {
  const result = {}
  for (const key of keys) {
    const arrayMatch = /^([^.[\]]+)\[\]\.(.+)$/.exec(key)
    if (arrayMatch) {
      const [, field, inner] = arrayMatch
      const list = record[field]
      if (!Array.isArray(list)) continue
      result[field] = list.map((item, index) => ({ ...(result[field]?.[index] ?? {}), ...select(item ?? {}, [inner]) }))
      continue
    }
    const [head, ...rest] = key.split(".")
    if (!rest.length) {
      if (record[head] !== undefined) result[head] = record[head]
      continue
    }
    const nested = record[head]
    if (nested && typeof nested === "object") result[head] = { ...(result[head] ?? {}), ...select(nested, [rest.join(".")]) }
  }
  return result
}

export function contentHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex")
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
  return JSON.stringify(value)
}

export function recordExternalKey(record, fallback) {
  for (const key of ["id", "externalId", "code"]) {
    if (record?.[key] !== undefined && String(record[key])) return String(record[key])
  }
  return `${fallback}:${contentHash(record).slice(0, 24)}`
}

export function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true })
}

export function writeJson(file, value) {
  ensureDirectory(path.dirname(file))
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

export function writeJsonl(file, rows) {
  ensureDirectory(path.dirname(file))
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), { mode: 0o600 })
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}
