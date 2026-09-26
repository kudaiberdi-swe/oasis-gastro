import { convexTest } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"

import { api } from "../../convex/_generated/api"
import { phoneVariants } from "../../convex/domains/telephony/internal"
import { safeRecordingUrl } from "../../convex/domains/telephony/providers"
import { signRequest } from "../../convex/lib/hmac"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

// Telephony journal and the signed provider webhook (W3-DLV-09). Phones are synthetic.

const SECRET = "test-telephony-secret"
const PATH = "/api/v1/webhooks/telephony"

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "astana", organizationExternalId: "sandyq", name: "Астана", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "operator", name: "Оператор", capabilities: ["office.telephony.view", "office.telephony.edit"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "operator", email: "operator@sandyq.test", name: "Оператор", roleExternalId: "operator", restaurantScopes: ["astana"], active: true })
    await ctx.db.insert("guests", { phone: "77012223344", name: "Дана", points: 0, createdAt: 0, externalId: "guest-1", status: "active", consentState: "granted" })
    await ctx.db.insert("deliveryOrders", {
      externalId: "delivery-1", organizationExternalId: "sandyq", restaurantExternalId: "almaty", number: "DLV-2026-00001", status: "cooking", customerName: "Дана", phone: "77012223344", address: "Абая 1",
      sourceExternalId: "phone", expectedAt: 0, subtotal: 5000, deliveryFee: 0, total: 5000, paymentStatus: "unpaid", comment: "", version: 1, searchText: "dlv-2026-00001 дана 77012223344 абая 1", createdAt: 1, updatedAt: 1,
    })
  })
  return t
}

type T = Awaited<ReturnType<typeof setup>>

async function post(t: T, body: unknown, options: { secret?: string; timestamp?: number; provider?: string } = {}) {
  const text = JSON.stringify(body)
  const timestamp = String(options.timestamp ?? Date.now())
  const path = `${PATH}${options.provider ? `?provider=${options.provider}` : ""}`
  const signature = await signRequest(options.secret ?? SECRET, { timestamp, method: "POST", pathAndQuery: path, body: text })
  return t.fetch(path, { method: "POST", body: text, headers: { "Content-Type": "application/json", "x-sandyq-timestamp": timestamp, "x-sandyq-signature": signature } })
}

const call = (overrides: Record<string, unknown> = {}) => ({ callId: "c-1", direction: "inbound", status: "ringing", phone: "+7 701 222 33 44", startedAt: Date.now(), restaurantExternalId: "almaty", ...overrides })
const rows = (t: T) => t.run((ctx) => ctx.db.query("telephonyCalls").collect())

afterEach(() => vi.unstubAllEnvs())

describe("telephony webhook and call journal (W3-DLV-09)", () => {
  it("without the secret or with a wrong signature or an old timestamp the webhook answers 401", async () => {
    const t = await setup()
    expect((await post(t, call())).status).toBe(401)
    vi.stubEnv("TELEPHONY_WEBHOOK_SECRET", SECRET)
    const wrong = await post(t, call(), { secret: "another-secret" })
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: "Неверная подпись запроса" })
    expect((await post(t, call(), { timestamp: Date.now() - 6 * 60_000 })).status).toBe(401)
    expect((await post(t, call(), { provider: "unknown-pbx" })).status).toBe(400)
    expect((await post(t, { callId: "x" })).status).toBe(400)
    expect(await rows(t)).toHaveLength(0)
  })

  it("a repeated event updates the same call; a guest phone links the guest and the open delivery order", async () => {
    const t = await setup()
    vi.stubEnv("TELEPHONY_WEBHOOK_SECRET", SECRET)
    const first = await post(t, call())
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ externalId: "generic:c-1", duplicate: false })
    expect(await (await post(t, call())).json()).toMatchObject({ duplicate: true })
    await post(t, call({ status: "completed", endedAt: Date.now(), durationSeconds: 95, recordingUrl: "https://pbx.example/rec/1.mp3?token=abc" }))
    await post(t, call({ status: "ringing" }))
    const [row] = await rows(t)
    expect(await rows(t)).toHaveLength(1)
    expect(row).toMatchObject({ status: "completed", phone: "77012223344", deliveryExternalId: "delivery-1", durationSeconds: 95, recordingUrl: "https://pbx.example/rec/1.mp3" })
    expect(row.guestId).toBeTruthy()
  })

  it("the journal masks the phone without the PII right, keeps restaurant scope and shows the delivery", async () => {
    const t = await setup()
    vi.stubEnv("TELEPHONY_WEBHOOK_SECRET", SECRET)
    await post(t, call())
    await post(t, call({ callId: "c-2", phone: "77015556677", restaurantExternalId: "astana", direction: "outbound", status: "missed" }))
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const operator = t.withIdentity({ email: "operator@sandyq.test" })
    const all = await admin.query(api.domains.telephony.queries.calls, { paginationOpts: { numItems: 20, cursor: null } })
    expect(all.page.map((row) => row.externalId).sort()).toEqual(["generic:c-1", "generic:c-2"])
    expect(all.page.find((row) => row.externalId === "generic:c-1")).toMatchObject({ phone: "77012223344", deliveryNumber: "DLV-2026-00001", hasGuest: true })
    const own = await operator.query(api.domains.telephony.queries.calls, { paginationOpts: { numItems: 20, cursor: null } })
    expect(own.page.map((row) => row.externalId)).toEqual(["generic:c-2"])
    expect(own.page[0].phone).toBe("7701•••••77")
    const inbound = await admin.query(api.domains.telephony.queries.calls, { direction: "inbound", paginationOpts: { numItems: 20, cursor: null } })
    expect(inbound.page.map((row) => row.externalId)).toEqual(["generic:c-1"])
    await expect(operator.query(api.domains.telephony.queries.calls, { restaurantExternalId: "almaty", paginationOpts: { numItems: 20, cursor: null } })).rejects.toThrow(/Нет доступа/)
  })

  it("an outgoing call without a provider is refused; statuses move forward only", async () => {
    const t = await setup()
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    await expect(admin.mutation(api.domains.telephony.mutations.createCall, { phone: "77012223344", restaurantExternalId: "almaty" })).rejects.toThrow(/Провайдер телефонии не настроен/)
    await t.run((ctx) => ctx.db.insert("telephonyCalls", { externalId: "generic:c-9", provider: "generic", direction: "inbound", status: "ringing", phone: "77010000000", restaurantExternalId: "almaty", startedAt: 1 }))
    await expect(admin.mutation(api.domains.telephony.mutations.updateCall, { externalId: "generic:c-9", status: "completed" })).rejects.toThrow(/ответ/)
    await admin.mutation(api.domains.telephony.mutations.updateCall, { externalId: "generic:c-9", status: "answered" })
    await admin.mutation(api.domains.telephony.mutations.updateCall, { externalId: "generic:c-9", status: "completed" })
    await expect(admin.mutation(api.domains.telephony.mutations.updateCall, { externalId: "generic:c-9", status: "failed" })).rejects.toThrow(/завершён/)
  })

  it("helpers: phone variants and recording links without tokens", () => {
    expect(phoneVariants("87012223344")).toEqual(["87012223344", "7012223344", "77012223344"])
    expect(safeRecordingUrl("http://pbx.example/rec.mp3")).toBeUndefined()
    expect(safeRecordingUrl("https://user:pass@pbx.example/rec.mp3?sig=1#t")).toBe("https://pbx.example/rec.mp3")
  })
})
