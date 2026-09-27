import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"

// W3-HR-07/08: office hooks over convex/domains/workforce/{motivation,medical}.ts.
// The server checks every right and restaurant scope again and masks medical personal data.

const motivation = api.domains.workforce.motivation
const medical = api.domains.workforce.medical

export const W3_PAGE_SIZE = 50

// ── Motivation ───────────────────────────────────────────────────────────────

export function useMotivationList(args: { status?: MotivationStatus; search: string; restaurantExternalId?: string; enabled: boolean }) {
  return usePaginatedQuery(
    motivation.list,
    args.enabled ? { status: args.status, search: args.search.trim() || undefined, restaurantExternalId: args.restaurantExternalId } : "skip",
    { initialNumItems: W3_PAGE_SIZE },
  )
}

/** undefined while loading, null when missing or outside the user's restaurants. */
export function useMotivationProgram(externalId: string | null) {
  return useQuery(motivation.get, externalId ? { externalId } : "skip")
}

export function useMotivationResults(externalId: string | null) {
  return useQuery(motivation.results, externalId ? { externalId } : "skip")
}

export function useMotivationMutations() {
  return { save: useMutation(motivation.save), transition: useMutation(motivation.transition), accrue: useMutation(motivation.accrue) }
}

// ── Medical records ──────────────────────────────────────────────────────────

export function useMedicalList(args: { status?: MedicalStatus; search: string; restaurantExternalId?: string; expiringWithinDays?: number; enabled: boolean }) {
  return usePaginatedQuery(
    medical.list,
    args.enabled ? { status: args.status, search: args.search.trim() || undefined, restaurantExternalId: args.restaurantExternalId, expiringWithinDays: args.expiringWithinDays } : "skip",
    { initialNumItems: W3_PAGE_SIZE },
  )
}

export function useMedicalRecord(externalId: string | null) {
  return useQuery(medical.get, externalId ? { externalId } : "skip")
}

export function useExpiringMedical(restaurantExternalId: string | undefined, enabled = true) {
  return useQuery(medical.expiringMedicalRecords, enabled ? { restaurantExternalId, withinDays: 30 } : "skip")
}

export function useMedicalSettings(enabled = true) {
  return useQuery(medical.settings, enabled ? {} : "skip")
}

export function useMedicalMutations() {
  return { save: useMutation(medical.save), transition: useMutation(medical.transition), saveSettings: useMutation(medical.saveSettings) }
}

export type MotivationRow = FunctionReturnType<typeof motivation.list>["page"][number]
export type MotivationProgram = NonNullable<FunctionReturnType<typeof motivation.get>>
export type MotivationStatus = MotivationRow["status"]
export type MotivationResults = NonNullable<FunctionReturnType<typeof motivation.results>>
export type MotivationResultRow = MotivationResults["rows"][number]
export type SaveMotivationArgs = FunctionArgs<typeof motivation.save>
export type MotivationAction = FunctionArgs<typeof motivation.transition>["action"]
export type MedicalRow = FunctionReturnType<typeof medical.list>["page"][number]
export type MedicalRecord = NonNullable<FunctionReturnType<typeof medical.get>>
export type MedicalStatus = MedicalRow["status"]
export type SaveMedicalArgs = FunctionArgs<typeof medical.save>
export type MedicalAction = FunctionArgs<typeof medical.transition>["action"]
export type ExpiringMedical = FunctionReturnType<typeof medical.expiringMedicalRecords>
