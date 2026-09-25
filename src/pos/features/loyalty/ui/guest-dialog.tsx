import { Search, UserPlus, UserRound } from "lucide-react"
import { useState } from "react"

import { Button, Chip, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, Input, MoneyInput, Skeleton } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import type { Id } from "../../../../../convex/_generated/dataModel"
import { useGuestSearch, useLoyaltyQuote, type LoyaltyQuote, type PosGuestMatch } from "../data/use-loyalty"
import { accrualFor, isFullPhone, isPhoneQuery, maskPhoneForPos, phoneMatchesMask, redemptionLimit, redemptionProblem } from "../model/guest-loyalty"

const TOUCH = "h-[var(--control-h-pos)]"

export interface GuestDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionToken: string
  orderId: Id<"orders"> | null
  /** The order total before points. */
  total: number
  currentGuest: { phone: string; name?: string; points: number } | null | undefined
  onAttach: (phone: string, name?: string) => Promise<unknown>
  onDetach: () => Promise<unknown>
  /** Plans how many points this check spends (setOrderRedemption); 0 — only accrue. */
  onRedeem: (redemption: number) => Promise<unknown>
}

/**
 * «Гость и программа лояльности» (W1-POS-16, pos/16): search by name, phone or card, the guest's balance,
 * partial redemption, «Без гостя / Только начислить / Списать N ₸». Nothing is spent until the payment.
 */
