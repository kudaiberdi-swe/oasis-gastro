import { useCallback, useEffect, useState } from "react"

const STORAGE_KEY = "sandyq-office-nav"
const COLLAPSED_KEY = "sandyq-office-nav-collapsed"

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* blocked storage: the sidebar still works for this visit */
  }
}

/** Which groups are open (remembered per browser) — the active group is always open. */
export function useExpandedGroups(activeGroupId: string | undefined) {
  const [expanded, setExpanded] = useState<string[]>(() => read<string[]>(STORAGE_KEY, []))

  useEffect(() => {
    if (activeGroupId && !expanded.includes(activeGroupId)) setExpanded((current) => [...current, activeGroupId])
  }, [activeGroupId, expanded])

  useEffect(() => write(STORAGE_KEY, expanded), [expanded])

  const toggle = useCallback((groupId: string) => {
    setExpanded((current) => (current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]))
  }, [])

  return { expanded, toggle }
}

/** Narrow (72px) sidebar: automatic under 1280px, otherwise the user's choice. */
export function useSidebarCollapsed() {
  const [preferred, setPreferred] = useState<boolean>(() => read<boolean>(COLLAPSED_KEY, false))
  const [narrowScreen, setNarrowScreen] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(max-width: 1279px)").matches)

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 1279px)")
    if (!media) return
    const onChange = () => setNarrowScreen(media.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  const toggle = useCallback(() => {
    setPreferred((current) => {
      write(COLLAPSED_KEY, !current)
      return !current
    })
  }, [])

  return { collapsed: narrowScreen || preferred, canToggle: !narrowScreen, toggle }
}
