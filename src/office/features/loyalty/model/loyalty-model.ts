import { almatyBusinessDate, formatAlmatyDate } from "@/shared/lib/almaty-time"
import { formatTenge } from "@/shared/lib/format"

import type { ConsentChannel, Guest, GuestCard, GuestCategory, GuestConsent, LoyaltyProgram, SaveCategoryArgs, SaveGuestArgs, SaveProgramArgs } from "../data/use-office-loyalty"

// Pure rules of the loyalty office screens (W1-LOY-04/05/06): drafts, client checks that mirror
// convex/domains/loyalty/office.ts, labels. The server checks everything again.

export type DraftErrors<Key extends string> = Partial<Record<Key, string>>

export const STATUS_TABS = [
  { value: "all", label: "Все" },
  { value: "active", label: "Активные" },
  { value: "inactive", label: "Неактивные" },
] as const

export const PROGRAM_TABS = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновики" },
  { value: "published", label: "Опубликованные" },
  { value: "inactive", label: "Неактивные" },
] as const

export const GENDER_LABELS = {
  female: "Женский",
  male: "Мужской",
  unspecified: "Не указан",
} as const
export type Gender = keyof typeof GENDER_LABELS

export const CONSENT_CHANNELS: { channel: ConsentChannel; label: string }[] = [
  { channel: "personal-data", label: "Обработка персональных данных" },
  { channel: "cross-border", label: "Трансграничная передача данных" },
  { channel: "sms", label: "SMS-рассылки" },
  { channel: "email", label: "Email-рассылки" },
]

export const TRANSACTION_KIND_LABELS: Record<string, string> = {
  accrual: "Начисление",
  redemption: "Списание",
  reservation: "Резерв",
  release: "Снятие резерва",
  expiration: "Сгорание",
  adjustment: "Корректировка",
  reversal: "Сторно",
}

export const PROGRAM_KIND_LABELS = {
  bonus: "Бонусная",
  deposit: "Депозитная",
} as const
export type ProgramKind = keyof typeof PROGRAM_KIND_LABELS

export const ASSIGNMENT_LABELS = {
  manual: "Вручную",
  automatic: "Автоматически",
  default: "По умолчанию",
} as const
export type Assignment = keyof typeof ASSIGNMENT_LABELS

/** Category colors are design-token names (schema: «a design token name, not a hex»); classes are static for Tailwind. */
export const CATEGORY_COLORS: {
  token: string
  label: string
  className: string
}[] = [
  { token: "cat-meat", label: "Гранат", className: "bg-cat-meat" },
  { token: "cat-bread", label: "Медь", className: "bg-cat-bread" },
  { token: "cat-dairy", label: "Сливки", className: "bg-cat-dairy" },
  { token: "cat-tea", label: "Чай", className: "bg-cat-tea" },
  { token: "cat-green", label: "Шалфей", className: "bg-cat-green" },
  { token: "cat-turkistan", label: "Бирюза", className: "bg-cat-turkistan" },
  { token: "accent", label: "Акцент", className: "bg-accent" },
  { token: "gold", label: "Золото", className: "bg-gold" },
  { token: "primary", label: "Вино", className: "bg-primary" },
]

export function categoryColorClass(token: string | undefined) {
  return CATEGORY_COLORS.find((color) => color.token === token)?.className ?? "bg-muted-foreground"
}

/** Personal data the user may not see comes masked with «•»; the server keeps such values as they are. */
export const isMasked = (value: string | undefined | null) => Boolean(value?.includes("•"))

export const guestStatusOf = (guest: Pick<Guest, "status">) => guest.status ?? "active"

/** «+7 701 123 45 67» for a full normalized phone; masked phones are shown as they come. */
export function formatPhone(phone: string | undefined) {
  if (!phone) return "—"
  if (isMasked(phone) || !/^\d{11}$/.test(phone)) return phone.startsWith("7") && !phone.startsWith("+") ? `+${phone}` : phone
  return `+${phone[0]} ${phone.slice(1, 4)} ${phone.slice(4, 7)} ${phone.slice(7, 9)} ${phone.slice(9)}`
}

