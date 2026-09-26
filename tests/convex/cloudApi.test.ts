import { afterEach, describe, expect, it, vi } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { canonicalString, signRequest, timingSafeEqual, verifySignedRequest } from "../../convex/lib/hmac"
import { setup } from "./fixtures/pos"

// W3-INT-03/04: Cloud API (HMAC, replay, menu through resolvePrice, stop list, delivery orders,
// webhooks through the integration queue) and the external menu versions. The secret here is a
// throwaway test value, never a real one.

const SECRET = "test-only-cloud-api-secret"
const square = [
  { latitude: 43.2, longitude: 76.8 },
  { latitude: 43.2, longitude: 77.0 },
  { latitude: 43.3, longitude: 77.0 },
  { latitude: 43.3, longitude: 76.8 },
]

type T = Awaited<ReturnType<typeof setup>>["t"]

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// Each call gets a later millisecond, so two identical requests are two signatures (the same one is a replay).
let clock = 0

async function signed(t: T, method: "GET" | "POST", pathAndQuery: string, body = "", options: { timestamp?: number; secret?: string; signature?: string } = {}) {
  clock = Math.max(Date.now(), clock + 1)
  const timestamp = String(options.timestamp ?? clock)
  const signature = options.signature ?? (await signRequest(options.secret ?? SECRET, { timestamp, method, pathAndQuery, body }))
  const headers = { "x-sandyq-timestamp": timestamp, "x-sandyq-signature": signature, "content-type": "application/json" }
  return { response: await t.fetch(pathAndQuery, { method, headers, ...(method === "POST" ? { body } : {}) }), signature, timestamp }
}

async function office(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Оператор", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
  })
  await t.mutation(internal.domains.delivery.internal.seedSources, {})
  const admin = t.withIdentity({ email: "admin@sandyq.test" })
  await admin.mutation(api.domains.delivery.mutations.saveZone, { restaurantExternalId: "almaty", name: "Центр", priority: 1, polygon: square, deliveryFee: 500, minimumOrder: 1500, cookingMinutes: 20, deliveryMinutes: 30, active: true })
  return admin
}

const orderBody = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ orderId: "site-1001", restaurantExternalId: "almaty", customerName: "Айгерим", phone: "+7 701 123 45 67", address: "Абая 10", latitude: 43.25, longitude: 76.9, expectedAt: Date.now() + 3_600_000, lines: [{ productExternalId: "dish", quantity: 2 }], ...extra })

describe("lib/hmac", () => {
  it("signs method, path and body; compares in constant time", async () => {
    expect(canonicalString({ timestamp: "1", method: "get", pathAndQuery: "/api/v1/menu?restaurant=a", body: "" })).toBe("1.GET./api/v1/menu?restaurant=a.")
    expect(timingSafeEqual("abc", "abc")).toBe(true)
    expect(timingSafeEqual("abc", "abd")).toBe(false)
    expect(timingSafeEqual("abc", "abcd")).toBe(false)
    const now = 1_790_000_000_000
    const timestamp = String(now)
    const signature = await signRequest(SECRET, { timestamp, method: "GET", pathAndQuery: "/api/v1/menu?restaurant=almaty", body: "" })
    const request = (path: string, sig = signature) => new Request(`https://example.test${path}`, { headers: { "x-sandyq-timestamp": timestamp, "x-sandyq-signature": sig } })
    expect(await verifySignedRequest(request("/api/v1/menu?restaurant=almaty"), "", { secret: SECRET, now })).toMatchObject({ ok: true })
    expect(await verifySignedRequest(request("/api/v1/menu?restaurant=almaty", `sha256=${signature}`), "", { secret: SECRET, now })).toMatchObject({ ok: true })
    // The same signature for another restaurant is not valid.
    expect(await verifySignedRequest(request("/api/v1/menu?restaurant=shymkent"), "", { secret: SECRET, now })).toMatchObject({ ok: false, status: 401 })
    expect(await verifySignedRequest(request("/api/v1/menu?restaurant=almaty"), "", { secret: undefined, now })).toMatchObject({ ok: false, status: 503 })
  })
})

