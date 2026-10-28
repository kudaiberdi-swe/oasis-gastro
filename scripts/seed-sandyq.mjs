#!/usr/bin/env node
// LEGACY — the first client's real menu. Do not run it on the demo dev deployment: dev now holds the synthetic
// chain «Шафран» (npm run seed:shafran) and this would put the client's menu back next to it.
// Seeds Phase 1 catalog + org/restaurants/terminals + three employee accounts from the
// parsed menu JSON in scripts/legacy-sandyq/menu-data/ (not served by the frontend). Idempotent — safe to re-run (see convex/domains/seed/mutations.ts).

import { pbkdf2Sync, randomBytes, randomInt } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdir, writeFile, chmod } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function readDeploymentFromEnv() {
  try {
    const contents = readFileSync(".env.local", "utf8")
    return contents.match(/^CONVEX_DEPLOYMENT=(.+)$/m)?.[1]?.split(" ")[0] ?? ""
  } catch {
    return ""
  }
}

// --prod is a deliberate, explicit override — it targets whatever CONVEX_DEPLOY_KEY points at
// (never .env.local's dev deployment) and, as a hard safety rail, never creates employee PIN
// credentials: production catalog/org data only, until the business is actually ready to
// provision real staff logins (see domains/workforce/mutations.ts:provisionPosAccess for that).
const targetProd = process.argv.includes("--prod")
const deployment = process.env.CONVEX_DEPLOYMENT ?? readDeploymentFromEnv()
if (!targetProd && !deployment.startsWith("dev:")) fail(`Refusing to seed a non-development deployment: ${deployment || "not configured"}. Pass --prod to seed production catalog data explicitly.`)

// --- Canonical taxonomy: Shymkent/Turkistan share real bilingual section headers.
// Almaty's headers are Latin-transliterated legend names, useless as POS categories,
// so Almaty dishes are mapped into this taxonomy by matching name_ru against the other two.
const CANONICAL_CATEGORIES = [
  "Саламтар / Салаты",
  "Тіскебасарлар / Деликатесы",
  "Сұйық тағамдар / Супы",
  "Негізгі тағамдар / Основные блюда",
  "Негізгі тағамдар / Вторые блюда",
  "Гарнирлер / Гарниры",
  "Тұздықтар / Соусы",
  "Нан-тоқаш өнімдері / Выпечка",
  "Тәттілер / Десерты",
  "Дәстүрлі сусындар / Традиционные напитки",
  "Салқындатқыш сусындар / Прохладительные напитки",
  "Фреш",
  "Лимонад",
  "Ұжымдық мәзір / Меню на компанию (5-6 персон)",
]
const FALLBACK_CATEGORY = "Прочее"

// Almaty-only dishes (their menu uses legend sections, not the bilingual taxonomy): canonical category by
// dish name, from the dish itself and its Almaty section. The large sharing platters of «Дала аңызын
// жаңғырту» go to «Меню на компанию» — hence their prices (89 990 ₸, 95 990 ₸).
const ALMATY_ONLY_CATEGORY = new Map(
  Object.entries({
    "Саламтар / Салаты": ["Салат «Қостұра» с подкопченой", "Хрустящие баклажаны в соусе", "Ассорти из сезонных овощей"],
    "Тіскебасарлар / Деликатесы": ["Подкопченый «Құйрық май»", "«Sheke»", "«Ұйқы ашар» копченая конина", "«Кұйрык бауыр»", "«Үлпершек» сердце барашка,", "Осетровая икра"],
    "Сұйық тағамдар / Супы": ["Суп «Жібек жолы» с", "«Жарма көже»", "«Қол кеспе»"],
    "Негізгі тағамдар / Основные блюда": ["«Қазақ ет»", "«Борша ет» (шоу-программа", "«Ши қуырдақ»", "«Бұкпа» из говядины с овощами", "«Қымыз қабырға»", "«Борша ет»", "Томленая баранья шея", "«Қақталган қазы»", "Горная форель", "«Нан салма»"],
    "Ұжымдық мәзір / Меню на компанию (5-6 персон)": ["«Сый табақ»", "«Хан сырбаз»", "«Қарын көмбе» из запеченной", "«Бекіре» с овощами"],
    "Гарнирлер / Гарниры": ["Овощи на гриле"],
    "Нан-тоқаш өнімдері / Выпечка": ["Бауырсаки со сладким вареньем", "Бауырсаки с начинкой", "«Таба нан» с горным мёдом и"],
    "Тәттілер / Десерты": ["Фаршированный финик с обжа-", "Степной десерт «Сүмесүт»", "Хрустящий домашний пирог", "«Төңкерме» из обжаренной пщеницы", "«Майсөк» с муссом", "Десерт «Алматинский апорт»", "Финики", "Варенье", "Мед"],
    "Дәстүрлі сусындар / Традиционные напитки": ["Чайный сет", "Лимон", "Молоко", "Мята"],
  }).flatMap(([category, names]) => names.map((name) => [name, category])),
)