const text = (value: string | undefined) => value ?? ""

// ── Guests ───────────────────────────────────────────────────────────────────

export type GuestDraft = {
  name: string
  phone: string
  email: string
  birthDate: string
  gender: Gender | ""
  cardNumber: string
  categoryExternalIds: string[]
  notes: string
  restaurantExternalId: string
  personalData: boolean
  crossBorder: boolean
  documentRef: string
}

export function guestDraftOf(guest: GuestCard["guest"] | null): GuestDraft {
  return {
    name: text(guest?.name),
    phone: text(guest?.phone),
    email: text(guest?.email),
    birthDate: text(guest?.birthDate),
    gender: guest?.gender ?? "",
    cardNumber: text(guest?.cardNumber),
    categoryExternalIds: guest?.categoryExternalIds ?? [],
    notes: text(guest?.notes),
    restaurantExternalId: text(guest?.restaurantExternalId),
    personalData: false,
    crossBorder: false,
    documentRef: "",
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateGuest(draft: GuestDraft, isNew: boolean): DraftErrors<keyof GuestDraft> {
  const errors: DraftErrors<keyof GuestDraft> = {}
  if (!draft.name.trim()) errors.name = "Укажите имя гостя"
  const phone = draft.phone.trim()
  if (phone && !isMasked(phone)) {
    const digits = phone.replace(/\D/g, "")
    if (digits.length < 10 || digits.length > 11) errors.phone = "Телефон — 10 или 11 цифр"
  }
  const email = draft.email.trim()
  if (email && !isMasked(email) && !EMAIL.test(email)) errors.email = "Некорректный email"
  if (draft.birthDate && !isMasked(draft.birthDate) && !/^\d{4}-\d{2}-\d{2}$/.test(draft.birthDate)) errors.birthDate = "Дата рождения — ГГГГ-ММ-ДД"
  if (isNew) {
    if (!phone && !email) errors.phone = "Укажите телефон или email"
    if (!draft.personalData) errors.personalData = "Нужно согласие на обработку персональных данных"
    if (!draft.crossBorder) errors.crossBorder = "Нужно согласие на трансграничную передачу"
  }
  return errors
}

/**
 * The saveGuest arguments. Masked values go back unchanged (the server ignores them); notes are
 * only sent by a user who can see them, so a masked card never wipes them.
 */
export function guestSaveArgs(draft: GuestDraft, guest: GuestCard["guest"] | null, canSeePii: boolean): SaveGuestArgs {
  const optional = (value: string) => value.trim() || undefined
  const args: SaveGuestArgs = {
    name: draft.name.trim(),
    phone: optional(draft.phone),
    email: guest ? draft.email.trim() : optional(draft.email),
    birthDate: guest ? draft.birthDate : optional(draft.birthDate),
    gender: draft.gender || undefined,
    cardNumber: optional(draft.cardNumber),
    categoryExternalIds: draft.categoryExternalIds,
    ...(canSeePii ? { notes: draft.notes } : {}),
  }
  if (guest) return { ...args, guestId: guest._id, expectedUpdatedAt: guest.updatedAt }
  return {
    ...args,
    restaurantExternalId: optional(draft.restaurantExternalId),
    consents: {
      personalData: draft.personalData,
      crossBorder: draft.crossBorder,
      ...(draft.documentRef.trim() ? { documentRef: draft.documentRef.trim() } : {}),
    },
  }
}

/** The latest decision per channel: the log is append-only, the newest row wins. */
export function latestConsents(consents: GuestConsent[]): Partial<Record<ConsentChannel, GuestConsent>> {
  const latest: Partial<Record<ConsentChannel, GuestConsent>> = {}
  for (const consent of consents) {
    const current = latest[consent.channel]
    if (!current || consent.recordedAt > current.recordedAt) latest[consent.channel] = consent
  }
  return latest
}

// ── Programs ─────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000

/** «2026-09-25» → start of that day in Almaty. */
export function dateInputToMs(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return Date.UTC(year, month - 1, day) - ALMATY_OFFSET_MS
}

export const msToDateInput = (value: number) => almatyBusinessDate(value)

/** The last day a program works: `endsAt` is exclusive (the start of the next day). */
export const lastProgramDay = (endsAt: number) => msToDateInput(endsAt - 1)

export function programPeriod(program: Pick<LoyaltyProgram, "startsAt" | "endsAt">) {
  const start = formatAlmatyDate(program.startsAt)
  return program.endsAt === undefined ? `с ${start}` : `${start} — ${formatAlmatyDate(program.endsAt - 1)}`
}

export type ProgramDraft = {
  name: string
  programKind: ProgramKind
  accrualPercent: string
  maxRedemptionPercent: string
  welcomeBonus: string
  startsAt: string
  endsAt: string
  categoryExternalId: string
  network: boolean
  restaurantExternalIds: string[]
  expirationDays: string
  priority: string
}

const numberText = (value: number | undefined) => (value === undefined ? "" : String(value).replace(".", ","))

export function programDraftOf(program: LoyaltyProgram | null, today: number, network: boolean): ProgramDraft {
  const everywhere = program ? program.restaurantExternalIds.includes("*") : network
  return {
    name: text(program?.name),
    programKind: program?.programKind ?? "bonus",
    accrualPercent: numberText(program?.accrualPercent ?? 5),
    maxRedemptionPercent: numberText(program?.maxRedemptionPercent ?? 30),
    welcomeBonus: numberText(program?.welcomeBonus ?? 0),
    startsAt: msToDateInput(program?.startsAt ?? today),
    endsAt: program?.endsAt !== undefined ? lastProgramDay(program.endsAt) : "",
    categoryExternalId: text(program?.categoryExternalId),
    network: everywhere,
    restaurantExternalIds: program ? program.restaurantExternalIds.filter((id) => id !== "*") : [],
    expirationDays: numberText(program?.expirationDays),
    priority: numberText(program?.priority ?? 0),
  }
}

const parseNumber = (value: string) => (value.trim() === "" ? null : Number(value.trim().replace(",", ".")))

export function validateProgram(draft: ProgramDraft): DraftErrors<keyof ProgramDraft> {
  const errors: DraftErrors<keyof ProgramDraft> = {}
  if (!draft.name.trim()) errors.name = "Укажите название программы"
  const percent = (key: "accrualPercent" | "maxRedemptionPercent", label: string) => {
    const value = parseNumber(draft[key])
    if (value === null || !Number.isFinite(value) || value < 0 || value > 100) errors[key] = `${label} — от 0 до 100 %`
  }
  percent("accrualPercent", "Начисление")
  percent("maxRedemptionPercent", "Списание")
  const welcome = parseNumber(draft.welcomeBonus)
  if (welcome !== null && !(Number.isInteger(welcome) && welcome >= 0)) errors.welcomeBonus = "Целое неотрицательное число"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startsAt)) errors.startsAt = "Укажите дату начала"
  if (draft.endsAt && !errors.startsAt && draft.endsAt < draft.startsAt) errors.endsAt = "Окончание не раньше начала"
  const expiration = parseNumber(draft.expirationDays)
  if (expiration !== null && !(Number.isInteger(expiration) && expiration > 0)) errors.expirationDays = "Целое число дней больше нуля"
  const priority = parseNumber(draft.priority)
  if (priority === null || !Number.isInteger(priority)) errors.priority = "Целое число"
  if (!draft.network && draft.restaurantExternalIds.length === 0) errors.restaurantExternalIds = "Выберите рестораны программы"
  return errors
}

