import type { CapabilityAction } from "./capabilities"

export type DomainStatus = "draft" | "pending-approval" | "approved" | "posted" | "reversed" | "cancelled" | "active" | "inactive" | "published" | "expired"

/** OFFICE-DESIGN §3.5: master (active ⇄ inactive), publish, approval, document. */
export type Lifecycle = "master" | "publish" | "approval" | "document"

export type DomainAction = "activate" | "deactivate" | "publish" | "expire" | "submit" | "approve" | "post" | "reverse" | "cancel"

type Transition = { from: DomainStatus[]; to: DomainStatus; capability: CapabilityAction }

// Which transitions each lifecycle allows, and the right each needs (submit/save → edit, approve →
// approve, post → post, reverse → reverse, cancel → cancel).
export const LIFECYCLES: Record<Lifecycle, { initial: DomainStatus; editable: DomainStatus[]; transitions: Partial<Record<DomainAction, Transition>> }> = {
  master: {
    initial: "active",
    editable: ["active", "inactive"],
    transitions: {
      activate: { from: ["inactive"], to: "active", capability: "edit" },
      deactivate: { from: ["active"], to: "inactive", capability: "edit" },
    },
  },
  publish: {
    initial: "draft",
    editable: ["draft"],
    transitions: {
      publish: { from: ["draft", "inactive"], to: "published", capability: "edit" },
      deactivate: { from: ["published"], to: "inactive", capability: "edit" },
      expire: { from: ["published"], to: "expired", capability: "edit" },
    },
  },
  approval: {
    initial: "draft",
    editable: ["draft"],
    transitions: {
      submit: { from: ["draft"], to: "pending-approval", capability: "edit" },
      approve: { from: ["pending-approval"], to: "approved", capability: "approve" },
      post: { from: ["approved"], to: "posted", capability: "post" },
      reverse: { from: ["posted"], to: "reversed", capability: "reverse" },
      cancel: { from: ["draft", "pending-approval", "approved"], to: "cancelled", capability: "cancel" },
    },
  },
  document: {
    initial: "draft",
    editable: ["draft"],
    transitions: {
      post: { from: ["draft"], to: "posted", capability: "post" },
      reverse: { from: ["posted"], to: "reversed", capability: "reverse" },
      cancel: { from: ["draft"], to: "cancelled", capability: "cancel" },
    },
  },
}

const STATUS_LABELS: Record<DomainStatus, string> = {
  draft: "Черновик",
  "pending-approval": "На согласовании",
  approved: "Согласовано",
  posted: "Проведён",
  reversed: "Сторнирован",
  cancelled: "Отменён",
  active: "Активно",
  inactive: "Неактивно",
  published: "Опубликовано",
  expired: "Истекло",
}

const ACTION_LABELS: Record<DomainAction, string> = {
  activate: "включить",
  deactivate: "отключить",
  publish: "опубликовать",
  expire: "завершить",
  submit: "отправить на согласование",
  approve: "согласовать",
  post: "провести",
  reverse: "сторнировать",
  cancel: "отменить",
}

export function transitionFor(lifecycle: Lifecycle, action: DomainAction) {
  return LIFECYCLES[lifecycle].transitions[action]
}

export function transitionError(action: DomainAction, status: DomainStatus) {
  return `Нельзя ${ACTION_LABELS[action]}: запись в статусе «${STATUS_LABELS[status]}»`
}