export function GuestDialog({ open, onOpenChange, sessionToken, orderId, total, currentGuest, onAttach, onDetach, onRedeem }: GuestDialogProps) {
  const [query, setQuery] = useState("")
  const [candidate, setCandidate] = useState<PosGuestMatch | null>(null)
  const [confirmPhone, setConfirmPhone] = useState("")
  const [newName, setNewName] = useState("")
  const [redemption, setRedemption] = useState<number | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const attached = Boolean(currentGuest)
  const results = useGuestSearch(open && !attached ? sessionToken : null, query)
  const quote = useLoyaltyQuote(sessionToken, orderId, {
    guestId: attached ? undefined : (candidate?.guestId as Id<"guests"> | undefined),
    enabled: open && (attached || candidate !== null),
  })

  const phoneQuery = isPhoneQuery(query)
  const creating = !attached && !candidate && phoneQuery && isFullPhone(query) && results !== undefined && results.length === 0
  const attachPhone = candidate ? [query, confirmPhone].find((phone) => phoneMatchesMask(candidate.phone, phone)) : creating ? query : undefined
  const needsConfirm = candidate !== null && !(phoneQuery && phoneMatchesMask(candidate.phone, query))

  const limit = quote ? redemptionLimit(quote.maxRedemption, total) : 0
  const value = redemption === undefined ? (attached ? (quote?.planned ?? 0) : 0) : redemption
  const problem = quote ? redemptionProblem(value, quote.maxRedemption, total) : null
  const redeemable = value !== null && value > 0 && !problem && (attached || Boolean(attachPhone)) && Boolean(quote?.program)

  function reset() {
    setQuery("")
    setCandidate(null)
    setConfirmPhone("")
    setNewName("")
    setRedemption(undefined)
    setError(null)
  }

  function close() {
    reset()
    onOpenChange(false)
  }

  async function run(action: () => Promise<unknown>, fallback: string) {
    setSubmitting(true)
    setError(null)
    try {
      await action()
      close()
    } catch (caught) {
      setError(errorMessage(caught, fallback))
    } finally {
      setSubmitting(false)
    }
  }

  const withoutGuest = () => (attached ? run(onDetach, "Не удалось открепить гостя") : close())
  const onlyAccrue = () =>
    run(async () => {
      if (attached) {
        if (quote?.planned) await onRedeem(0)
        return
      }
      if (!attachPhone) return
      await onAttach(attachPhone, creating ? newName.trim() || undefined : undefined)
    }, "Не удалось прикрепить гостя")
  const redeem = () =>
    run(async () => {
      if (!value) return
      if (!attached) {
        if (!attachPhone) return
        await onAttach(attachPhone)
      }
      await onRedeem(value)
    }, "Не удалось запланировать списание")

  const canAccrue = attached || Boolean(attachPhone)

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Гость и программа лояльности</DialogTitle>
          <DialogDescription>Поиск выполняется по имени, телефону или номеру карты. Списание и начисление фиксируются при оплате.</DialogDescription>
        </DialogHeader>

        {currentGuest ? (
          <GuestCard title={currentGuest.name || "Гость"} phone={maskPhoneForPos(currentGuest.phone)} quote={quote} limit={limit} fallbackPoints={currentGuest.points} />
        ) : (
          <>
            <label className="relative block">
              <span className="sr-only">Поиск гостя</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                autoFocus
                autoComplete="off"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setCandidate(null)
                  setRedemption(undefined)
                  setError(null)
                }}
                placeholder="Введите минимум 2 символа"
                className={cn(TOUCH, "pl-10 text-body")}
              />
            </label>
            {candidate ? (
              <>
                <GuestCard
                  title={candidate.name || "Гость"}
                  phone={maskPhoneForPos(candidate.phone)}
                  quote={quote}
                  limit={limit}
                  fallbackPoints={candidate.points}
                  onChange={() => setCandidate(null)}
                />
                {needsConfirm ? (
                  <Field
                    label="Телефон гостя полностью"
                    hint={confirmPhone && !attachPhone ? undefined : "В поиске телефон скрыт — для привязки к заказу введите его целиком"}
                    error={confirmPhone && isFullPhone(confirmPhone) && !attachPhone ? "Телефон не совпадает с найденным гостем" : undefined}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        type="tel"
                        inputMode="tel"
                        autoComplete="off"
                        value={confirmPhone}
                        onChange={(event) => setConfirmPhone(event.target.value)}
                        placeholder="+7 700 000 00 00"
                        className={cn(TOUCH, "text-body tabular-nums")}
                      />
                    )}
                  </Field>
                ) : null}
              </>
            ) : query.trim().length >= 2 ? (
              <SearchResults results={results} onPick={(match) => setCandidate(match)} />
            ) : null}
            {creating ? (
              <div className="flex flex-col gap-3 rounded-card border border-dashed border-gold p-3">
                <p className="flex items-center gap-2 text-body-sm font-semibold">
                  <UserPlus aria-hidden className="size-5 text-accent" />
                  Новый гость: {maskPhoneForPos(query)}
                </p>
                <Field label="Имя (необязательно)">
                  {(control) => <Input {...control} value={newName} onChange={(event) => setNewName(event.target.value)} autoComplete="off" className={TOUCH} />}
                </Field>
                <p className="text-body-sm text-muted-foreground">Гость из кассы создаётся без записанных согласий — их оформляют в офисе.</p>
              </div>
            ) : null}
          </>
        )}

        {quote && (currentGuest || candidate) ? (
          <div className="flex flex-col gap-2">
            {quote.program ? (
              <>
                <Field label="Списать баллами" error={value !== null && value > 0 ? (problem ?? undefined) : undefined} hint={`1 балл = 1 ₸ · можно до ${formatTenge(limit)}`}>
                  {(control) => <MoneyInput {...control} value={value} onValueChange={(next) => setRedemption(next)} className={cn(TOUCH, "text-body font-semibold")} />}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Chip size="lg" active={value === 0 || value === null} onClick={() => setRedemption(0)}>
                    Не списывать
                  </Chip>
                  {limit > 0 ? (
                    <Chip size="lg" active={value === limit} onClick={() => setRedemption(limit)} className="tabular-nums">
                      Максимум · {formatTenge(limit)}
                    </Chip>
                  ) : null}
                </div>
              </>
            ) : null}
            <AccrualLine quote={quote} redemption={value ?? 0} total={total} />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="secondary" size="lg" onClick={() => void withoutGuest()} disabled={submitting}>
            Без гостя
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" size="lg" onClick={() => void onlyAccrue()} disabled={submitting || !canAccrue}>
              Только начислить
            </Button>
            <Button size="lg" onClick={() => void redeem()} disabled={submitting || !redeemable}>
              {submitting ? "Сохранение…" : `Списать ${formatTenge(value ?? 0)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SearchResults({ results, onPick }: { results: PosGuestMatch[] | undefined; onPick: (match: PosGuestMatch) => void }) {
  if (results === undefined) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }
  if (!results.length) return <p className="text-body-sm text-muted-foreground">Гость не найден. Для нового гостя введите телефон полностью.</p>
  return (
    <ul aria-label="Найденные гости" className="flex max-h-64 flex-col gap-2 overflow-y-auto">
      {results.map((match) => (
        <li key={match.guestId}>
          <button
            type="button"
            onClick={() => onPick(match)}
            className={cn("flex min-h-14 w-full items-center gap-3 rounded-card border border-input bg-card px-3 py-2 text-left hover:bg-muted", focusRingClass)}
          >
            <UserRound aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-semibold">{match.name || "Гость"}</span>
              <span className="text-body-sm text-muted-foreground tabular-nums">{maskPhoneForPos(match.phone)}</span>
            </span>
            <span className="text-body-sm font-semibold text-accent tabular-nums">{formatQuantity(match.points)} б.</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function GuestCard({
  title,
  phone,
  quote,
  limit,
  fallbackPoints,
  onChange,
}: {
  title: string
  phone: string
  quote: LoyaltyQuote | null | undefined
  limit: number
  fallbackPoints: number
  onChange?: () => void
}) {
  const balance = quote ? quote.balance : fallbackPoints
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-muted p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-title-sm font-semibold">{title}</p>
          <p className="text-body-sm text-muted-foreground tabular-nums">{phone}</p>
        </div>
        {onChange ? (
          <Button variant="ghost" onClick={onChange}>
            Другой гость
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-body-sm text-muted-foreground">Баланс</p>
          <p className="sq-price text-display font-semibold text-accent">{formatQuantity(balance)}</p>
          <p className="text-body-sm text-muted-foreground">баллов</p>
        </div>
        {quote === undefined ? (
          <Skeleton className="h-16 w-full sm:col-span-2" />
        ) : quote === null ? null : (
          <>
            <div>
              <p className="text-body-sm text-muted-foreground">Можно списать</p>
              <p className="sq-price text-title font-semibold tabular-nums">{formatTenge(limit)}</p>
            </div>
            <div>
              <p className="text-body-sm text-muted-foreground">Программа</p>
              <p className="text-body-sm font-semibold">{quote.program ? quote.program.name : "Базовое начисление 1 %"}</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AccrualLine({ quote, redemption, total }: { quote: LoyaltyQuote; redemption: number; total: number }) {
  const accrual = accrualFor(quote, redemption, total)
  return (
    <div className="flex items-baseline justify-between rounded-control bg-muted px-4 py-3">
      <span className="text-body font-semibold">Будет начислено</span>
      <span className="sq-price text-title font-semibold text-success tabular-nums">
        {accrual.approximate ? "≈ " : ""}+{formatQuantity(accrual.points)} б.
      </span>
    </div>
  )
}
