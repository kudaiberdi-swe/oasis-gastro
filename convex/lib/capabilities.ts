// Office capability catalog (W1-ACL-01): office.<section>.<action>, office.<section>.*, "*", plus the
// special office.guests.pii. Sections and their order follow the office navigation (12 groups,
// 91 sections — src/office/model/navigation.ts, same ids as bahandi-pos); the test keeps them in sync.

export const ACTIONS = ["view", "edit", "post", "approve", "reverse", "cancel"] as const
export type CapabilityAction = (typeof ACTIONS)[number]

type SectionKind = "view" | "reference" | "versioned" | "published" | "document" | "approval"

const KIND_ACTIONS: Record<SectionKind, CapabilityAction[]> = {
  view: ["view"],
  reference: ["view", "edit"],
  // Reference data with versions that go live separately (nomenclature: recipe versions, W1-RCP-01).
  versioned: ["view", "edit", "post"],
  // Reference data whose versions are published by approval (retail settings, W1-RTL-01).
  published: ["view", "edit", "approve"],
  document: ["view", "edit", "post", "reverse", "cancel"],
  approval: ["view", "edit", "approve", "post", "reverse", "cancel"],
}

const GROUPS: { id: string; sections: [id: string, kind: SectionKind][] }[] = [
  { id: "home", sections: [["dashboard", "view"], ["favorites", "reference"]] },
  {
    id: "sales",
    sections: [["pos", "view"], ["orders", "document"], ["cash-shifts", "document"], ["payment-types", "published"], ["order-types", "published"], ["discount-types", "published"], ["deletion-reasons", "published"], ["cash-operations", "approval"]],
  },
  {
    id: "stock",
    sections: [
      ["nomenclature", "versioned"], ["product-groups", "reference"], ["modifiers", "reference"], ["size-scales", "reference"], ["price-orders", "document"], ["price-lists", "versioned"],
      ["warehouses", "reference"], ["stock", "view"], ["receipts", "document"], ["outgoing-invoices", "document"], ["supplier-returns", "document"], ["inventories", "document"],
      ["transfers", "document"], ["writeoffs", "document"], ["suppliers", "reference"], ["units", "reference"],
    ],
  },
  {
    id: "production",
    sections: [["production", "document"], ["processing-acts", "document"], ["assembly-acts", "document"], ["sales-acts", "document"], ["purchase-orders", "approval"], ["internal-orders", "approval"], ["kitchen-plan", "reference"], ["kitchen-board", "view"], ["semi-finished-sheet", "document"]],
  },
  {
    id: "finance",
    sections: [
      ["cashflow-categories", "reference"], ["chart-of-accounts", "reference"], ["transactions", "document"], ["shift-acceptance", "document"], ["services", "document"], ["counterparties", "reference"],
      ["accounts-payable", "approval"], ["payments", "approval"], ["bank-statements", "document"], ["payment-calendar", "approval"], ["budgets", "approval"],
    ],
  },
  {
    id: "employees",
    sections: [["employees", "reference"], ["positions", "reference"], ["shift-types", "reference"], ["schedule", "approval"], ["attendance", "document"], ["payroll", "approval"], ["motivation", "published"], ["medical-records", "approval"]],
  },
  { id: "guests", sections: [["guests", "reference"], ["loyalty-programs", "published"], ["guest-categories", "reference"], ["campaigns", "approval"], ["reservations", "approval"]] },
  { id: "delivery", sections: [["delivery-orders", "document"], ["delivery-zones", "reference"], ["couriers", "reference"], ["call-center", "document"], ["telephony", "reference"], ["delivery-sources", "reference"]] },
  { id: "corporation", sections: [["organizations", "reference"], ["restaurants", "reference"], ["departments", "reference"], ["data-exchange", "reference"], ["document-locks", "document"]] },
  {
    id: "exchange",
    sections: [
      ["integration-1c", "reference"], ["integration-edi", "reference"], ["integration-bank", "reference"], ["integration-fiscal", "reference"], ["integration-egais", "view"],
      ["integration-loyalty", "reference"], ["integration-messaging", "reference"], ["integration-maps", "reference"], ["integration-cloud-api", "reference"], ["external-menu", "published"],
    ],
  },
  { id: "admin", sections: [["users", "reference"], ["roles", "reference"], ["terminals", "reference"], ["equipment", "reference"], ["print-templates", "reference"], ["audit-log", "view"], ["system-settings", "reference"], ["integration-jobs", "reference"]] },
  { id: "reports", sections: [["reports", "view"], ["report-favorites", "reference"], ["report-schedules", "reference"]] },
]

