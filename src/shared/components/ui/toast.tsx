import * as React from "react"

import { cn } from "@/shared/lib/utils"

type ToastTone = "info" | "success" | "error"
type ToastItem = { id: number; message: React.ReactNode; tone: ToastTone }

const ToastContext = React.createContext<((message: React.ReactNode, tone?: ToastTone) => void) | null>(null)

const TOAST_MS = 4000

/** Bottom-center, --nav background, 4 seconds; errors are announced as alerts. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const nextId = React.useRef(0)

  const show = React.useCallback((message: React.ReactNode, tone: ToastTone = "info") => {
    const id = ++nextId.current
    setItems((current) => [...current.slice(-2), { id, message, tone }])
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), TOAST_MS)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto max-w-md rounded-card bg-nav px-4 py-3 text-body-sm text-nav-foreground shadow-float animate-in fade-in-0 slide-in-from-bottom-2",
              item.tone === "error" && "border-l-4 border-destructive",
              item.tone === "success" && "border-l-4 border-success",
            )}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const show = React.useContext(ToastContext)
  if (!show) throw new Error("useToast must be used inside ToastProvider")
  return show
}
