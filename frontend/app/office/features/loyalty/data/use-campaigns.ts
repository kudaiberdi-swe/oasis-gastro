import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"
import type { CampaignChannel, CampaignStatus } from "../model/campaigns"

// «Рассылки и акции» (W3-LOY-08) over convex/domains/loyalty/campaigns.ts. The server checks the rights,
// the restaurant scope and the consents again.

const campaigns = api.domains.loyalty.campaigns

export const CAMPAIGNS_PAGE_SIZE = 50

export type CampaignRow = FunctionReturnType<typeof campaigns.listCampaigns>["page"][number]
export type CampaignCard = NonNullable<FunctionReturnType<typeof campaigns.getCampaign>>

export function useCampaigns(args: { status?: CampaignStatus; search?: string }) {
  return usePaginatedQuery(campaigns.listCampaigns, args, { initialNumItems: CAMPAIGNS_PAGE_SIZE })
}

export function useCampaign(externalId: string | null) {
  return useQuery(campaigns.getCampaign, externalId ? { externalId } : "skip")
}

export function useCampaignReferences() {
  return useQuery(campaigns.campaignReferences, {})
}

/** The preview of recipients for the card's channel, category and restaurants. */
export function useCampaignAudience(args: { channel: CampaignChannel; categoryExternalId?: string; restaurantExternalIds: string[] } | null) {
  return useQuery(campaigns.campaignAudience, args && args.restaurantExternalIds.length ? args : "skip")
}

export function useCampaignMutations() {
  return {
    saveCampaign: useMutation(campaigns.saveCampaign),
    transitionCampaign: useMutation(campaigns.transitionCampaign),
  }
}
