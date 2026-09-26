import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"

import type { DraftErrors } from "./loyalty-model"
import { almatyMoment, almatyParts } from "./reservations"

// Pure rules of «Рассылки и акции» (W3-LOY-08): approval tabs, the card draft and the client checks that
// mirror convex/domains/loyalty/campaigns.ts saveCampaign, the SMS counter. The server checks again.

export type CampaignStatus = "draft" | "pending-approval" | "approved" | "completed" | "cancelled"
export type CampaignChannel = "sms" | "email"
export type CampaignAction = "submit" | "approve" | "complete" | "cancel"

/** OFFICE-DESIGN §3.5 approval: «Проведённые» — campaigns closed after sending. */
export const CAMPAIGN_TABS = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновики" },
  { value: "pending-approval", label: "На согласовании" },
  { value: "approved", label: "Согласованные" },
  { value: "completed", label: "Проведённые" },
] as const

export type CampaignTab = (typeof CAMPAIGN_TABS)[number]["value"]

export const CHANNEL_LABELS: Record<CampaignChannel, string> = { sms: "SMS", email: "Email" }

export const ALL_RESTAURANTS = "*"
export const NO_CATEGORY = "__all-guests__"

export const NEXT_ACTION: Partial<Record<CampaignStatus, { action: Exclude<CampaignAction, "cancel">; capability: string; idle: string; busy: string; done: string; failed: string }>> = {
  draft: { action: "submit", capability: "office.campaigns.edit", idle: "Отправить на согласование", busy: "Отправка…", done: "Кампания отправлена на согласование", failed: "Не удалось отправить на согласование" },
  "pending-approval": { action: "approve", capability: "office.campaigns.approve", idle: "Согласовать и запустить", busy: "Согласование…", done: "Кампания согласована — сообщения ставятся в очередь", failed: "Не удалось согласовать" },
  approved: { action: "complete", capability: "office.campaigns.post", idle: "Провести", busy: "Проведение…", done: "Кампания проведена", failed: "Не удалось провести" },
}

export const CANCELLABLE: readonly CampaignStatus[] = ["draft", "pending-approval", "approved"]

export const HOUR_OPTIONS = Array.from({ length: 25 }, (_, hour) => ({ value: String(hour), label: `${String(hour).padStart(2, "0")}:00` }))

/** SMS length: Cyrillic goes as UCS-2 — 70 characters in one SMS, 67 per part in a long one. */
export function smsInfo(text: string) {
  const unicode = /[^\x20-\x7E\n\r]/.test(text)
  const single = unicode ? 70 : 160
  const part = unicode ? 67 : 153
  const parts = text.length === 0 ? 0 : text.length <= single ? 1 : Math.ceil(text.length / part)
  return { length: text.length, parts, limit: parts <= 1 ? single : part * parts }
}

export const MAX_TEMPLATE = 1000

/** «20.12, 22:00 · 09:00–20:00» — launch and the daily window of sending. */
export function formatCampaignPeriod(campaign: { scheduledAt: number; quietHoursStart: number; quietHoursEnd: number }) {
  const hour = (value: number) => `${String(value).padStart(2, "0")}:00`
  return { launch: formatAlmatyDateTime(campaign.scheduledAt), window: `${hour(campaign.quietHoursStart)}–${hour(campaign.quietHoursEnd)}` }
}

export interface CampaignDraft {
  name: string
  channel: CampaignChannel
  categoryExternalId: string
  restaurantExternalIds: string[]
  date: string
  time: string
  quietHoursStart: string
  quietHoursEnd: string
  subject: string
  template: string
}

type CampaignLike = {
  name: string
  channel: CampaignChannel
  categoryExternalId?: string
  restaurantExternalIds: string[]
  scheduledAt: number
  quietHoursStart: number
  quietHoursEnd: number
  subject?: string
  template: string
  externalId: string
  version: number
}

/** A new campaign starts tomorrow at 12:00 Almaty, sent 10:00–20:00. */
export function campaignDraftOf(card: CampaignLike | null, defaultRestaurants: string[], now = Date.now()): CampaignDraft {
  if (!card) {
    const tomorrow = almatyParts(now + 86_400_000)
    return { name: "", channel: "sms", categoryExternalId: "", restaurantExternalIds: defaultRestaurants, date: tomorrow.date, time: "12:00", quietHoursStart: "10", quietHoursEnd: "20", subject: "", template: "" }
  }
  const launch = almatyParts(card.scheduledAt)
  return {
    name: card.name,
    channel: card.channel,
    categoryExternalId: card.categoryExternalId ?? "",
    restaurantExternalIds: card.restaurantExternalIds,
    date: launch.date,
    time: launch.time,
    quietHoursStart: String(card.quietHoursStart),
    quietHoursEnd: String(card.quietHoursEnd),
    subject: card.subject ?? "",
    template: card.template,
  }
}

export function validateCampaign(draft: CampaignDraft): DraftErrors<keyof CampaignDraft> {
  const errors: DraftErrors<keyof CampaignDraft> = {}
  if (draft.name.trim().length < 2) errors.name = "Укажите название кампании"
  if (!draft.restaurantExternalIds.length) errors.restaurantExternalIds = "Выберите рестораны"
  if (almatyMoment(draft.date, draft.time) === null) errors.time = "Укажите дату и время запуска"
  if (Number(draft.quietHoursStart) >= Number(draft.quietHoursEnd)) errors.quietHoursEnd = "«Не позже» должно быть позже «Не раньше»"
  if (draft.channel === "email" && !draft.subject.trim()) errors.subject = "Укажите тему письма"
  if (!draft.template.trim()) errors.template = "Напишите текст сообщения"
  else if (draft.template.length > MAX_TEMPLATE) errors.template = `Не длиннее ${MAX_TEMPLATE} символов`
  return errors
}

export function campaignSaveArgs(draft: CampaignDraft, card: Pick<CampaignLike, "externalId" | "version"> | null) {
  return {
    ...(card ? { externalId: card.externalId, expectedVersion: card.version } : {}),
    name: draft.name.trim(),
    channel: draft.channel,
    ...(draft.categoryExternalId ? { categoryExternalId: draft.categoryExternalId } : {}),
    restaurantExternalIds: draft.restaurantExternalIds,
    scheduledAt: almatyMoment(draft.date, draft.time) ?? 0,
    quietHoursStart: Number(draft.quietHoursStart),
    quietHoursEnd: Number(draft.quietHoursEnd),
    ...(draft.channel === "email" ? { subject: draft.subject.trim() } : {}),
    template: draft.template.trim(),
  }
}

/** «Будет отправлено N гостям с согласием» — «не меньше N», when only the first 200 guests were counted. */
export function audienceLine(audience: { count: number; capped: boolean } | undefined) {
  if (!audience) return "Считаем получателей…"
  const guests = (count: number) => {
    const mod10 = count % 10
    const mod100 = count % 100
    return mod10 === 1 && mod100 !== 11 ? "гостю" : "гостям"
  }
  return audience.capped ? `Будет отправлено не меньше чем ${audience.count} ${guests(audience.count)} с согласием` : `Будет отправлено ${audience.count} ${guests(audience.count)} с согласием`
}