export function programSaveArgs(draft: ProgramDraft, program: LoyaltyProgram | null): SaveProgramArgs {
  const expiration = parseNumber(draft.expirationDays)
  return {
    ...(program ? { externalId: program.externalId } : {}),
    name: draft.name.trim(),
    programKind: draft.programKind,
    accrualPercent: parseNumber(draft.accrualPercent) ?? 0,
    maxRedemptionPercent: parseNumber(draft.maxRedemptionPercent) ?? 0,
    welcomeBonus: parseNumber(draft.welcomeBonus) ?? 0,
    startsAt: dateInputToMs(draft.startsAt),
    ...(draft.endsAt ? { endsAt: dateInputToMs(draft.endsAt) + DAY_MS } : {}),
    ...(draft.categoryExternalId ? { categoryExternalId: draft.categoryExternalId } : {}),
    restaurantExternalIds: draft.network ? ["*"] : draft.restaurantExternalIds,
    ...(expiration !== null ? { expirationDays: expiration } : {}),
    priority: parseNumber(draft.priority) ?? 0,
  }
}

// ── Categories ───────────────────────────────────────────────────────────────

export type CategoryDraft = {
  code: string
  name: string
  color: string
  assignment: Assignment
  minimumSpend: number | null
  minimumVisits: string
  validDays: string
  active: boolean
}

