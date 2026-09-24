import { ArrowLeft } from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, ConfirmDialog, EmptyState, Field, Input, MoneyInput, Select, StatusPill, Switch, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { useEmployee, useWorkforceBranches, useWorkforceMutations, type EmployeeCard, type EmployeeId } from "../data/use-office-workforce"
import {
  assignmentChanged,
  formatBusinessDate,
  formatRate,
  isMasked,
  PAY_TYPE_LABEL,
  PAY_TYPE_OPTIONS,
  profileArgs,
  profileChanged,
  profileDraftOf,
  rateUnitLabel,
  ROLE_OPTIONS,
  roleLabel,
  validateHr,
  type PayType,
  type ProfileDraft,
  type ProfileErrors,
  type Role,
} from "../model/modules"
import { ResetPinDialog, RestaurantsField } from "./credentials"

/** /office/employees/:id — the HR card on the Editor template (OFFICE-DESIGN §3.4): «Основные», «Оплата», «Доступ к кассе». */
export function EmployeeEditor({ employeeId }: { employeeId: string }) {
  const card = useEmployee(employeeId as EmployeeId)
  const navigate = useNavigate()
  const back = () => navigate("/office/employees")

  if (card === undefined) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  if (card === null) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <EmptyState
          title="Сотрудник не найден"
          description="Возможно, он работает в ресторане вне вашего доступа или ссылка устарела."
          action={
            <Button variant="secondary" onClick={back}>
              <ArrowLeft aria-hidden />К списку
            </Button>
          }
        />
      </div>
    )
  }
  return <EmployeeForm key={card._id} card={card} onBack={back} />
}

