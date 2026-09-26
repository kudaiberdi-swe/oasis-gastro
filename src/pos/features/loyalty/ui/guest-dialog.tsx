import { Search, UserPlus, UserRound } from "lucide-react"
import { useState } from "react"

import { Button, Chip, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, Input, MoneyInput, Skeleton } from "@/shared/components/ui"
import { posErrorMessage, useT } from "@/pos/i18n"
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
  /** A guest from the search by id, or a new / typed number by phone. */
  onAttach: (target: { guestId?: Id<"guests">; phone?: string }, name?: string) => Promise<unknown>
  onDetach: () => Promise<unknown>
  /** Plans how many points this check spends (setOrderRedemption); 0 — only accrue. */
  onRedeem: (redemption: number) => Promise<unknown>
}

/**
 * «Гость и программа лояльности» (W1-POS-16, pos/16): search by name, phone or card, the guest's balance,
 * partial redemption, «Без гостя / Только начислить / Списать N ₸». Nothing is spent until the payment.
 */
export function GuestDialog({ open, onOpenChange, sessionToken, orderId, total, currentGuest, onAttach, onDetach, onRedeem }: GuestDialogProps) {
  const t = useT()
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
  // A guest found in the search is attached by id — its phone is masked there and needn't be retyped.
  const attachTarget = candidate ? { guestId: candidate.guestId as Id<"guests"> } : creating ? { phone: query } : undefined
  const attachPhone = attachTarget ? (attachTarget.phone ?? candidate?.phone) : undefined
  const needsConfirm = false

  const limit = quote ? redemptionLimit(quote.maxRedemption, total) : 0
  const value = redemption === undefined ? (attached ? (quote?.planned ?? 0) : 0) : redemption
  const problem = quote ? redemptionProblem(value, quote.maxRedemption, total, t) : null
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
      setError(posErrorMessage(t, caught, fallback))
    } finally {
      setSubmitting(false)
    }
  }

  const withoutGuest = () => (attached ? run(onDetach, t("guest.detachFailed")) : close())
  const onlyAccrue = () =>
    run(async () => {
      if (attached) {
        if (quote?.planned) await onRedeem(0)
        return
      }
      if (!attachTarget) return
      await onAttach(attachTarget, creating ? newName.trim() || undefined : undefined)
    }, t("guest.attachFailed"))
  const redeem = () =>
    run(async () => {
      if (!value) return
      if (!attached) {
        if (!attachTarget) return
        await onAttach(attachTarget)
      }
      await onRedeem(value)
    }, t("guest.redeemFailed"))

  const canAccrue = attached || Boolean(attachPhone)

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("guest.title")}</DialogTitle>
          <DialogDescription>{t("guest.description")}</DialogDescription>
        </DialogHeader>

        {currentGuest ? (
          <GuestCard title={currentGuest.name || t("common.guest")} phone={maskPhoneForPos(currentGuest.phone)} quote={quote} limit={limit} fallbackPoints={currentGuest.points} />
        ) : (
          <>
            <label className="relative block">
              <span className="sr-only">{t("guest.search")}</span>
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
                placeholder={t("guest.searchPlaceholder")}
                className={cn(TOUCH, "pl-10 text-body")}
              />
            </label>
            {candidate ? (
              <>
                <GuestCard
                  title={candidate.name || t("common.guest")}
                  phone={maskPhoneForPos(candidate.phone)}
                  quote={quote}
                  limit={limit}
                  fallbackPoints={candidate.points}
                  onChange={() => setCandidate(null)}
                />
                {needsConfirm ? (
                  <Field
                    label={t("guest.fullPhone")}
                    hint={confirmPhone && !attachPhone ? undefined : t("guest.fullPhoneHint")}
                    error={confirmPhone && isFullPhone(confirmPhone) && !attachPhone ? t("guest.phoneMismatch") : undefined}
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
                  {t("guest.new", { phone: maskPhoneForPos(query) })}
                </p>
                <Field label={t("guest.nameOptional")}>
                  {(control) => <Input {...control} value={newName} onChange={(event) => setNewName(event.target.value)} autoComplete="off" className={TOUCH} />}
                </Field>
                <p className="text-body-sm text-muted-foreground">{t("guest.noConsents")}</p>
              </div>
            ) : null}
          </>
        )}

        {quote && (currentGuest || candidate) ? (
          <div className="flex flex-col gap-2">
            {quote.program ? (
              <>
                <Field label={t("guest.redeemLabel")} error={value !== null && value > 0 ? (problem ?? undefined) : undefined} hint={t("guest.redeemHint", { amount: formatTenge(limit) })}>
                  {(control) => <MoneyInput {...control} value={value} onValueChange={(next) => setRedemption(next)} className={cn(TOUCH, "text-body font-semibold")} />}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Chip size="lg" active={value === 0 || value === null} onClick={() => setRedemption(0)}>
                    {t("guest.noRedeem")}
                  </Chip>
                  {limit > 0 ? (
                    <Chip size="lg" active={value === limit} onClick={() => setRedemption(limit)} className="tabular-nums">
                      {t("guest.max", { amount: formatTenge(limit) })}
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
            {t("guest.withoutGuest")}
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" size="lg" onClick={() => void onlyAccrue()} disabled={submitting || !canAccrue}>
              {t("guest.onlyAccrue")}
            </Button>
            <Button size="lg" onClick={() => void redeem()} disabled={submitting || !redeemable}>
              {submitting ? t("common.saving") : t("guest.redeem", { amount: formatTenge(value ?? 0) })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SearchResults({ results, onPick }: { results: PosGuestMatch[] | undefined; onPick: (match: PosGuestMatch) => void }) {
  const t = useT()
  if (results === undefined) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }
  if (!results.length) return <p className="text-body-sm text-muted-foreground">{t("guest.notFound")}</p>
  return (
    <ul aria-label={t("guest.found")} className="flex max-h-64 flex-col gap-2 overflow-y-auto">
      {results.map((match) => (
        <li key={match.guestId}>
          <button
            type="button"
            onClick={() => onPick(match)}
            className={cn("flex min-h-14 w-full items-center gap-3 rounded-card border border-input bg-card px-3 py-2 text-left hover:bg-muted", focusRingClass)}
          >
            <UserRound aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-semibold">{match.name || t("common.guest")}</span>
              <span className="text-body-sm text-muted-foreground tabular-nums">{maskPhoneForPos(match.phone)}</span>
            </span>
            <span className="text-body-sm font-semibold text-accent tabular-nums">{t("guest.points", { points: formatQuantity(match.points) })}</span>
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
  const t = useT()
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
            {t("guest.other")}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-body-sm text-muted-foreground">{t("guest.balance")}</p>
          <p className="sq-price text-display font-semibold text-accent">{formatQuantity(balance)}</p>
          <p className="text-body-sm text-muted-foreground">{t("guest.pointsWord")}</p>
        </div>
        {quote === undefined ? (
          <Skeleton className="h-16 w-full sm:col-span-2" />
        ) : quote === null ? null : (
          <>
            <div>
              <p className="text-body-sm text-muted-foreground">{t("guest.canRedeem")}</p>
              <p className="sq-price text-title font-semibold tabular-nums">{formatTenge(limit)}</p>
            </div>
            <div>
              <p className="text-body-sm text-muted-foreground">{t("guest.program")}</p>
              <p className="text-body-sm font-semibold">{quote.program ? quote.program.name : t("guest.baseAccrual")}</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AccrualLine({ quote, redemption, total }: { quote: LoyaltyQuote; redemption: number; total: number }) {
  const t = useT()
  const accrual = accrualFor(quote, redemption, total)
  return (
    <div className="flex items-baseline justify-between rounded-control bg-muted px-4 py-3">
      <span className="text-body font-semibold">{t("guest.willAccrue")}</span>
      <span className="sq-price text-title font-semibold text-success tabular-nums">
        {accrual.approximate ? "≈ " : ""}+{t("guest.points", { points: formatQuantity(accrual.points) })}
      </span>
    </div>
  )
}
