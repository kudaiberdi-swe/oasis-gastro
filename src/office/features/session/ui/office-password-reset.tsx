import { useAuthActions } from "@convex-dev/auth/react"
import { ConvexError } from "convex/values"
import { useState, type FormEvent } from "react"

import { Banner, Button, Field, Input, NumericCodeInput } from "@/shared/components/ui"

import { OFFICE_PASSWORD_HINT, officePasswordProblem, RESET_CODE_LENGTH } from "../model/password"

// Office password recovery (W2-ACL-08) over Convex Auth Password with the «office-password-reset»
// provider: step «Email» asks for a code, step «Код и новый пароль» sets the password and signs in.
// Step 1 never reveals whether the address exists: success and ANY error show the same neutral text
// and move on to the code step.

export const RESET_SENT = "Если такой адрес есть, мы отправили код"
export const RESET_CODE_FAILED = "Код неверный или устарел. Запросите новый код."

type Step = "email" | "code"

export function OfficePasswordReset({ initialEmail = "", onBack }: { initialEmail?: string; onBack: () => void }) {
  const { signIn } = useAuthActions()
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [repeat, setRepeat] = useState("")
  const [notice, setNotice] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [repeatError, setRepeatError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function requestCode() {
    setSubmitting(true)
    setError(null)
    try {
      await signIn("password", { flow: "reset", email: email.trim() })
    } catch {
      // Deliberately swallowed: an unknown address, a rate limit or a mail outage look the same.
    } finally {
      setSubmitting(false)
      setNotice(true)
      setCode("")
      setStep("code")
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    if (!email.trim()) return
    await requestCode()
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const badCode = code.length !== RESET_CODE_LENGTH ? `Введите ${RESET_CODE_LENGTH} цифр из письма` : null
    const badPassword = officePasswordProblem(password)
    const badRepeat = !badPassword && repeat !== password ? "Пароли не совпадают" : null
    setCodeError(badCode)
    setPasswordError(badPassword)
    setRepeatError(badRepeat)
    if (badCode || badPassword || badRepeat) return
    setSubmitting(true)
    try {
      // On success Convex Auth signs the user in and the office router takes over.
      await signIn("password", { flow: "reset-verification", email: email.trim(), code, newPassword: password })
    } catch (caught) {
      // Our own ConvexError (the password rule) is shown as is; anything else is the masked auth error.
      setError(caught instanceof ConvexError && typeof caught.data === "string" ? caught.data : RESET_CODE_FAILED)
    } finally {
      setSubmitting(false)
    }
  }

  if (step === "email") {
    return (
      <form onSubmit={(event) => void submitEmail(event)} className="flex w-full max-w-sm flex-col gap-5 rounded-panel bg-card p-8 shadow-float" aria-label="Восстановление пароля">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-title font-semibold text-foreground">Восстановление пароля</h1>
          <p className="text-body-sm text-muted-foreground">Укажите рабочий email — пришлём код из {RESET_CODE_LENGTH} цифр, он действует 15 минут.</p>
        </div>
        <Field label="Email">
          {(control) => <Input {...control} type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />}
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={submitting || !email.trim()}>
          {submitting ? "Подождите…" : "Получить код"}
        </Button>
        <Button variant="link" className="self-center" onClick={onBack}>
          Вернуться ко входу
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={(event) => void submitCode(event)} className="flex w-full max-w-sm flex-col gap-5 rounded-panel bg-card p-8 shadow-float" aria-label="Код и новый пароль" noValidate>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-title font-semibold text-foreground">Код и новый пароль</h1>
        <p className="text-body-sm text-muted-foreground">{email.trim()}</p>
      </div>
      {notice ? (
        <Banner tone="info" title={RESET_SENT}>
          Проверьте почту, в том числе папку «Спам». Код действует 15 минут.
        </Banner>
      ) : null}
      <div className="flex flex-col gap-3">
        <Field label="Код из письма" error={codeError ?? undefined}>
          {(control) => (
            <NumericCodeInput
              {...control}
              name="reset-code"
              maxLength={RESET_CODE_LENGTH}
              value={code}
              onValueChange={(value) => {
                setCode(value)
                setCodeError(null)
              }}
              autoFocus
            />
          )}
        </Field>
        <Field label="Новый пароль" hint={OFFICE_PASSWORD_HINT} error={passwordError ?? undefined}>
          {(control) => (
            <Input
              {...control}
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setPasswordError(null)
              }}
            />
          )}
        </Field>
        <Field label="Повторите пароль" error={repeatError ?? undefined}>
          {(control) => (
            <Input
              {...control}
              type="password"
              name="repeat-password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => {
                setRepeat(event.target.value)
                setRepeatError(null)
              }}
            />
          )}
        </Field>
      </div>
      {error ? <Banner tone="danger" title={error} /> : null}
      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? "Подождите…" : "Сменить пароль и войти"}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="link" onClick={() => void requestCode()} disabled={submitting}>
          Отправить код ещё раз
        </Button>
        <Button
          variant="link"
          onClick={() => {
            setStep("email")
            setNotice(false)
            setError(null)
          }}
        >
          Другой email
        </Button>
      </div>
      <Button variant="link" className="self-center" onClick={onBack}>
        Вернуться ко входу
      </Button>
    </form>
  )
}
