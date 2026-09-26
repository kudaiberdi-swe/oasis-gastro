import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"
import type { CardModuleId, CardStatus } from "../model/cards"

// Integration cards (W3-INT-01) over convex/domains/integrations/cards.ts. Secrets never reach the office:
// a card carries only the env variable's name and whether it is set.

const cards = api.domains.integrations.cards

export const CARDS_PAGE_SIZE = 50

export type CardRow = FunctionReturnType<typeof cards.listIntegrationCards>["page"][number]
export type CardDetails = NonNullable<FunctionReturnType<typeof cards.getIntegrationCard>>
export type SaveCardArgs = FunctionArgs<typeof cards.saveIntegrationCard>

export function useIntegrationCards(moduleId: CardModuleId, args: { status?: CardStatus; search?: string }) {
  return usePaginatedQuery(cards.listIntegrationCards, { moduleId, ...args }, { initialNumItems: CARDS_PAGE_SIZE })
}

export function useIntegrationCard(externalId: string | null) {
  return useQuery(cards.getIntegrationCard, externalId ? { externalId } : "skip")
}

export function useIntegrationReferences(moduleId: string) {
  return useQuery(cards.integrationReferences, { moduleId: moduleId as SaveCardArgs["moduleId"] })
}

export function useProviderKeys(moduleId: CardModuleId) {
  return useQuery(cards.providerKeys, { moduleId })
}

export function useIntegrationCardMutations() {
  const save = useMutation(cards.saveIntegrationCard)
  return {
    /** The model builds settings per section; the server validates each field against the section. */
    saveCard: (args: Omit<SaveCardArgs, "settings"> & { settings: Record<string, string | string[]> }) => save(args as SaveCardArgs),
    transitionCard: useMutation(cards.transitionIntegrationCard),
  }
}