function slug(text) {
  return text
    .toLocaleLowerCase("ru")
    .replace(/[«»"]/g, "")
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

const RESTAURANTS = [
  { key: "almaty", externalId: "sandyq-almaty", name: "Sandyq Алматы", address: "Алматы", city: "Алматы" },
  { key: "shymkent", externalId: "sandyq-shymkent", name: "Sandyq Шымкент", address: "Шымкент", city: "Шымкент" },
  { key: "turkistan", externalId: "sandyq-turkistan", name: "Sandyq Түркістан", address: "Түркістан", city: "Түркістан" },
]

const menuByBranch = new Map(
  RESTAURANTS.map((r) => [r.key, JSON.parse(readFileSync(path.resolve("scripts/legacy-sandyq/menu-data", `${r.key}.json`), "utf8"))]),
)

// name_ru -> canonical category, built from Shymkent+Turkistan (they already use it).
const categoryByName = new Map()
for (const key of ["shymkent", "turkistan"]) {
  for (const item of menuByBranch.get(key)) {
    if (item.category && !categoryByName.has(item.name_ru)) categoryByName.set(item.name_ru, item.category)
  }
}

function resolveVolumeVariants(item) {
  const volumes = [
    ["price_02l", "0,2 л"],
    ["price_025l", "0,25 л"],
    ["price_05l", "0,5 л"],
    ["price_075l", "0,75 л"],
    ["price_1l", "1 л"],
  ]
  const present = volumes.filter(([key]) => item[key] != null)
  if (!present.length) return [{ nameRu: item.name_ru, nameKk: item.name_kk, priceKzt: item.price_kzt }]
  return present.map(([key, label]) => ({ nameRu: `${item.name_ru} ${label}`, nameKk: `${item.name_kk} ${label}`, priceKzt: item[key] }))
}

// productExternalId -> { nameRu, nameKk, category, note, prices: Map<restaurantExternalId, priceKzt> }
const products = new Map()
const unmapped = new Set()

for (const restaurant of RESTAURANTS) {
  const items = menuByBranch.get(restaurant.key)
  for (const item of items) {
    const category = item.category
      ? restaurant.key === "almaty"
        ? (categoryByName.get(item.name_ru) ?? ALMATY_ONLY_CATEGORY.get(item.name_ru) ?? logUnmapped(item.name_ru))
        : item.category
      : logUnmapped(item.name_ru)
    for (const variant of resolveVolumeVariants(item)) {
      const externalId = `sandyq-${slug(variant.nameRu)}`
      if (!products.has(externalId)) {
        products.set(externalId, {
          externalId,
          nameRu: variant.nameRu,
          nameKk: variant.nameKk,
          category: category ?? FALLBACK_CATEGORY,
          note: item.note ?? "",
          prices: new Map(),
        })
      }
      products.get(externalId).prices.set(restaurant.externalId, variant.priceKzt)
    }
  }
}

function logUnmapped(nameRu) {
  unmapped.add(nameRu)
  return undefined
}

if (unmapped.size) {
  console.warn(`⚠ ${unmapped.size} Almaty dish(es) had no matching category in Shymkent/Turkistan — filed under "${FALLBACK_CATEGORY}":`)
  for (const name of unmapped) console.warn(`  - ${name}`)
}

const categories = CANONICAL_CATEGORIES.map((label, index) => ({
  externalId: `cat-${slug(label)}`,
  label,
  shortLabel: label.split(" / ")[1] ?? label,
  sortOrder: index,
})).concat([{ externalId: `cat-${slug(FALLBACK_CATEGORY)}`, label: FALLBACK_CATEGORY, shortLabel: FALLBACK_CATEGORY, sortOrder: CANONICAL_CATEGORIES.length }])

const categoryExternalIdByLabel = new Map(categories.map((c) => [c.label, c.externalId]))

const productPayload = []
const pricePayload = []
for (const product of products.values()) {
  const categoryExternalId = categoryExternalIdByLabel.get(product.category) ?? categoryExternalIdByLabel.get(FALLBACK_CATEGORY)
  const sortOrder = categories.findIndex((c) => c.externalId === categoryExternalId)
  const anyPrice = [...product.prices.values()][0] ?? 0
  productPayload.push({
    externalId: product.externalId,
    name: product.nameRu,
    nameKk: product.nameKk,
    description: product.note,
    category: categoryExternalId,
    categorySort: sortOrder < 0 ? categories.length : sortOrder,
    basePrice: anyPrice,
    sku: product.externalId,
    popular: false,
  })
  for (const [restaurantExternalId, priceKzt] of product.prices) {
    pricePayload.push({ productExternalId: product.externalId, restaurantExternalId, priceKzt })
  }
}

// --- Employees: cashier / manager / administrator, PINs generated locally, hashed with the
// same PBKDF2-SHA256/120k/256-bit params as convex/domains/auth/actions.ts so no plaintext PIN
// ever reaches the server.
function derivePinHash(pin, salt) {
  return pbkdf2Sync(pin, Buffer.from(salt, "utf8"), 120_000, 32, "sha256").toString("hex")
}

function randomCode(prefix) {
  return `${prefix}${randomInt(1000, 10000)}`
}

function randomPin() {
  return String(randomInt(1000, 10000))
}

const restaurantExternalIds = RESTAURANTS.map((r) => r.externalId)
const roles = [
  { role: "cashier", displayName: "Кассир Sandyq", codePrefix: "1" },
  { role: "manager", displayName: "Менеджер Sandyq", codePrefix: "9" },
  { role: "administrator", displayName: "Администратор Sandyq", codePrefix: "99" },
]

const plaintextCredentials = []
const employeePayload = []
if (!targetProd) {
  for (const { role, displayName, codePrefix } of roles) {
    const code = randomCode(codePrefix)
    const pin = randomPin()
    const pinSalt = randomBytes(16).toString("hex")
    const pinHash = derivePinHash(pin, pinSalt)
    employeePayload.push({ code, displayName, role, restaurantExternalIds, pinSalt, pinHash })
    plaintextCredentials.push({ role, code, pin })
  }
}

const payload = {
  organization: { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty" },
  restaurants: RESTAURANTS.map((r) => ({ externalId: r.externalId, organizationExternalId: "sandyq", name: r.name, address: r.address, city: r.city, timezone: "Asia/Almaty" })),
  terminals: RESTAURANTS.map((r, index) => ({ externalId: `${r.externalId}-01`, restaurantExternalId: r.externalId, name: `${r.name} · Касса 1`, terminalNumber: index + 1 })),
  categories,
  products: productPayload,
  prices: pricePayload,
  employees: employeePayload,
}

console.log(`Seeding ${targetProd ? "production (catalog only)" : deployment}: ${payload.restaurants.length} restaurants, ${payload.categories.length} categories, ${payload.products.length} products, ${payload.prices.length} prices, ${payload.employees.length} employees…`)

const result = spawnSync("npx", ["convex", "run", "domains/seed/mutations:seedAll", JSON.stringify(payload), "--typecheck", "disable"], { stdio: "inherit" })
if (result.status !== 0) fail("convex run failed")

if (targetProd) {
  console.log("\n✔ Done. No employee PINs were created (production run) — use the office Кадры screen to provision real staff logins when ready.")
} else {
  const outDir = path.resolve(".sandyq-seed")
  await mkdir(outDir, { recursive: true })
  const credentialsPath = path.join(outDir, `credentials-${Date.now()}.json`)
  await writeFile(
    credentialsPath,
    JSON.stringify({ deployment, generatedAt: new Date().toISOString(), warning: "Development POS access. Keep local, never commit.", credentials: plaintextCredentials }, null, 2),
    { mode: 0o600 },
  )
  await chmod(credentialsPath, 0o600)

  console.log(`\n✔ Done. PIN credentials written to ${credentialsPath}:`)
  for (const cred of plaintextCredentials) console.log(`  ${cred.role.padEnd(14)} code=${cred.code}  pin=${cred.pin}`)
}
