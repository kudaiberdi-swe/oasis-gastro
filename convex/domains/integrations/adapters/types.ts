import type { Doc } from "../../../_generated/dataModel"
import type { IntegrationCardModule } from "../validators"

// Provider adapter contract (W3-INT-06). The queue (internal.ts processIntegrationJobs) claims due jobs,
// calls the adapter of job.provider in an action and records the outcome. Connecting a real provider is
// one adapter file plus its card — nothing else changes.

export type AdapterJob = Pick<Doc<"integrationJobs">, "externalId" | "provider" | "operation" | "payload" | "idempotencyKey" | "attempts" | "organizationExternalId">

/** The published card of the provider's section (secrets never included — secretRef is an env name). */
export type AdapterCard = Pick<Doc<"integrationCards">, "number" | "name" | "provider" | "mode" | "endpoint" | "secretRef" | "maxAttempts" | "settings">

/** Contact resolved at send time from the guest (jobs keep only the guest id and a masked contact). */
export type AdapterRecipient = { phone?: string; email?: string }

export type AdapterContext = {
  card: AdapterCard | null
  recipient: AdapterRecipient | null
  env: (name: string) => string | undefined
  fetch: typeof fetch
}

/**
 * ok — delivered; retry — temporary (network, 5xx, 429): exponential backoff up to maxAttempts;
 * failed — the provider refused it for good; not-configured — no provider or key: straight to dead-letter.
 */
export type AdapterResult = { status: "ok"; result?: unknown } | { status: "retry"; error: string } | { status: "failed"; error: string } | { status: "not-configured"; error: string }

export interface ProviderAdapter {
  /** integrationJobs.provider this adapter serves. */
  provider: string
  /** The «Обмен и интеграции» section whose published card configures it. */
  cardModuleId: IntegrationCardModule | null
  /** Whether the provider can work right now (a key in env); callers that must answer at once (outgoing call) ask this. */
  configured: (env: AdapterContext["env"]) => boolean
  send: (job: AdapterJob, context: AdapterContext) => Promise<AdapterResult>
}

export const NOT_CONNECTED = "Провайдер не подключён"

/** An adapter for a section whose provider is not chosen yet: every job goes to dead-letter with the reason. */
export function notConnectedAdapter(provider: string, cardModuleId: IntegrationCardModule | null, label: string): ProviderAdapter {
  return {
    provider,
    cardModuleId,
    configured: () => false,
    send: async () => ({ status: "not-configured", error: `${NOT_CONNECTED}: ${label}` }),
  }
}

/** Status classes of an HTTP answer: 429 and 5xx are worth another try, other 4xx are final. */
export function httpFailure(service: string, status: number, detail?: string): AdapterResult {
  const error = `${service}: HTTP ${status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`
  return status === 429 || status >= 500 ? { status: "retry", error } : { status: "failed", error }
}