function EmployeeForm({ card, onBack }: { card: EmployeeCard; onBack: () => void }) {
  const canEdit = useCan("office.employees.edit")
  const branches = useWorkforceBranches()
  const mutations = useWorkforceMutations()
  const toast = useToast()
  const [baseline, setBaseline] = useState<ProfileDraft>(() => profileDraftOf(card))
  const [draft, setDraft] = useState<ProfileDraft>(baseline)
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [togglingActive, setTogglingActive] = useState(false)
  const [activeError, setActiveError] = useState<string | null>(null)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])
  const blocker = useUnsavedChanges(dirty && canEdit)
  const readOnly = !canEdit
  // Without office.employees.pii the IIN and phone arrive masked; the profile mutation replaces every HR
  // field, so saving would wipe them — the HR block stays read-only for such a card.
  const piiLocked = isMasked(card.iin) || isMasked(card.phone)
  const profileReadOnly = readOnly || piiLocked
  const set = (patch: Partial<ProfileDraft>) => setDraft((current) => ({ ...current, ...patch }))

  // The card and the server compare against the last saved state, not the first render.
  const base = useMemo(() => ({ ...card, ...fromDraft(baseline) }), [card, baseline])

  async function handleSave() {
    if (readOnly || saving) return
    const found = validateHr(draft)
    if (draft.restaurantExternalIds.length === 0) found.restaurants = "Выберите хотя бы один ресторан"
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    setError(null)
    try {
      if (!profileReadOnly && profileChanged(base, draft)) await mutations.updateEmployeeProfile(profileArgs(card, draft))
      if (assignmentChanged(base, draft)) await mutations.updateEmployeeAssignment({ employeeId: card._id, role: draft.role, restaurantExternalIds: draft.restaurantExternalIds })
      setBaseline(draft)
      toast("Карточка сохранена", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить карточку"))
    } finally {
      setSaving(false)
    }
  }

  async function setActive(active: boolean) {
    setActiveError(null)
    try {
      await mutations.setEmployeeActive({ employeeId: card._id, active })
      setTogglingActive(false)
      toast(active ? "Доступ к кассе включён" : "Доступ к кассе отключён", "success")
    } catch (caught) {
      setActiveError(errorMessage(caught, "Не удалось изменить доступ"))
    }
  }

  const meta = [`Код POS ${card.code}`, roleLabel(card.role), card.restaurants.map((restaurant) => restaurant.name).join(", "), card.iikoEmployeeExternalId ? "из iiko" : null].filter(Boolean).join(" · ")

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title font-semibold">{card.displayName}</h2>
              <StatusPill domain="document" status={card.active ? "active" : "inactive"} />
            </div>
            <p className="text-body-sm text-muted-foreground">{meta}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly ? <SaveStatus state={saving ? "saving" : dirty ? "dirty" : "clean"} /> : null}
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft aria-hidden />К списку
            </Button>
            {!readOnly && dirty ? (
              <Button variant="secondary" onClick={() => setDraft(baseline)} disabled={saving}>
                Сброс
              </Button>
            ) : null}
            {!readOnly ? (
              <Button onClick={() => void handleSave()} disabled={!dirty || saving}>
                {saving ? "Сохранение…" : "Сохранить"}
              </Button>
            ) : null}
          </div>
        </header>

        {!card.active ? (
          <Banner tone="warning" title="Доступ к кассе отключён">
            Сотрудник не может войти на кассу. Карточка и история сохранены.
          </Banner>
        ) : null}
        {piiLocked && canEdit ? (
          <Banner tone="info" title="ИИН и телефон скрыты">
            Изменять кадровые данные этой карточки может пользователь с правом на персональные данные сотрудников. Доступ к кассе можно менять.
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="danger" title="Не удалось сохранить">
            {error}
          </Banner>
        ) : null}

        <Section title="Основные">
          <TextField label="ФИО" value={draft.displayName} error={errors.displayName} readOnly={profileReadOnly} onChange={(displayName) => set({ displayName })} />
          <TextField label="Табельный номер" value={draft.personnelNumber} error={errors.personnelNumber} readOnly={profileReadOnly} onChange={(personnelNumber) => set({ personnelNumber })} />
          <TextField label="ИИН" value={draft.iin} error={errors.iin} readOnly={profileReadOnly} inputMode="numeric" hint="12 цифр" onChange={(iin) => set({ iin: iin.replace(/\D/g, "").slice(0, 12) })} />
          <TextField label="Телефон" value={draft.phone} error={errors.phone} readOnly={profileReadOnly} inputMode="tel" onChange={(phone) => set({ phone })} />
          <TextField label="Email" value={draft.email} error={errors.email} readOnly={profileReadOnly} inputMode="email" onChange={(email) => set({ email })} />
          {profileReadOnly ? (
            <ReadOnlyField label="Дата приёма" value={formatBusinessDate(draft.employmentDate) || "—"} />
          ) : (
            <Field label="Дата приёма" error={errors.employmentDate}>
              {(control) => <Input {...control} type="date" value={draft.employmentDate} onChange={(event) => set({ employmentDate: event.target.value })} />}
            </Field>
          )}
          <SwitchField label="Допущен к работе" hint="Можно ставить в график и смены" checked={draft.admitted} disabled={profileReadOnly} onChange={(admitted) => set({ admitted })} />
        </Section>

        <Section title="Оплата">
          <TextField label="Должность" value={draft.positionExternalId} readOnly={profileReadOnly} hint="Код должности" onChange={(positionExternalId) => set({ positionExternalId })} />
          {profileReadOnly ? (
            <ReadOnlyField label="Тип оплаты" value={draft.payType ? PAY_TYPE_LABEL[draft.payType] : "—"} />
          ) : (
            <Field label="Тип оплаты">
              {(control) => <Select {...control} value={draft.payType || undefined} onValueChange={(value) => set({ payType: value as PayType })} options={PAY_TYPE_OPTIONS} placeholder="Не указан" />}
            </Field>
          )}
          {profileReadOnly ? (
            <ReadOnlyField label="Ставка" value={formatRate(draft.baseRate, draft.payType || null) ?? "—"} />
          ) : (
            <Field label="Ставка" error={errors.baseRate} hint={rateUnitLabel(draft.payType)}>
              {(control) => <MoneyInput {...control} value={draft.baseRate} onValueChange={(baseRate) => set({ baseRate })} />}
            </Field>
          )}
          <SwitchField label="Базовый вычет ИПН" hint="Применять стандартный вычет при расчёте зарплаты" checked={draft.applyBasicDeduction} disabled={profileReadOnly} onChange={(applyBasicDeduction) => set({ applyBasicDeduction })} />
        </Section>

        <Section
          title="Доступ к кассе"
          actions={
            canEdit ? (
              <>
                <Button variant="secondary" onClick={() => setResetting(true)}>
                  Сбросить PIN
                </Button>
                {card.active ? (
                  <Button variant="danger" onClick={() => setTogglingActive(true)}>
                    Отключить
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => void setActive(true)}>
                    Включить
                  </Button>
                )}
              </>
            ) : null
          }
        >
          <ReadOnlyField label="Код для входа" value={<span className="tabular-nums">{card.code}</span>} />
          {readOnly ? (
            <ReadOnlyField label="Роль на кассе" value={roleLabel(draft.role)} />
          ) : (
            <Field label="Роль на кассе">{(control) => <Select {...control} value={draft.role} onValueChange={(value) => set({ role: value as Role })} options={ROLE_OPTIONS} />}</Field>
          )}
          <div className="md:col-span-2">
            {readOnly ? (
              <ReadOnlyField label="Рестораны" value={card.restaurants.map((restaurant) => restaurant.name).join(", ") || "—"} />
            ) : (
              <RestaurantsField options={mergeOptions(branches, card.restaurants)} value={draft.restaurantExternalIds} onValueChange={(restaurantExternalIds) => set({ restaurantExternalIds })} error={errors.restaurants} />
            )}
          </div>
          {activeError ? (
            <p role="alert" className="text-body-sm text-destructive md:col-span-2">
              {activeError}
            </p>
          ) : null}
        </Section>
      </div>

      {!readOnly ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-panel xl:px-8">
          <p className="text-caption text-muted-foreground">PIN хранится только в виде хеша — его нельзя посмотреть, только сбросить.</p>
          <Button variant="secondary" onClick={() => setDraft(baseline)} disabled={!dirty || saving}>
            Отменить изменения
          </Button>
        </footer>
      ) : null}

      {resetting ? <ResetPinDialog employee={card} onClose={() => setResetting(false)} onReset={mutations.resetPin} /> : null}
      <ConfirmDialog
        open={togglingActive}
        onOpenChange={setTogglingActive}
        title={`Отключить доступ к кассе: ${card.displayName}?`}
        description="Сотрудник не сможет войти на кассу, пока доступ снова не включат. Карточка, явка и история сохранятся."
        confirmLabel="Отключить"
        error={activeError}
        onConfirm={() => setActive(false)}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

