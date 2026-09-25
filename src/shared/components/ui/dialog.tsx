import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn, focusRingClass } from "@/shared/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close
const DialogPortal = DialogPrimitive.Portal

// L-5: a closing overlay must not swallow the next click, so it stops catching pointers at once,
// and the close animation is a short fade (≤150ms) with no zoom.
export const overlayClass =
  "fixed inset-0 z-50 bg-overlay data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150"

// Never taller than the visible viewport (100dvh follows the mobile toolbars): what does not fit scrolls
// inside the dialog, never past the screen edge.
export const contentClass = cn(
  "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-5 overflow-auto overscroll-contain rounded-panel border border-border bg-card p-6 text-card-foreground shadow-float data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150",
  focusRingClass,
)

const DialogOverlay = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  ({ className, ...props }, ref) => <DialogPrimitive.Overlay ref={ref} className={cn(overlayClass, className)} {...props} />,
)
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(({ className, children, hideClose = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content ref={ref} className={cn(contentClass, className)} {...props}>
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          aria-label="Закрыть"
          className={cn("absolute top-3 right-3 grid size-11 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", focusRingClass)}
        >
          <X className="size-5" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex flex-col gap-1.5 pr-10", className)} {...props} />

/**
 * The scrolling middle of a long dialog: with `DialogContent className="flex flex-col"` the header and
 * DialogFooter stay in view and only the body scrolls (a banner appearing on top no longer pushes the
 * buttons off screen). The inset keeps the fields' focus outline unclipped.
 */
const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("-m-1.5 min-h-0 overflow-y-auto overscroll-contain p-1.5", className)} {...props} />
)

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:sm:min-w-32", className)} {...props} />
)

/** Cormorant 600, 22px (POS-DESIGN §5 Dialog). */
const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  ({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} className={cn("font-display text-title font-semibold", className)} {...props} />,
)
DialogTitle.displayName = DialogPrimitive.Title.displayName

/** The "whisper" line under the title. */
const DialogDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  ({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} className={cn("text-body-sm text-muted-foreground", className)} {...props} />,
)
DialogDescription.displayName = DialogPrimitive.Description.displayName

export { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger }
