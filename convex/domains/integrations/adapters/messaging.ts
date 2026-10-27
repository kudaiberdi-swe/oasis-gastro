import { maskEmail, maskPhone } from "../../../lib/pii"
import { httpFailure, type AdapterContext, type AdapterJob, type AdapterResult, type ProviderAdapter } from "./types"

// SMS and e-mail (W3-INT-06, owner decision Б-B6 / Г-6): e-mail through Resend (RESEND_API_KEY,
// EMAIL_FROM), SMS through Mobizon (MOBIZON_API_KEY, SMS_SENDER). Until a key is set every job goes to
// dead-letter with «ключ не задан»; the moment the env variable exists the next retry sends. A card of
// «SMS и email» is optional: published in production it may set the sender and the channel; in sandbox
// real sending is off. Results and errors carry only a masked contact, never the full phone or address.

export const RESEND_URL = "https://api.resend.com/emails"
export const MOBIZON_URL = "https://api.mobizon.kz/service/message/sendsmsmessage"

export const PASSWORD_RESET_OPERATION = "office-user.password-reset"
/**
 * Campaign sends (W3-LOY-08; the contract the loyalty reports read, W3-RPT-04): provider «messaging»,
 * operation «send-campaign», payload {campaignExternalId, campaignName, guestId, guestExternalId, channel,
 * restaurantExternalId?, recipient (masked), subject?, text, quietHours}.
 */
export const MESSAGING_PROVIDER = "messaging"
export const CAMPAIGN_OPERATION = "send-campaign"

type Message = { subject: string; text: string }

/** The letter or SMS of a job by its operation; an unknown one is never sent blank. */
export function renderMessage(job: AdapterJob): Message | null {
  const payload = (job.payload ?? {}) as Record<string, unknown>
  if (job.operation === PASSWORD_RESET_OPERATION && typeof payload.resetToken === "string") {
    return {
      subject: "Восстановление пароля OASIS Gastro",
      text: `Код для восстановления пароля OASIS Gastro: ${payload.resetToken}\nКод действует 15 минут. Если вы не запрашивали восстановление, просто проигнорируйте это письмо.`,
    }
  }
  if (job.operation === CAMPAIGN_OPERATION && typeof payload.text === "string" && payload.text.trim()) {
    return { subject: typeof payload.subject === "string" && payload.subject.trim() ? payload.subject : "Sandyq", text: payload.text }
  }
  return null
}

/** Sandbox cards and a card whose channel excludes this one switch real sending off. */
function cardBlocks(context: AdapterContext, channel: "email" | "sms"): AdapterResult | null {
  const card = context.card
  if (!card) return null
  if (card.mode === "sandbox") return { status: "not-configured", error: `Карточка ${card.number} в режиме sandbox — реальная отправка выключена` }
  if (card.settings.channel && card.settings.channel !== "both" && card.settings.channel !== channel) {
    return { status: "not-configured", error: `Канал ${channel === "sms" ? "SMS" : "email"} выключен в карточке ${card.number}` }
  }
  return null
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json()
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const emailAdapter: ProviderAdapter = {
  provider: "email",
  cardModuleId: "integration-messaging",
  configured: (env) => Boolean(env("RESEND_API_KEY") && env("EMAIL_FROM")),
  async send(job, context) {
    const blocked = cardBlocks(context, "email")
    if (blocked) return blocked
    const key = context.env("RESEND_API_KEY")
    if (!key) return { status: "not-configured", error: "Ключ Resend не задан (RESEND_API_KEY) — провайдер email не подключён" }
    const from = context.card?.settings.sender || context.env("EMAIL_FROM")
    if (!from) return { status: "not-configured", error: "Отправитель не задан (EMAIL_FROM или «Отправитель» в карточке)" }
    const payload = (job.payload ?? {}) as Record<string, unknown>
    const to = context.recipient?.email ?? (typeof payload.to === "string" ? payload.to : undefined)
    if (!to) return { status: "failed", error: "У получателя нет email" }
    const message = renderMessage(job)
    if (!message) return { status: "failed", error: `Неизвестный шаблон письма «${job.operation}»` }
    let response: Response
    try {
      response = await context.fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": job.idempotencyKey.slice(0, 256) },
        body: JSON.stringify({ from, to: [to], subject: message.subject, text: message.text }),
      })
    } catch {
      return { status: "retry", error: "Resend: сеть недоступна" }
    }
    const body = await readJson(response)
    if (!response.ok) return httpFailure("Resend", response.status, typeof body?.message === "string" ? body.message : undefined)
    return { status: "ok", result: { provider: "resend", messageId: typeof body?.id === "string" ? body.id : null, to: maskEmail(to) } }
  },
}

/** Mobizon wants the international number: 7 701 … for Kazakhstan, 8 701 … and 701 … are rewritten. */
export function mobizonRecipient(phone: string): string | null {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `7${digits}`
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`
  return digits.length >= 11 && digits.length <= 15 ? digits : null
}

export const smsAdapter: ProviderAdapter = {
  provider: "sms",
  cardModuleId: "integration-messaging",
  configured: (env) => Boolean(env("MOBIZON_API_KEY")),
  async send(job, context) {
    const blocked = cardBlocks(context, "sms")
    if (blocked) return blocked
    const key = context.env("MOBIZON_API_KEY")
    if (!key) return { status: "not-configured", error: "Ключ Mobizon не задан (MOBIZON_API_KEY) — провайдер SMS не подключён" }
    const recipient = context.recipient?.phone ? mobizonRecipient(context.recipient.phone) : null
    if (!recipient) return { status: "failed", error: "У получателя нет корректного телефона" }
    const message = renderMessage(job)
    if (!message) return { status: "failed", error: `Неизвестный шаблон SMS «${job.operation}»` }
    const sender = context.card?.settings.sender || context.env("SMS_SENDER")
    const form = new URLSearchParams({ recipient, text: message.text, ...(sender ? { from: sender } : {}) })
    // The key goes in the query string (Mobizon API v1); it never reaches an error text or a result.
    const url = `${MOBIZON_URL}?output=json&api=v1&apiKey=${encodeURIComponent(key)}`
    let response: Response
    try {
      response = await context.fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() })
    } catch {
      return { status: "retry", error: "Mobizon: сеть недоступна" }
    }
    const body = await readJson(response)
    if (!response.ok) return httpFailure("Mobizon", response.status, typeof body?.message === "string" ? body.message : undefined)
    if (body?.code !== 0) return { status: "failed", error: `Mobizon: ${typeof body?.message === "string" && body.message ? body.message.slice(0, 200) : "отказ"} (код ${String(body?.code ?? "—")})` }
    const data = (body.data ?? {}) as Record<string, unknown>
    return { status: "ok", result: { provider: "mobizon", messageId: data.messageId ?? null, to: maskPhone(recipient) } }
  },
}

/** The campaign provider: the job's payload.channel picks Resend (email) or Mobizon (SMS). */
export const messagingAdapter: ProviderAdapter = {
  provider: MESSAGING_PROVIDER,
  cardModuleId: "integration-messaging",
  configured: (env) => emailAdapter.configured(env) || smsAdapter.configured(env),
  async send(job, context) {
    const channel = ((job.payload ?? {}) as Record<string, unknown>).channel
    if (channel === "sms") return smsAdapter.send(job, context)
    if (channel === "email") return emailAdapter.send(job, context)
    return { status: "failed", error: "Не указан канал рассылки (sms или email)" }
  },
}
