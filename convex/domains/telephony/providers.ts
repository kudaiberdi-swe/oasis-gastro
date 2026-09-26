// Provider mapping of incoming telephony webhooks (W3-DLV-09). The PBX is not chosen yet (B-INT-1), so
// only the documented generic shape is mapped; a real provider is one more entry in TELEPHONY_MAPPERS that
// turns its payload into a CallEvent. Nothing here stores secrets or tokens.

export type CallDirection = "inbound" | "outbound"
export type CallStatus = "ringing" | "answered" | "missed" | "completed" | "failed"

export type CallEvent = {
  callId: string
  direction: CallDirection
  status: CallStatus
  phone: string
  startedAt: number
  answeredAt?: number
  endedAt?: number
  durationSeconds?: number
  restaurantExternalId?: string
  operatorKey?: string
  recordingUrl?: string
}

export const GENERIC_PROVIDER = "generic"

const STATUSES: CallStatus[] = ["ringing", "answered", "missed", "completed", "failed"]

function time(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const text = (value: unknown, max = 200) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined)

/** A recording link without its query string, fragment or credentials: providers put access tokens there. */
export function safeRecordingUrl(value: unknown): string | undefined {
  const raw = text(value, 2000)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:") return undefined
    return `${url.origin}${url.pathname}`
  } catch {
    return undefined
  }
}

/**
 * The generic shape: { callId, direction: inbound|outbound, status: ringing|answered|missed|completed|failed,
 * phone, startedAt (ms, s or ISO), answeredAt?, endedAt?, durationSeconds?, restaurantExternalId?,
 * operatorKey?, recordingUrl? }.
 */
function mapGeneric(body: unknown): CallEvent | null {
  if (!body || typeof body !== "object") return null
  const row = body as Record<string, unknown>
  const callId = text(row.callId, 120)
  const direction = row.direction === "inbound" || row.direction === "outbound" ? row.direction : null
  const status = STATUSES.includes(row.status as CallStatus) ? (row.status as CallStatus) : null
  const phone = typeof row.phone === "string" ? row.phone.replace(/\D/g, "") : ""
  const startedAt = time(row.startedAt)
  if (!callId || !direction || !status || phone.length < 6 || phone.length > 15 || startedAt === undefined) return null
  const duration = typeof row.durationSeconds === "number" && row.durationSeconds >= 0 ? Math.round(row.durationSeconds) : undefined
  return {
    callId,
    direction,
    status,
    phone,
    startedAt,
    ...(time(row.answeredAt) !== undefined ? { answeredAt: time(row.answeredAt) } : {}),
    ...(time(row.endedAt) !== undefined ? { endedAt: time(row.endedAt) } : {}),
    ...(duration !== undefined ? { durationSeconds: duration } : {}),
    ...(text(row.restaurantExternalId) ? { restaurantExternalId: text(row.restaurantExternalId) } : {}),
    ...(text(row.operatorKey) ? { operatorKey: text(row.operatorKey) } : {}),
    ...(safeRecordingUrl(row.recordingUrl) ? { recordingUrl: safeRecordingUrl(row.recordingUrl) } : {}),
  }
}

export const TELEPHONY_MAPPERS: Record<string, (body: unknown) => CallEvent | null> = {
  [GENERIC_PROVIDER]: mapGeneric,
}
