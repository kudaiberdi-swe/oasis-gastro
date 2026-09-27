import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "@/shared/lib/utils"

import { Button } from "./button"
import { contentClass, overlayClass } from "./dialog"
import { Field } from "./field"
import { Textarea } from "./textarea"

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Asks for a reason (cancel, refund, write-off); confirm stays disabled until it is filled. */
  reasonLabel?: string
  danger?: boolean
  submitting?: boolean
  error?: React.ReactNode
  onConfirm: (reason: string) => void | Promise<void>
}

/** Confirmation for dangerous actions: focus starts on Cancel, the filled danger button only here. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Отмена",
  reasonLabel,
  danger = true,
  submitting = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = React.useState("")
  React.useEffect(() => {
    if (open) setReason("")
  }, [open])
  const blocked = submitting || (reasonLabel !== undefined && reason.trim() === "")

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={overlayClass} />
        <AlertDialogPrimitive.Content className={cn(contentClass, "max-w-md")}>
          <div className="flex flex-col gap-1.5">
            <AlertDialogPrimitive.Title className="font-display text-title font-semibold">{title}</AlertDialogPrimitive.Title>
            {description ? <AlertDialogPrimitive.Description className="text-body-sm text-muted-foreground">{description}</AlertDialogPrimitive.Description> : null}
          </div>
          {reasonLabel !== undefined ? (
            <Field label={reasonLabel}>{(control) => <Textarea {...control} value={reason} onChange={(event) => setReason(event.target.value)} />}</Field>
          ) : null}
          {error ? (
            <p role="alert" className="text-body-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="secondary" disabled={submitting}>
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button variant={danger ? "danger-solid" : "primary"} disabled={blocked} onClick={() => void onConfirm(reason.trim())}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}
