import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import type { ReactNode } from "react"

import { overlayClass } from "@/shared/components/ui/dialog"
import { useBreakpoint } from "@/shared/hooks/use-breakpoint"
import { cn, focusRingClass } from "@/shared/lib/utils"

export interface RightPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
}

/**
 * Master-detail side panel, 440px. At ≥1440 it sits beside the list; below that it slides over the
 * content (OFFICE-DESIGN §8).
 */
export function RightPanel({ open, onOpenChange, title, children, footer }: RightPanelProps) {
  const breakpoint = useBreakpoint()
  if (!open) return null

  const titleClass = "font-display text-title font-semibold"
  const header = (heading: ReactNode, close: ReactNode) => (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
      {heading}
      {close}
    </div>
  )
  const closeButtonClass = cn("grid size-11 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground", focusRingClass)
  const body = (
    <>
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
      {/* Footer: the buttons stay on one row inside the 440px panel (compact padding); «● Есть несохранённые
          изменения» (SaveStatus, role=status) takes its own line above them instead of wrapping or leaving the panel. */}
      {footer ? (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1.5 border-t border-border px-5 py-3 [&>[role=status]]:basis-full [&>[role=status]]:justify-end [&>button]:px-3">
          {footer}
        </div>
      ) : null}
    </>
  )

  if (breakpoint === "desktop") {
    return (
      <aside aria-label={typeof title === "string" ? title : undefined} className="flex w-[440px] shrink-0 flex-col border-l border-border bg-card">
        {header(
          <h2 className={titleClass}>{title}</h2>,
          <button type="button" aria-label="Закрыть" className={closeButtonClass} onClick={() => onOpenChange(false)}>
            <X className="size-5" />
          </button>,
        )}
        {body}
      </aside>
    )
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col bg-card shadow-float data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:pointer-events-none",
            focusRingClass,
          )}
        >
          {header(
            <DialogPrimitive.Title className={titleClass}>{title}</DialogPrimitive.Title>,
            <DialogPrimitive.Close aria-label="Закрыть" className={closeButtonClass}>
              <X className="size-5" />
            </DialogPrimitive.Close>,
          )}
          {body}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
