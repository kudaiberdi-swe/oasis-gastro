import { createContext, useContext, type ReactNode } from "react"

import { allowsCapability } from "@/office/model/capabilities"

const CapabilitiesContext = createContext<readonly string[]>([])

export function CapabilitiesProvider({ capabilities, children }: { capabilities: readonly string[]; children: ReactNode }) {
  return <CapabilitiesContext.Provider value={capabilities}>{children}</CapabilitiesContext.Provider>
}

/** The signed-in user's rights, e.g. to filter the navigation for «Быстрый доступ». */
export function useCapabilities() {
  return useContext(CapabilitiesContext)
}

export function useCan(capability: string) {
  return allowsCapability(useContext(CapabilitiesContext), capability)
}

/** Actions without the right are hidden, not disabled (OFFICE-DESIGN §7). The server checks again. */
export function Can({ capability, children, fallback = null }: { capability: string; children: ReactNode; fallback?: ReactNode }) {
  return useCan(capability) ? <>{children}</> : <>{fallback}</>
}