describe("Cloud API routes (W3-INT-03)", () => {
  it("without CLOUD_API_SECRET every route answers 503, never serves data", async () => {
    const { t } = await setup()
    await office(t)
    vi.stubEnv("CLOUD_API_SECRET", "")
    for (const [method, path] of [["GET", "/api/v1/menu?restaurant=almaty"], ["GET", "/api/v1/stop-lists?restaurant=almaty"], ["POST", "/api/v1/delivery/orders"], ["POST", "/api/v1/webhooks/sandyq-site"]] as const) {
      const { response } = await signed(t, method, path, method === "POST" ? orderBody() : "")
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: "Cloud API не настроен" })
    }
  })

  it("signature: valid → 200, wrong → 401, 6 minutes off → 401, the same signature again → 409", async () => {
    const { t } = await setup()
    await office(t)
    vi.stubEnv("CLOUD_API_SECRET", SECRET)
    const path = "/api/v1/menu?restaurant=almaty"
    const first = await signed(t, "GET", path)
    expect(first.response.status).toBe(200)
    expect((await signed(t, "GET", path, "", { secret: "another-secret" })).response.status).toBe(401)
    const late = await signed(t, "GET", path, "", { timestamp: Date.now() - 6 * 60_000 })
    expect(late.response.status).toBe(401)
    expect(await late.response.json()).toEqual({ error: "Время запроса вне допустимого окна ±5 минут" })
    const replay = await signed(t, "GET", path, "", { timestamp: Number(first.timestamp), signature: first.signature })
    expect(replay.response.status).toBe(409)
    expect((await signed(t, "GET", path, "", { signature: "" })).response.status).toBe(401)
  })

  it("menu: price from the active price order (not basePrice), bilingual names; a disabled dish is absent; stop list", async () => {
    const { t, productId } = await setup()
    await office(t)
    vi.stubEnv("CLOUD_API_SECRET", SECRET)
    await t.run(async (ctx) => {
      await ctx.db.insert("products", { externalId: "hidden", name: "Скрытое", nameKk: "Жасырын", nameSort: "скрытое", searchText: "скрытое", description: "", category: "hot", categorySort: 1, basePrice: 700, popular: false, sku: "H", baseUnit: "порц.", enabled: false })
      const order = await ctx.db.insert("priceOrders", { externalId: "po-1", number: "ЦЕН-2026-00001", name: "Осень", nameSort: "осень", searchText: "осень", effectiveFrom: Date.now() - 60_000, status: "active", comment: "", posName: "Осень", replacesPreviousMenu: false, restaurantExternalIds: [], organizationExternalId: "sandyq", createdBy: "test", updatedAt: 0 })
      await ctx.db.insert("priceOrderLines", { orderId: order, productId, productExternalId: "dish", included: true, previousPrice: 1000, newPrice: 1350, costAtSave: 0, productName: "Бешбармак" })
    })
    const { response } = await signed(t, "GET", "/api/v1/menu?restaurant=almaty")
    const menu = await response.json()
    expect(menu).toMatchObject({ restaurant: { externalId: "almaty" }, channel: "website", source: "live", currency: "KZT", categories: [{ externalId: "hot", name: "Горячее" }] })
    expect(menu.items).toEqual([expect.objectContaining({ externalId: "dish", name: "Бешбармак", nameKk: "Бешбармақ", price: 1350 })])
    expect(menu.version).toMatch(/^[0-9a-f]{16}$/)
    // The POS resolves the same price for the same restaurant and moment.
    const posPrice = await t.run(async (ctx) => {
      const { resolvePrice } = await import("../../convex/lib/pricing")
      return (await resolvePrice(ctx, { product: (await ctx.db.get(productId))!, restaurantExternalId: "almaty", at: Date.now() })).price
    })
    expect(posPrice).toBe(1350)

    expect((await (await signed(t, "GET", "/api/v1/stop-lists?restaurant=almaty")).response.json()).items).toEqual([])
    await t.run((ctx) => ctx.db.insert("productAvailability", { productId, restaurantExternalId: "almaty", available: false, reason: "Закончилось", updatedBy: "test", updatedAt: Date.now() }))
    const stop = await (await signed(t, "GET", "/api/v1/stop-lists?restaurant=almaty")).response.json()
    expect(stop.items).toEqual([{ productExternalId: "dish", until: null }])
    expect((await signed(t, "GET", "/api/v1/menu?restaurant=nowhere")).response.status).toBe(404)
  })

  it("delivery order: below the zone minimum → 400 with the text; created → 201; the same orderId → 200 duplicate", async () => {
    const { t } = await setup()
    await office(t)
    vi.stubEnv("CLOUD_API_SECRET", SECRET)
    const small = await signed(t, "POST", "/api/v1/delivery/orders", orderBody({ lines: [{ productExternalId: "dish", quantity: 1 }] }))
    expect(small.response.status).toBe(400)
    expect(await small.response.json()).toEqual({ error: "Минимальная сумма для зоны «Центр»: 1500 ₸" })
    expect((await signed(t, "POST", "/api/v1/delivery/orders", orderBody({ lines: "две порции" }))).response.status).toBe(400)

    const created = await signed(t, "POST", "/api/v1/delivery/orders", orderBody())
    expect(created.response.status).toBe(201)
    expect(await created.response.json()).toMatchObject({ orderId: "site-1001", number: "DEL-000001", status: "unprocessed", total: 2500, duplicate: false })
    const again = await signed(t, "POST", "/api/v1/delivery/orders", orderBody())
    expect(again.response.status).toBe(200)
    expect(await again.response.json()).toMatchObject({ number: "DEL-000001", duplicate: true })

    const stored = await t.run(async (ctx) => {
      const orders = await ctx.db.query("deliveryOrders").withIndex("by_source_created", (q) => q.eq("sourceExternalId", "source-website")).collect()
      const audit = await ctx.db.query("auditEvents").withIndex("by_resource", (q) => q.eq("resourceExternalId", orders[0].externalId)).collect()
      return { orders, audit }
    })
    expect(stored.orders).toHaveLength(1)
    expect(stored.orders[0]).toMatchObject({ sourceOrderId: "site-1001", subtotal: 2000, deliveryFee: 500, status: "unprocessed" })
    expect(stored.audit.map((row) => row.actorKey)).toEqual(["api:source-website"])
  })

  it("status webhooks go through the integration queue; without the URL the job fails honestly, with it the POST is signed", async () => {
    vi.useFakeTimers()
    const { t } = await setup()
    const admin = await office(t)
    vi.stubEnv("CLOUD_API_SECRET", SECRET)
    const created = await (await signed(t, "POST", "/api/v1/delivery/orders", orderBody())).response.json()
    await admin.mutation(api.domains.delivery.mutations.transitionOrder, { externalId: created.externalId, to: "waiting", expectedVersion: 1 })
    await t.mutation(internal.domains.integrations.internal.publishOutboxEvents, {})
    const webhookJobs = () => t.run(async (ctx) => (await ctx.db.query("integrationJobs").collect()).filter((job) => job.provider === "cloud-api"))
    const [job] = await webhookJobs()
    expect(job).toMatchObject({ operation: "delivery-order.status", status: "queued", payload: { orderId: "site-1001", number: "DEL-000001", status: "waiting", previousStatus: "unprocessed" } })
    expect(await webhookJobs()).toHaveLength(1) // «created» is answered by the 201, only statuses are pushed

    await t.action(internal.domains.integrations.internal.processIntegrationJobs, {})
    expect((await webhookJobs())[0]).toMatchObject({ status: "dead-letter", attempts: 1, error: expect.stringContaining("CLOUD_API_WEBHOOK_URL") })

    vi.stubEnv("CLOUD_API_WEBHOOK_URL", "https://sandyq.example/hooks/sandyq")
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    // What «Повторить» in «Очередь интеграций» does once the URL is set.
    await t.run(async (ctx) => ctx.db.patch(job._id, { status: "queued", nextAttemptAt: 0 }))
    await t.action(internal.domains.integrations.internal.processIntegrationJobs, {})
    expect((await webhookJobs())[0]).toMatchObject({ status: "completed", attempts: 2 })
    const [target, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    const headers = init.headers as Record<string, string>
    const expected = await signRequest(SECRET, { timestamp: headers["x-sandyq-timestamp"], method: "POST", pathAndQuery: "/hooks/sandyq", body: init.body as string })
    expect(String(target)).toBe("https://sandyq.example/hooks/sandyq")
    expect(headers["x-sandyq-signature"]).toBe(expected)
  })

  it("inbound webhook → an inbound job, once per eventId", async () => {
    const { t } = await setup()
    vi.stubEnv("CLOUD_API_SECRET", SECRET)
    const body = JSON.stringify({ eventId: "evt-1", type: "order.paid", orderId: "site-1001" })
    const first = await signed(t, "POST", "/api/v1/webhooks/sandyq-site", body)
    expect(first.response.status).toBe(202)
    expect((await signed(t, "POST", "/api/v1/webhooks/sandyq-site", body)).response.status).toBe(200)
    const jobs = await t.run((ctx) => ctx.db.query("integrationJobs").collect())
    expect(jobs.map((job) => [job.provider, job.direction, job.operation, job.idempotencyKey])).toEqual([["sandyq-site", "inbound", "order.paid", "webhook:sandyq-site:evt-1"]])
  })
})

