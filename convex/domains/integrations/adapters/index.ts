import { bankAdapter } from "./bank"
import { cloudApiAdapter } from "./cloudApiWebhook"
import { ediAdapter } from "./edi"
import { fiscalAdapter } from "./fiscal"
import { mapsAdapter } from "./maps"
import { emailAdapter, smsAdapter } from "./messaging"
import { oneCAdapter } from "./oneC"
import { telephonyAdapter } from "./telephony"
import type { AdapterContext, AdapterJob, AdapterResult, ProviderAdapter } from "./types"

// Registry of provider adapters by integrationJobs.provider (W3-INT-06). Anything touching iiko stays
// read-only and never runs from here.

/** The in-process event bus every outbox event goes to first; external providers get their own adapters. */
export const EVENT_BUS = "convex-event-bus"

const eventBusAdapter: ProviderAdapter = {
  provider: EVENT_BUS,
  cardModuleId: null,
  configured: () => true,
  send: async () => ({ status: "ok", result: { delivered: true } }),
}

// ЕГАИС is Russian only (D4, W3-INT-02): no job is queued for it under KZ, and one that slipped in is refused.
const egaisAdapter: ProviderAdapter = {
  provider: "egais",
  cardModuleId: "integration-egais",
  configured: () => false,
  send: async () => ({ status: "not-configured", error: "ЕГАИС не применяется в юрисдикции KZ" }),
}

export const ADAPTERS: Record<string, ProviderAdapter> = Object.fromEntries(
  [eventBusAdapter, emailAdapter, smsAdapter, mapsAdapter, telephonyAdapter, bankAdapter, fiscalAdapter, oneCAdapter, ediAdapter, egaisAdapter, cloudApiAdapter].map((adapter) => [adapter.provider, adapter]),
)

export function adapterFor(provider: string): ProviderAdapter | undefined {
  return ADAPTERS[provider]
}

/** Job providers configured by a card section — the card's «Последняя синхронизация» and «Ошибок». */
export function providersOfCard(moduleId: string): string[] {
  return Object.values(ADAPTERS)
    .filter((adapter) => adapter.cardModuleId === moduleId)
    .map((adapter) => adapter.provider)
}

/** Runs one job through its adapter; a thrown error is a temporary failure, never a lost job. */
export async function runAdapter(job: AdapterJob, context: AdapterContext): Promise<AdapterResult> {
  const adapter = adapterFor(job.provider)
  if (!adapter) return { status: "not-configured", error: `Адаптер «${job.provider}» не настроен — провайдер не подключён` }
  try {
    return await adapter.send(job, context)
  } catch (error) {
    return { status: "retry", error: `Сбой адаптера «${job.provider}»: ${error instanceof Error ? error.message.slice(0, 200) : "неизвестная ошибка"}` }
  }
}
