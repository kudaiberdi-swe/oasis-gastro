import { createContext, useContext, type ReactNode } from "react"

import type { StatusDomain } from "@/shared/lib/status-dictionary"

// The few words the shared primitives say themselves: the dialog's close button, the PIN pad, loading
// rows and status pills. Russian by default — the office never sets them; the POS passes its interface
// language (src/pos/i18n) through UiLabelsProvider, so the same primitives read in Kazakh there.

export type UiLabels = {
  close: string
  erase: string
  loading: string
  /** «PIN-код: введено 2 из 6» — the PIN pad's live status for screen readers. */
  entered: (label: string, count: number, max: number) => string
  /** A status label in the interface language; undefined keeps the dictionary's Russian one. */
  status?: (domain: StatusDomain, status: string) => string | undefined
}

export const RU_UI_LABELS: UiLabels = {
  close: "Закрыть",
  erase: "Стереть",
  loading: "Загрузка",
  entered: (label, count, max) => `${label}: введено ${count} из ${max}`,
}

const UiLabelsContext = createContext<UiLabels>(RU_UI_LABELS)

export function UiLabelsProvider({ labels, children }: { labels: UiLabels; children: ReactNode }) {
  return <UiLabelsContext.Provider value={labels}>{children}</UiLabelsContext.Provider>
}

export function useUiLabels() {
  return useContext(UiLabelsContext)
}