export function categoryDraftOf(category: GuestCategory | null): CategoryDraft {
  return {
    code: text(category?.code),
    name: text(category?.name),
    color: category?.color ?? CATEGORY_COLORS[0].token,
    assignment: category?.assignment ?? "manual",
    minimumSpend: category?.minimumSpend ?? 0,
    minimumVisits: String(category?.minimumVisits ?? 0),
    validDays: String(category?.validDays ?? 0),
    active: category?.active ?? true,
  }
}

const wholeNumber = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : null)

export function validateCategory(draft: CategoryDraft, others: GuestCategory[]): DraftErrors<keyof CategoryDraft> {
  const errors: DraftErrors<keyof CategoryDraft> = {}
  const code = draft.code.trim().toLocaleLowerCase("en-US")
  if (!/^[a-z0-9-]{2,32}$/.test(code)) errors.code = "Код — латиница, цифры и дефис, от 2 до 32 символов"
  else if (others.some((row) => row.code === code)) errors.code = "Код категории уже занят"
  if (!draft.name.trim()) errors.name = "Укажите название"
  if (draft.minimumSpend === null || draft.minimumSpend < 0) errors.minimumSpend = "Целое неотрицательное число"
  if (wholeNumber(draft.minimumVisits) === null) errors.minimumVisits = "Целое неотрицательное число"
  if (wholeNumber(draft.validDays) === null) errors.validDays = "Целое неотрицательное число"
  return errors
}

export function categorySaveArgs(draft: CategoryDraft, category: GuestCategory | null): SaveCategoryArgs {
  return {
    ...(category ? { externalId: category.externalId } : {}),
    code: draft.code.trim().toLocaleLowerCase("en-US"),
    name: draft.name.trim(),
    color: draft.color,
    assignment: draft.assignment,
    minimumSpend: draft.minimumSpend ?? 0,
    minimumVisits: wholeNumber(draft.minimumVisits) ?? 0,
    validDays: wholeNumber(draft.validDays) ?? 0,
    active: draft.active,
  }
}

/** «Условие» column: how a guest gets the category. */
export function categoryCondition(category: Pick<GuestCategory, "assignment" | "minimumSpend" | "minimumVisits" | "validDays">) {
  if (category.assignment !== "automatic") return ASSIGNMENT_LABELS[category.assignment]
  const parts = [
    category.minimumSpend > 0 ? `оборот от ${formatTenge(category.minimumSpend)}` : null,
    category.minimumVisits > 0 ? `от ${category.minimumVisits} визитов` : null,
    category.validDays > 0 ? `за ${category.validDays} дн.` : null,
  ].filter(Boolean)
  return parts.length ? `Авто: ${parts.join(" · ")}` : "Автоматически"
}
