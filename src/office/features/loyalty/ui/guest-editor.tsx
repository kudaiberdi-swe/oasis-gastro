import { useEffect, useRef, useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { usePlatformScope } from "@/office/features/platform/data/use-platform"
import { MasterPanel } from "@/office/features/stock/ui/master-panel"
import { Button, Checkbox, Chip, ConfirmDialog, EmptyState, Field, Input, Money, Select, Skeleton, StatusPill, Textarea, useToast } from "@/shared/components/ui"
import { formatAlmatyDate, formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import { useGuest, useGuestMutations, usePrograms, type GuestCard, type GuestCategory } from "../data/use-office-loyalty"
import {
  categoryColorClass,
  GENDER_LABELS,
  guestDraftOf,
  guestSaveArgs,
  guestStatusOf,
  isMasked,
  TRANSACTION_KIND_LABELS,
  validateGuest,
  type DraftErrors,
  type Gender,
  type GuestDraft,
} from "../model/loyalty-model"
import { BalanceAdjustDialog } from "./balance-adjust-dialog"
import { ConsentLog } from "./consent-log"

const NO_GENDER = "__none__"
const NO_RESTAURANT = "__none__"
const HIDDEN_HINT = "Скрыто: нужно право «Персональные данные гостей»"

export function FormSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-body-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** The guest card (Editor §3.4 in the right panel): contacts, categories, consents, accounts, history. */
export function GuestEditor({
  guestId,
  canEdit,
  categories,
  onClose,
  onSaved,
}: {
  guestId: string | null
  canEdit: boolean
  categories: GuestCategory[] | undefined
  onClose: () => void
  onSaved: (guestId: string) => void
}) {
  const card = useGuest(guestId)
  if (guestId && !card) {
    return (
      <RightPanel open onOpenChange={(open) => !open && onClose()} title="Гость">
        {card === null ? (
          <EmptyState title="Гость не найден" description="Возможно, он относится к ресторану вне вашего доступа или ссылка устарела." />
        ) : (
          <OfficeStatePage state={{ kind: "loading" }} />
        )}
      </RightPanel>
    )
  }
  return <GuestForm card={card ?? null} canEdit={canEdit} categories={categories} onClose={onClose} onSaved={onSaved} />
}

function GuestForm({
  card,
  canEdit,
  categories,
  onClose,
  onSaved,
}: {
  card: GuestCard | null
  canEdit: boolean
  categories: GuestCategory[] | undefined
  onClose: () => void
  onSaved: (guestId: string) => void
}) {
  const guest = card?.guest ?? null
  const canSeePii = useCan("office.guests.pii")
  const scope = usePlatformScope()
  const { saveGuest } = useGuestMutations()
  const toast = useToast()
  const [baseline, setBaseline] = useState(() => guestDraftOf(guest))
  const [draft, setDraft] = useState(baseline)
  const [errors, setErrors] = useState<DraftErrors<keyof GuestDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const readOnly = !canEdit

  // Open the new card only once the form is clean, so the unsaved-changes guard lets the navigation through.
  const reported = useRef<string | null>(null)
  useEffect(() => {
    if (createdId && !dirty && reported.current !== createdId) {
      reported.current = createdId
      onSaved(createdId)
    }
  }, [createdId, dirty, onSaved])

  const set = (patch: Partial<GuestDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof GuestDraft]
      return next
    })
  }

  async function submit() {
    if (readOnly || saving) return
    const found = validateGuest(draft, !guest)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      const savedId = await saveGuest(guestSaveArgs(draft, guest, canSeePii))
      setBaseline(draft)
      toast(guest ? "Карточка гостя сохранена" : "Гость создан", "success")
      if (!guest) setCreatedId(savedId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить гостя"))
    } finally {
      setSaving(false)
    }
  }

  const text = (
    key: "name" | "phone" | "email" | "cardNumber",
    label: string,
    extra: {
      type?: string
      inputMode?: "tel" | "email" | "text"
      placeholder?: string
    } = {},
  ) => {
    const masked = isMasked(draft[key])
    return (
      <Field label={label} error={errors[key]} hint={masked ? HIDDEN_HINT : undefined}>
        {(control) => (
          <Input
            {...control}
            type={extra.type ?? "text"}
            inputMode={extra.inputMode}
            value={draft[key]}
            onChange={(event) => set({ [key]: event.target.value } as Partial<GuestDraft>)}
            readOnly={masked}
            disabled={readOnly}
            placeholder={extra.placeholder}
            autoComplete="off"
          />
        )}
      </Field>
    )
  }

  const selectable = (categories ?? []).filter((category) => category.active || draft.categoryExternalIds.includes(category.externalId))
  const toggleCategory = (externalId: string) =>
    set({
      categoryExternalIds: draft.categoryExternalIds.includes(externalId) ? draft.categoryExternalIds.filter((id) => id !== externalId) : [...draft.categoryExternalIds, externalId],
    })

  return (
    <MasterPanel
      title={guest ? guest.name || "Гость" : "Новый гость"}
      formLabel="Гость"
      dirty={dirty}
      saving={saving}
      canEdit={canEdit}
      isNew={!guest}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <FormSection title="Контакты">
        {text("name", "Имя")}
        <div className="grid gap-4 sm:grid-cols-2">
          {text("phone", "Телефон", {
            type: "tel",
            inputMode: "tel",
            placeholder: "+7 701 000 00 00",
          })}
          {text("email", "Email", { inputMode: "email" })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Дата рождения" error={errors.birthDate} hint={isMasked(draft.birthDate) ? HIDDEN_HINT : undefined}>
            {(control) =>
              isMasked(draft.birthDate) ? (
                <Input {...control} value={draft.birthDate} readOnly disabled={readOnly} />
              ) : (
                <Input {...control} type="date" value={draft.birthDate} onChange={(event) => set({ birthDate: event.target.value })} disabled={readOnly} />
              )
            }
          </Field>
          <Field label="Пол">
            {(control) => (
              <Select
                {...control}
                value={draft.gender || NO_GENDER}
                onValueChange={(value) => set({ gender: value === NO_GENDER ? "" : (value as Gender) })}
                options={[
                  { value: NO_GENDER, label: "—" },
                  ...(Object.keys(GENDER_LABELS) as Gender[]).map((value) => ({
                    value,
                    label: GENDER_LABELS[value],
                  })),
                ]}
                disabled={readOnly}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {text("cardNumber", "Номер карты")}
          {!guest && scope.restaurants.length > 0 ? (
            <Field label="Ресторан">
              {(control) => (
                <Select
                  {...control}
                  value={draft.restaurantExternalId || NO_RESTAURANT}
                  onValueChange={(value) =>
                    set({
                      restaurantExternalId: value === NO_RESTAURANT ? "" : value,
                    })
                  }
                  options={[
                    { value: NO_RESTAURANT, label: "Вся сеть" },
                    ...scope.restaurants.map((row) => ({
                      value: row.externalId,
                      label: row.name,
                    })),
                  ]}
                  disabled={readOnly}
                />
              )}
            </Field>
          ) : guest ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-muted-foreground">Ресторан первого визита</span>
              <span className="flex h-11 items-center text-body-sm">{scope.restaurantName(guest.restaurantExternalId) ?? "—"}</span>
            </div>
          ) : null}
        </div>
        {canSeePii ? (
          <Field label="Заметки">{(control) => <Textarea {...control} value={draft.notes} onChange={(event) => set({ notes: event.target.value })} disabled={readOnly} />}</Field>
        ) : (
          <p className="text-caption text-muted-foreground">Заметки скрыты: нужно право «Персональные данные гостей».</p>
        )}
      </FormSection>

      <FormSection title="Категории">
        {categories === undefined ? (
          <Skeleton className="h-9 w-full" />
        ) : selectable.length ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Категории гостя">
            {selectable.map((category) => (
              <Chip key={category.externalId} active={draft.categoryExternalIds.includes(category.externalId)} onClick={() => toggleCategory(category.externalId)} disabled={readOnly}>
                <span aria-hidden className={cn("size-2 rounded-round", categoryColorClass(category.color))} />
                {category.name}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-body-sm text-muted-foreground">Категорий пока нет — их заводят в разделе «Категории гостей».</p>
        )}
      </FormSection>

      <FormSection title="Согласия">
        {card ? (
          <ConsentLog card={card} canEdit={canEdit} />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-caption text-muted-foreground">Без обоих согласий гостя создать нельзя (закон РК о персональных данных; данные хранятся вне РК).</p>
            <ConsentCheckbox
              label="Согласие на обработку персональных данных"
              checked={draft.personalData}
              onChange={(personalData) => set({ personalData })}
              error={errors.personalData}
              disabled={readOnly}
            />
            <ConsentCheckbox
              label="Согласие на трансграничную передачу данных"
              checked={draft.crossBorder}
              onChange={(crossBorder) => set({ crossBorder })}
              error={errors.crossBorder}
              disabled={readOnly}
            />
            <Field label="Документ-основание (необязательно)" hint="Номер заявления или ссылка на подписанную форму">
              {(control) => <Input {...control} value={draft.documentRef} onChange={(event) => set({ documentRef: event.target.value })} disabled={readOnly} autoComplete="off" />}
            </Field>
          </div>
        )}
      </FormSection>

      {card ? <Accounts card={card} /> : null}
      {card ? <History card={card} /> : null}
      {card ? <GuestStatusSection card={card} canEdit={canEdit} disabled={dirty} /> : null}
    </MasterPanel>
  )
}

function ConsentCheckbox({ label, checked, onChange, error, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; error?: string; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-start gap-3 text-body-sm">
        <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} disabled={disabled} aria-invalid={error ? true : undefined} className="mt-0.5" />
        <span className="font-medium">{label}</span>
      </label>
      {error ? (
        <p role="alert" className="pl-8 text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function Accounts({ card }: { card: GuestCard }) {
  const canAdjust = useCan("office.loyalty-programs.approve")
  const { programs } = usePrograms()
  const [adjusting, setAdjusting] = useState(false)
  const programName = (externalId: string) => programs?.find((program) => program.externalId === externalId)?.name ?? externalId

  return (
    <FormSection
      title="Бонусные счета"
      action={
        canAdjust ? (
          <Button size="sm" variant="secondary" onClick={() => setAdjusting(true)}>
            Корректировка
          </Button>
        ) : undefined
      }
    >
      {card.accounts.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
          {card.accounts.map((account) => (
            <li key={account._id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body-sm font-medium">{programName(account.programExternalId)}</span>
                <span className="text-caption text-muted-foreground">
                  {account.kind === "deposit" ? "Депозит" : "Бонусы"}
                  {account.reserved > 0 ? ` · в резерве ${formatQuantity(account.reserved)}` : ""}
                </span>
              </span>
              <span className="sq-price text-title-sm font-semibold text-accent tabular-nums">{formatQuantity(account.balance)} б.</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-muted-foreground">
          Счетов по программам пока нет. Баланс гостя: <span className="font-semibold text-foreground">{formatQuantity(card.guest.points)} б.</span>
        </p>
      )}
      <p className="text-caption text-muted-foreground">1 балл = 1 ₸ при оплате.</p>
      {canAdjust && adjusting ? <BalanceAdjustDialog open onOpenChange={setAdjusting} card={card} programs={programs} /> : null}
    </FormSection>
  )
}

function History({ card }: { card: GuestCard }) {
  const guest = card.guest
  return (
    <FormSection title="История">
      <dl className="grid grid-cols-3 gap-3 text-body-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">Визитов</dt>
          <dd className="tabular-nums">{formatQuantity(guest.visits ?? 0)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">Оборот</dt>
          <dd>
            <Money value={guest.turnover ?? 0} size="sm" className="text-foreground" />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">Последний визит</dt>
          <dd>{guest.lastVisitAt ? formatAlmatyDate(guest.lastVisitAt) : "—"}</dd>
        </div>
      </dl>
      {card.transactions.length ? (
        <ol aria-label="Движения баллов" className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {card.transactions.map((entry) => (
            <li key={entry._id} className="flex items-center justify-between gap-3 text-body-sm">
              <span className="min-w-0">
                <span className="font-semibold">{TRANSACTION_KIND_LABELS[entry.kind] ?? entry.kind}</span>
                {entry.description || entry.reason ? <span className="text-muted-foreground"> — {entry.description ?? entry.reason}</span> : null}
                <span className="block text-caption text-muted-foreground">
                  {formatAlmatyDateTime(entry.occurredAt)}
                  {entry.actorEmail ? ` · ${entry.actorEmail}` : ""}
                </span>
              </span>
              <span className={cn("font-semibold whitespace-nowrap tabular-nums", entry.points < 0 ? "text-destructive" : "text-success")}>
                {entry.points > 0 ? "+" : ""}
                {formatQuantity(entry.points)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-body-sm text-muted-foreground">Движений баллов пока нет</p>
      )}
    </FormSection>
  )
}

function GuestStatusSection({ card, canEdit, disabled }: { card: GuestCard; canEdit: boolean; disabled: boolean }) {
  const { setGuestStatus } = useGuestMutations()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = guestStatusOf(card.guest)

  async function run(next: "active" | "inactive") {
    setBusy(true)
    setError(null)
    try {
      await setGuestStatus({ guestId: card.guest._id, status: next })
      toast(next === "active" ? "Гость включён" : "Гость отключён", "success")
      setConfirming(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось изменить статус"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSection title="Статус и аудит">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-body-sm">
        <dt className="text-muted-foreground">Статус</dt>
        <dd>
          <StatusPill domain="document" status={status} />
        </dd>
        <dt className="text-muted-foreground">Создан</dt>
        <dd>{formatAlmatyDateTime(card.guest.createdAt)}</dd>
        {card.guest.updatedAt ? (
          <>
            <dt className="text-muted-foreground">Изменён</dt>
            <dd>{formatAlmatyDateTime(card.guest.updatedAt)}</dd>
          </>
        ) : null}
      </dl>
      {canEdit ? (
        status === "active" ? (
          <Button variant="danger" size="sm" className="self-start" disabled={busy || disabled} onClick={() => setConfirming(true)}>
            Отключить гостя
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="self-start" disabled={busy || disabled} onClick={() => void run("active")}>
            Включить гостя
          </Button>
        )
      ) : null}
      {error && !confirming ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Отключить гостя?"
        description="Отключённого гостя нельзя привязать к заказу на кассе; баланс и история сохранятся."
        confirmLabel="Отключить"
        submitting={busy}
        error={error}
        onConfirm={() => run("inactive")}
      />
    </FormSection>
  )
}