/** The saved draft as card fields, so «changed» is measured against the last save. */
function fromDraft(draft: ProfileDraft): Partial<EmployeeCard> {
  return {
    displayName: draft.displayName,
    personnelNumber: draft.personnelNumber || undefined,
    iin: draft.iin || undefined,
    phone: draft.phone || undefined,
    email: draft.email || undefined,
    employmentDate: draft.employmentDate || undefined,
    admitted: draft.admitted,
    positionExternalId: draft.positionExternalId || undefined,
    payType: draft.payType || undefined,
    baseRate: draft.baseRate ?? undefined,
    applyBasicDeduction: draft.applyBasicDeduction,
    role: draft.role,
    restaurants: draft.restaurantExternalIds.map((externalId) => ({ externalId, name: externalId })),
  }
}

function mergeOptions(branches: { externalId: string; name: string }[], current: { externalId: string; name: string }[]) {
  const options = [...branches]
  for (const restaurant of current) if (!options.some((option) => option.externalId === restaurant.externalId)) options.push(restaurant)
  return options
}

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-title-sm font-semibold">{title}</h3>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  )
}

function TextField({
  label,
  value,
  onChange,
  readOnly,
  error,
  hint,
  inputMode,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  readOnly: boolean
  error?: string
  hint?: string
  inputMode?: "numeric" | "tel" | "email"
}) {
  if (readOnly) return <ReadOnlyField label={label} value={value || "—"} />
  return (
    <Field label={label} error={error} hint={hint}>
      {(control) => <Input {...control} autoComplete="off" inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} />}
    </Field>
  )
}

function SwitchField({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-control border border-border p-3">
      <span className="flex flex-col gap-0.5">
        <span className="text-body-sm font-medium text-foreground">{label}</span>
        <span className="text-caption text-muted-foreground">{hint}</span>
      </span>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-body-sm text-foreground">{value}</span>
    </div>
  )
}
