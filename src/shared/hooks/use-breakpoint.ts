import { useEffect, useState } from "react"

/** OFFICE-DESIGN §8: <1024 mobile (view mode), 1024–1279 tablet, 1280–1439 laptop, ≥1440 desktop. */
export type Breakpoint = "mobile" | "tablet" | "laptop" | "desktop"

export function breakpointForWidth(width: number): Breakpoint {
  if (width < 1024) return "mobile"
  if (width < 1280) return "tablet"
  if (width < 1440) return "laptop"
  return "desktop"
}

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => (typeof window === "undefined" ? "desktop" : breakpointForWidth(window.innerWidth)))
  useEffect(() => {
    const onResize = () => setBreakpoint(breakpointForWidth(window.innerWidth))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return breakpoint
}
