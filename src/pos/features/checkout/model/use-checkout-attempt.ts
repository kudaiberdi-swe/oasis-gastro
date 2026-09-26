import { useCallback, useRef, useState } from "react"

import { errorMessage } from "@/shared/lib/error-message"

// One payment attempt of an order (POS redesign «Money & control»): the idempotency key is kept for the
// order until the payment succeeds or the attempt is dropped (dialog cancelled, another order), so a
// retry after a lost answer is deduplicated by orders.checkout instead of charging twice. A server that
// does not answer in CHECKOUT_TIMEOUT_MS surfaces a timeout; the dialog stays open with the same key.

export const CHECKOUT_TIMEOUT_MS = 10_000

export const CHECKOUT_TIMEOUT_MESSAGE = "Нет ответа сервера. Повторите — повторная оплата не пройдёт."

export class CheckoutTimeoutError extends Error {
  constructor() {
    super(CHECKOUT_TIMEOUT_MESSAGE)
    this.name = "CheckoutTimeoutError"
  }
}

/** Rejects with CheckoutTimeoutError when `promise` has not settled in `ms`; the promise itself keeps running. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CheckoutTimeoutError()), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

type Attempt = { scope: string; key: string }

const randomKey = () => crypto.randomUUID()

export function useCheckoutAttempt<R>({ timeoutMs = CHECKOUT_TIMEOUT_MS, newKey = randomKey }: { timeoutMs?: number; newKey?: () => string } = {}) {
  const attempt = useRef<Attempt | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** The key of the current attempt for `scope` (the order id); a new scope starts a new attempt. */
  const keyFor = useCallback(
    (scope: string) => {
      if (attempt.current?.scope !== scope) attempt.current = { scope, key: newKey() }
      return attempt.current.key
    },
    [newKey],
  )

  /** Drops the attempt (dialog cancelled): the next payment of any order gets a new key. */
  const reset = useCallback(() => {
    attempt.current = null
    setError(null)
  }, [])

  const submit = useCallback(
    async (scope: string, run: (idempotencyKey: string) => Promise<R>, onSuccess: (result: R) => void) => {
      const key = keyFor(scope)
      // Only the attempt that is still current may finish: a cancelled one or a second answer is ignored.
      const finish = (result: R) => {
        if (attempt.current?.key !== key) return
        attempt.current = null
        setError(null)
        onSuccess(result)
      }
      setSubmitting(true)
      setError(null)
      const pending = run(key)
      try {
        finish(await withTimeout(pending, timeoutMs))
      } catch (caught) {
        if (caught instanceof CheckoutTimeoutError) {
          setError(CHECKOUT_TIMEOUT_MESSAGE)
          // A late answer to this very attempt still completes it (the mutation may have been queued offline).
          pending.then(finish, () => undefined)
        } else if (attempt.current?.key === key) {
          setError(errorMessage(caught, "Не удалось провести оплату"))
        }
      } finally {
        setSubmitting(false)
      }
    },
    [keyFor, timeoutMs],
  )

  return { submitting, error, submit, reset, keyFor }
}
