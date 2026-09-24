import * as React from "react"

import { cn } from "@/shared/lib/utils"

type FieldControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }

export interface FieldProps {
  label: React.ReactNode
  /** Help text under the control; replaced by `error` when both are set. */
  hint?: React.ReactNode
  error?: React.ReactNode
  /** Render prop so the control gets the id, aria-describedby and aria-invalid wiring. */
  children: (control: FieldControlProps) => React.ReactNode
  className?: string
  id?: string
}

/** Label above, message below (POS-DESIGN §5): 12–14px, weight 500, sentence case, no all-caps. */
export function Field({ label, hint, error, children, className, id: idProp }: FieldProps) {
  const generatedId = React.useId()
  const id = idProp ?? generatedId
  const messageId = `${id}-message`
  const message = error ?? hint

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-body-sm font-medium text-muted-foreground">
        {label}
      </label>
      {children({ id, "aria-describedby": message ? messageId : undefined, "aria-invalid": error ? true : undefined })}
      {message ? (
        <p id={messageId} className={cn("text-caption", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined}>
          {message}
        </p>
      ) : null}
    </div>
  )
}
