import { useAuthActions } from "@convex-dev/auth/react"
import { useState } from "react"
import { ConvexError } from "convex/values"

import { Banner, Button, EmptyState, Field, Input, OrnamentPair, SegmentedControl } from "@/shared/components/ui"

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
      // @convex-dev/auth's Password provider throws a plain Error("Invalid credentials") for
      // wrong email/password, which Convex always masks to a generic "Server Error" client-side —
      // show a real reason only when we get one (our own ConvexError validation), otherwise a
      // flow-specific fallback instead of the confusing masked text.
      setError(
        caught instanceof ConvexError && typeof caught.data === "string"
          ? caught.data
          : flow === "signIn"
            ? "Неверный email или пароль"
            : "Не удалось создать учётную запись",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-nav px-6">
      <div className="flex flex-col items-center gap-3 text-nav-foreground">
        <img src="/branding/sandyq-kz-logo.svg" alt="Sandyq" className="h-12" />
        <OrnamentPair className="text-nav-accent" />
        <p className="text-body-sm text-nav-muted">Офис</p>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-5 rounded-panel bg-card p-8 shadow-float">
        <SegmentedControl
          aria-label="Вход или регистрация"
          value={flow}
          onValueChange={setFlow}
          className="w-full"
          options={[
            { value: "signIn", label: "Вход" },
            { value: "signUp", label: "Регистрация" },
          ]}
        />

        <div className="flex flex-col gap-3">
          {flow === "signUp" && (
            <Field label="Имя">{(control) => <Input {...control} name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />}</Field>
          )}
          <Field label="Email">
            {(control) => <Input {...control} type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />}
          </Field>
          <Field label="Пароль">
            {(control) => (
              <Input
                {...control}
                type="password"
                name="password"
                autoComplete={flow === "signIn" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={10}
              />
            )}
          </Field>
        </div>

        {error && <Banner tone="danger" title={error} />}

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "Подождите…" : flow === "signIn" ? "Войти" : "Создать учётную запись"}
        </Button>
      </form>
    </div>
  )
}

export function OfficeAccessDenied({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="flex h-full items-center justify-center bg-background px-6">
      <EmptyState
        size="lg"
        title="Доступ не настроен"
        description="Эта учётная запись не привязана к офису Sandyq. Обратитесь к администратору."
        action={
          <Button variant="secondary" onClick={onSignOut}>
            Выйти
          </Button>
        }
      />
    </div>
  )
}
