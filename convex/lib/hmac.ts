// Signed requests of the Cloud API (W3-INT-03, decision Г-9). The shared secret lives only in the env
// variable CLOUD_API_SECRET — never in the database, the office or a response. Without it every route
// answers 503 «Cloud API не настроен»: the API is closed, not open.
//
// Timestamp: Unix milliseconds. Signature: hex HMAC-SHA256 of `${timestamp}.${METHOD}.${path and query}.${body}` (docs/cloud-api.md).
// The method and path are signed too, so a GET signature cannot be replayed against another restaurant.

declare const process: { env: Record<string, string | undefined> }

export const CLOUD_API_SECRET_ENV = "CLOUD_API_SECRET"
export const TIMESTAMP_HEADER = "x-sandyq-timestamp"
export const SIGNATURE_HEADER = "x-sandyq-signature"
/** ±5 minutes between the caller's clock and ours. */
export const MAX_SKEW_MS = 300_000
export const MAX_BODY_BYTES = 256 * 1024

/** A deployment env variable (the Convex runtime provides process.env; the office bundle has no node types). */
export function readEnv(name: string) {
  return process.env[name] || undefined
}

const encoder = new TextEncoder()

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function canonicalString(parts: { timestamp: string; method: string; pathAndQuery: string; body: string }) {
  return `${parts.timestamp}.${parts.method.toUpperCase()}.${parts.pathAndQuery}.${parts.body}`
}

export async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)))
}

export async function sha256Hex(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)))
}

/** The signature a caller sends (and our outgoing webhooks carry). */
export async function signRequest(secret: string, parts: { timestamp: string; method: string; pathAndQuery: string; body: string }) {
  return hmacSha256Hex(secret, canonicalString(parts))
}

/** Constant-time comparison: the time does not depend on where the strings first differ. */
export function timingSafeEqual(a: string, b: string) {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let diff = left.length ^ right.length
  for (let index = 0; index < Math.max(left.length, right.length); index++) diff |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return diff === 0
}

export type VerifyResult = { ok: true; nonceKey: string; expiresAt: number } | { ok: false; status: 401 | 503; error: string }

/**
 * Checks the timestamp window and the signature. Replay protection is the caller's next step: the
 * returned nonceKey (a hash of the signature) must be claimed once in apiNonces before expiresAt.
 */
export async function verifySignedRequest(request: Request, body: string, options: { secret: string | undefined; maxSkewMs?: number; now?: number }): Promise<VerifyResult> {
  if (!options.secret) return { ok: false, status: 503, error: "Cloud API не настроен" }
  const maxSkewMs = options.maxSkewMs ?? MAX_SKEW_MS
  const now = options.now ?? Date.now()
  const timestamp = request.headers.get(TIMESTAMP_HEADER)?.trim() ?? ""
  const signature = (request.headers.get(SIGNATURE_HEADER)?.trim() ?? "").replace(/^sha256=/i, "").toLowerCase()
  if (!/^\d{13}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return { ok: false, status: 401, error: "Нет подписи запроса" }
  const at = Number(timestamp)
  if (Math.abs(now - at) > maxSkewMs) return { ok: false, status: 401, error: "Время запроса вне допустимого окна ±5 минут" }
  const url = new URL(request.url)
  const expected = await signRequest(options.secret, { timestamp, method: request.method, pathAndQuery: `${url.pathname}${url.search}`, body })
  if (!timingSafeEqual(expected, signature)) return { ok: false, status: 401, error: "Неверная подпись запроса" }
  return { ok: true, nonceKey: `sig:${await sha256Hex(signature)}`, expiresAt: Math.max(at, now) + maxSkewMs }
}