describe("external menu (W3-INT-04)", () => {
  it("publishing creates a version; again without catalog changes — the same version; the API serves the published one", async () => {
    vi.useFakeTimers()
    const { t, productId } = await setup()
    const admin = await office(t)
    vi.stubEnv("CLOUD_API_SECRET", SECRET)
    const menus = api.domains.integrations.externalMenu
    const recordExternalId = await admin.mutation(menus.saveExternalMenu, { name: "Публикация sandyq.kz", channel: "website", mode: "published", restaurantExternalIds: ["almaty"] })
    await admin.mutation(menus.publishExternalMenu, { recordExternalId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    let card = (await admin.query(menus.externalMenu, { externalId: recordExternalId }))!
    expect(card).toMatchObject({ status: "published", number: "EXM-000001" })
    expect(card.versions).toHaveLength(1)
    const firstVersion = card.versions[0].version

    await admin.mutation(menus.publishExternalMenu, { recordExternalId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    card = (await admin.query(menus.externalMenu, { externalId: recordExternalId }))!
    expect(card.versions.map((row) => row.version)).toEqual([firstVersion])

    // A branch price after publishing: the API keeps serving the published snapshot until the next publication.
    await t.run((ctx) => ctx.db.insert("productPrices", { productId, restaurantExternalId: "almaty", priceKzt: 1200 }))
    vi.setSystemTime(Date.now() + 1000)
    let menu = await (await signed(t, "GET", "/api/v1/menu?restaurant=almaty")).response.json()
    expect(menu).toMatchObject({ source: "published", version: firstVersion, menuExternalId: recordExternalId })
    expect(menu.items[0].price).toBe(1000)

    await admin.mutation(menus.publishExternalMenu, { recordExternalId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    card = (await admin.query(menus.externalMenu, { externalId: recordExternalId }))!
    expect(card.versions).toHaveLength(2)
    vi.setSystemTime(Date.now() + 1000)
    menu = await (await signed(t, "GET", "/api/v1/menu?restaurant=almaty")).response.json()
    expect(menu).toMatchObject({ source: "published", version: card.versions[0].version })
    expect(menu.items[0].price).toBe(1200)
    const preview = (await admin.query(menus.externalMenuVersion, { versionId: card.versions[0].id }))!
    expect(preview.items).toEqual([expect.objectContaining({ name: "Бешбармак", price: 1200, category: "Горячее" })])

    // The publication is announced to the website through the queue.
    await t.mutation(internal.domains.integrations.internal.publishOutboxEvents, {})
    const announced = await t.run(async (ctx) => (await ctx.db.query("integrationJobs").collect()).filter((job) => job.provider === "cloud-api").map((job) => job.operation))
    expect(announced).toEqual(["external-menu.published", "external-menu.published"])

    // Taken off: back to the live catalog.
    await admin.mutation(menus.deactivateExternalMenu, { recordExternalId })
    vi.setSystemTime(Date.now() + 1000)
    menu = await (await signed(t, "GET", "/api/v1/menu?restaurant=almaty")).response.json()
    expect(menu.source).toBe("live")
  })

  it("publish needs office.external-menu.approve", async () => {
    const { t } = await setup()
    const admin = await office(t)
    await t.run(async (ctx) => {
      await ctx.db.insert("officeRoles", { externalId: "editor", name: "Редактор", capabilities: ["office.external-menu.view", "office.external-menu.edit"], system: false })
      await ctx.db.insert("officeUsers", { externalId: "editor", email: "editor@sandyq.test", name: "Редактор", roleExternalId: "editor", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    })
    const editor = t.withIdentity({ email: "editor@sandyq.test" })
    const menus = api.domains.integrations.externalMenu
    const recordExternalId = await editor.mutation(menus.saveExternalMenu, { name: "Сайт", channel: "website", mode: "live", restaurantExternalIds: ["*"] })
    await expect(editor.mutation(menus.publishExternalMenu, { recordExternalId })).rejects.toThrow(/Недостаточно прав/)
    expect(await admin.mutation(menus.publishExternalMenu, { recordExternalId })).toEqual({ restaurants: 0 })
  })
})
