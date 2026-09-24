import { useState } from "react"

import { Button } from "@/shared/components/ui/button"
import { errorMessage } from "@/shared/lib/error-message"

export function OfficeBootstrap({ email, onBootstrap, onSignOut }: { email: string | null; onBootstrap: () => Promise<unknown>; onSignOut: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleBootstrap() {
    setSubmitting(true)
    setError(null)
    try {
      await onBootstrap()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось инициализировать офис"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <p className="text-lg font-extrabold text-foreground">Офис ещё не настроен</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Учётная запись <span className="font-semibold text-foreground">{email}</span> может стать первым администратором офиса, если она указана как OFFICE_BOOTSTRAP_EMAIL.
      </p>
      {error && <p className="max-w-sm text-sm font-semibold text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onSignOut}>Выйти</Button>
        <Button onClick={handleBootstrap} disabled={submitting}>{submitting ? "Инициализация…" : "Инициализировать офис"}</Button>
      </div>
    </div>
  )
}
