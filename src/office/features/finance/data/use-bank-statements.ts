import { useMutation, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"

// Bank statements (W3-FIN-11): typed hooks over convex/domains/finance/bankStatements. The server checks the
// rights, the restaurant scope, every line and every match again.

const bank = api.domains.finance.bankStatements

export type ImportProfile = FunctionReturnType<typeof bank.importProfiles>[number]
export type SaveImportProfileArgs = FunctionArgs<typeof bank.saveImportProfile>
export type RecentImport = FunctionReturnType<typeof bank.recentImports>[number]
export type MatchCandidates = FunctionReturnType<typeof bank.matchCandidates>
export type MatchCandidate = MatchCandidates["candidates"][number]

export function useImportProfiles() {
  return useQuery(bank.importProfiles, {})
}

export function useRecentImports(restaurantExternalId: string | undefined) {
  return useQuery(bank.recentImports, restaurantExternalId ? { restaurantExternalId } : "skip")
}

/** Candidates of a line's card; null skips (no line open). */
export function useMatchCandidates(lineExternalId: string | null) {
  return useQuery(bank.matchCandidates, lineExternalId ? { lineExternalId } : "skip")
}

export function useBankStatementMutations() {
  const importStatement = useMutation(bank.importStatement)
  const saveImportProfile = useMutation(bank.saveImportProfile)
  const autoMatch = useMutation(bank.autoMatch)
  const confirmMatch = useMutation(bank.confirmMatch)
  const unmatch = useMutation(bank.unmatch)
  return { importStatement, saveImportProfile, autoMatch, confirmMatch, unmatch }
}
