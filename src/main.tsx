import { StrictMode } from "react"
import { ConvexProvider, ConvexReactClient } from "convex/react"
import { createRoot } from "react-dom/client"

import App from "@/App"
import "@/shared/styles/index.css"

const convexUrl = import.meta.env.VITE_CONVEX_URL
if (!convexUrl) throw new Error("VITE_CONVEX_URL is required")
const convex = new ConvexReactClient(convexUrl)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>,
)
