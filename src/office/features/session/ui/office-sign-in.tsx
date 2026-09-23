import { useAuthActions } from "@convex-dev/auth/react"
import { useState } from "react"

import { Button } from "@/shared/components/ui/button"
import { errorMessage } from "@/shared/lib/error-message"

export function OfficeSignIn() {
  const { signIn } = useAuthActions()
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await signIn("password", { email, password, name, flow })
    } catch (caught) {
      setError(errorMessage(caught, flow === "signIn" ? "Не удалось войти" : "Не удалось создать учётную запись"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-nav px-6">
      <div className="flex flex-col items-center gap-2 text-nav-foreground">
        <img src="/branding/sandyq-kz-logo.svg" alt="Sandyq" className="h-10" />
        <p className="text-sm text-nav-foreground/65">Офис</p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-[var(--radius-panel)] bg-card p-8 shadow-[var(--shadow-float)]">
        <div className="mb-5 flex gap-1 rounded-[var(--radius-control)] bg-muted p-1">
          <button type="button" onClick={() => setFlow("signIn")} className={`flex-1 rounded-[calc(var(--radius-control)-2px)] py-1.5 text-sm font-bold transition-colors ${flow === "signIn" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
            Вход
          </button>
          <button type="button" onClick={() => setFlow("signUp")} className={`flex-1 rounded-[calc(var(--radius-control)-2px)] py-1.5 text-sm font-bold transition-colors ${flow === "signUp" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
            Регистрация
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {flow === "signUp" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">Имя</span>
              <input value={name} onChange={(event) => setName(event.target.value)} className="h-11 rounded-[var(--radius-control)] border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" required />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 rounded-[var(--radius-control)] border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Пароль</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 rounded-[var(--radius-control)] border border-border bg-background px-3 text-sm outline-none focus:border-primary/50" required minLength={10} />
          </label>
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-destructive">{error}</p>}

        <Button type="submit" size="lg" className="mt-5 w-full" disabled={submitting}>
          {submitting ? "Подождите…" : flow === "signIn" ? "Войти" : "Создать учётную запись"}
        </Button>
      </form>
    </div>
  )
}

export function OfficeAccessDenied({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <p className="text-lg font-extrabold text-foreground">Доступ не настроен</p>
      <p className="max-w-sm text-sm text-muted-foreground">Эта учётная запись не привязана к офису Sandyq. Обратитесь к администратору.</p>
      <Button variant="outline" onClick={onSignOut}>Выйти</Button>
    </div>
  )
}
