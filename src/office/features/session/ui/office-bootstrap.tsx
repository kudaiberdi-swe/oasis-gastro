import { useState } from "react"

import { Banner, Button, EmptyState } from "@/shared/components/ui"
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
    <div className="flex h-full items-center justify-center bg-background px-6">
      <EmptyState
        size="lg"
        title="Офис ещё не настроен"
        description={
          <>
            Учётная запись <span className="font-semibold text-foreground">{email}</span> может стать первым администратором офиса, если она указана как OFFICE_BOOTSTRAP_EMAIL.
          </>
        }
        action={
          <div className="flex max-w-sm flex-col items-center gap-3">
            {error && <Banner tone="danger" title={error} className="text-left" />}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onSignOut}>
                Выйти
              </Button>
              <Button onClick={handleBootstrap} disabled={submitting}>
                {submitting ? "Инициализация…" : "Инициализировать офис"}
              </Button>
            </div>
          </div>
        }
      />
    </div>
  )
}
