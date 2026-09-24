import { StrictMode } from "react"
import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { ConvexReactClient } from "convex/react"
import { createRoot } from "react-dom/client"

import App from "@/App"
import { ThemeProvider } from "@/shared/components/theme-provider"
import "@fontsource/golos-text/400.css"
import "@fontsource/golos-text/500.css"
import "@fontsource/golos-text/600.css"
import "@fontsource/golos-text/700.css"
import "@fontsource/cormorant/500.css"
import "@fontsource/cormorant/600.css"
import "@fontsource/cormorant/500-italic.css"
import "@/shared/styles/index.css"

const convexUrl = import.meta.env.VITE_CONVEX_URL
if (!convexUrl) throw new Error("VITE_CONVEX_URL is required")
const convex = new ConvexReactClient(convexUrl)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ConvexAuthProvider>
  </StrictMode>,
)
