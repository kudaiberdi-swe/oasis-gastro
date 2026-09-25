import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { useCan } from "@/office/components/can"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

// Office «Гости», «Программы лояльности», «Категории гостей» (W1-LOY-04/05/06) over
// convex/domains/loyalty/office.ts. Queries a role may not have are skipped, not thrown.

const office = api.domains.loyalty.office

export const GUESTS_PAGE_SIZE = 50

export type GuestStatus = "active" | "inactive"
export type Guest = FunctionReturnType<typeof office.listGuests>["page"][number]
export type GuestCard = NonNullable<FunctionReturnType<typeof office.getGuest>>
export type GuestAccount = GuestCard["accounts"][number]
export type GuestTransaction = GuestCard["transactions"][number]
export type GuestConsent = GuestCard["consents"][number]
export type ConsentChannel = GuestConsent["channel"]
export type SaveGuestArgs = FunctionArgs<typeof office.saveGuest>
export type LoyaltyProgram = FunctionReturnType<typeof office.listPrograms>[number]
export type ProgramStatus = LoyaltyProgram["status"]
export type SaveProgramArgs = FunctionArgs<typeof office.saveProgram>
export type ProgramOverlap = FunctionReturnType<typeof office.saveProgram>["overlaps"][number]
export type GuestCategory = FunctionReturnType<typeof office.listCategories>[number]
export type SaveCategoryArgs = FunctionArgs<typeof office.saveCategory>

export function useGuests(args: { status?: GuestStatus; search?: string; restaurantExternalId?: string }) {
  return usePaginatedQuery(office.listGuests, args, {
    initialNumItems: GUESTS_PAGE_SIZE,
  })
}

export function useGuest(guestId: string | null) {
  return useQuery(office.getGuest, guestId ? { guestId: guestId as Id<"guests"> } : "skip")
}

export function useGuestSummary() {
  return useQuery(office.guestSummary, {})
}

export function useGuestMutations() {
  return {
    saveGuest: useMutation(office.saveGuest),
    recordConsent: useMutation(office.recordConsent),
    setGuestStatus: useMutation(office.setGuestStatus),
    adjustBalance: useMutation(office.adjustBalance),
  }
}

/** Programs, or [] for a role without office.loyalty-programs.view (the guest card only names them). */
export function usePrograms(status?: ProgramStatus) {
  const canView = useCan("office.loyalty-programs.view")
  const programs = useQuery(office.listPrograms, canView ? (status ? { status } : {}) : "skip")
  return { programs: canView ? programs : [], canView }
}

export function useProgramMutations() {
  return {
    saveProgram: useMutation(office.saveProgram),
    transitionProgram: useMutation(office.transitionProgram),
  }
}

/** Categories, or [] for a role without office.guest-categories.view. */
export function useCategories() {
  const canView = useCan("office.guest-categories.view")
  const categories = useQuery(office.listCategories, canView ? {} : "skip")
  return { categories: canView ? categories : [], canView }
}

export function useSaveCategory() {
  return useMutation(office.saveCategory)
}