export type CapabilitySection = { id: string; groupId: string; actions: CapabilityAction[] }

export const CAPABILITY_CATALOG: CapabilitySection[] = GROUPS.flatMap((group) => group.sections.map(([id, kind]) => ({ id, groupId: group.id, actions: KIND_ACTIONS[kind] })))

/**
 * Personal sections (W3-ADM-13): every signed-in office user holds all their rights, whatever the
 * role — «Избранное» shows only the user's own rows. The role editor does not list them.
 */
export const PERSONAL_SECTIONS: readonly string[] = ["favorites"]

function isPersonalRight(capability: string) {
  return PERSONAL_SECTIONS.some((section) => capability.startsWith(`office.${section}.`))
}

/** Special rights outside the section grammar. */
export const SPECIAL_CAPABILITIES = ["office.guests.pii", "office.employees.pii"] as const

/** "*", office.<section>.*, office.<section>.<allowed action> or a special right. */
export function isValidCapability(capability: string): boolean {
  if (capability === "*" || (SPECIAL_CAPABILITIES as readonly string[]).includes(capability)) return true
  const match = /^office\.([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z*]+)$/.exec(capability)
  if (!match) return false
  const section = CAPABILITY_CATALOG.find((candidate) => candidate.id === match[1])
  if (!section) return false
  return match[2] === "*" || (section.actions as string[]).includes(match[2])
}

/**
 * Rights of the first sandyq office (module-wide) and the sections they cover (§3.0 p. 5). Holding an
 * old right grants the new sections until migration M-6 (W1-ACL-02) rewrites the roles; then this
 * table is removed.
 */
export const LEGACY_CAPABILITY_ALIASES: Record<string, string[]> = {
  "office.catalog": ["nomenclature", "product-groups", "modifiers", "size-scales", "price-orders", "price-lists"],
  "office.stock": ["warehouses", "stock", "receipts", "outgoing-invoices", "supplier-returns", "inventories", "transfers", "writeoffs", "suppliers", "units"],
  "office.finance": ["cashflow-categories", "chart-of-accounts", "transactions", "shift-acceptance", "services", "counterparties", "accounts-payable", "payments", "bank-statements", "payment-calendar", "budgets"],
  "office.workforce": ["employees", "positions", "shift-types", "schedule", "attendance", "payroll", "motivation", "medical-records"],
  "office.loyalty": ["guests", "loyalty-programs", "guest-categories", "campaigns", "reservations"],
  "office.reports": ["reports", "report-favorites", "report-schedules"],
}

function grants(candidate: string, capability: string) {
  return candidate === "*" || candidate === capability || (candidate.endsWith(".*") && capability.startsWith(candidate.slice(0, -1)))
}

/**
 * Expands a legacy module wildcard (office.catalog.*, office.finance.* …) into the section rights it
 * covers. Only the wildcard form is legacy: office.reports.view / office.stock.view are new section
 * rights and grant just their own section.
 */
function expandLegacy(candidate: string): string[] {
  const match = /^(office\.[a-z]+)\.\*$/.exec(candidate)
  const sections = match ? LEGACY_CAPABILITY_ALIASES[match[1]] : undefined
  return sections ? sections.map((section) => `office.${section}.*`) : []
}

/** The one capability rule for backend and office UI. */
export function allowsCapability(capabilities: readonly string[], capability: string): boolean {
  if (isPersonalRight(capability)) return true
  return capabilities.some((candidate) => grants(candidate, capability) || expandLegacy(candidate).some((expanded) => grants(expanded, capability)))
}
