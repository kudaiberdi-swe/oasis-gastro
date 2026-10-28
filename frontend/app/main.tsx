import { StrictMode } from "react"
import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { ConvexReactClient } from "convex/react"
import { createRoot } from "react-dom/client"

import App from "@/App"
import { ThemeProvider } from "@/shared/components/theme-provider"
import { ToastProvider } from "@/shared/components/ui/toast"
import "@fontsource/golos-text/400.css"
import "@fontsource/golos-text/500.css"
import "@fontsource/golos-text/600.css"
import "@fontsource/golos-text/700.css"
import "@/shared/styles/index.css"

// Sections load as separate chunks: after a deploy an open tab still points at the old ones, which the
// host no longer serves. Reload once to pick up the new build instead of failing the section; the
// timestamp stops a reload loop when the chunk is missing for another reason.
window.addEventListener("vite:preloadError", (event) => {
  const key = "oasis-chunk-reload"
  let last = 0
  try {
    last = Number(sessionStorage.getItem(key) ?? 0)
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    // Storage unavailable (private mode): still reload once per page load.
  }
  if (Date.now() - last < 10_000) return
  event.preventDefault()
  window.location.reload()
})

const convexUrl = import.meta.env.VITE_CONVEX_URL
if (!convexUrl) throw new Error("VITE_CONVEX_URL is required")
const convex = new ConvexReactClient(convexUrl)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>
    </ConvexAuthProvider>
  </StrictMode>,
)
