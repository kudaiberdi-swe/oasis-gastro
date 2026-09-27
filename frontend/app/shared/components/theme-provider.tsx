import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

export type ThemeMode = "day" | "night"
export type ThemeDensity = "comfortable" | "compact"

type ThemeContextValue = {
  mode: ThemeMode
  density: ThemeDensity
  setMode: (mode: ThemeMode) => void
  setDensity: (density: ThemeDensity) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const MODE_KEY = "sandyq-pos-theme"
const DENSITY_KEY = "sandyq-pos-density"

function getStoredValue<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    return (window.localStorage.getItem(key) as T | null) ?? fallback
  } catch {
    return fallback
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => getStoredValue(MODE_KEY, "day"))
  const [density, setDensity] = useState<ThemeDensity>(() => getStoredValue(DENSITY_KEY, "comfortable"))

  useEffect(() => {
    document.documentElement.dataset.theme = mode
    try {
      window.localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* private-mode/blocked storage — theme still applies for this session */
    }
  }, [mode])

  useEffect(() => {
    document.documentElement.dataset.density = density
    try {
      window.localStorage.setItem(DENSITY_KEY, density)
    } catch {
      /* private-mode/blocked storage — density still applies for this session */
    }
  }, [density])

  const value = useMemo(() => ({ mode, density, setMode, setDensity }), [mode, density])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error("useTheme must be used inside ThemeProvider")
  return context
}
