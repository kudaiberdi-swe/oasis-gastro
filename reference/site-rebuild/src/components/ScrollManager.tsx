import { useEffect } from "react"
import { useLocation } from "react-router"

/** Scrolls to the #hash target after navigation, or to the top on a new page. */
export function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)))
      if (target) {
        target.scrollIntoView({ block: "start" })
        return
      }
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}
