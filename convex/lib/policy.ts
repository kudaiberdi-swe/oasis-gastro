/** Manager-approval threshold for a discount on a single order (percent). */
export const DISCOUNT_APPROVAL_PERCENT = 10

/** Manager-approval threshold for a shift-close cash variance (tenge). */
export const VARIANCE_APPROVAL_KZT = 1000

/** Restaurant-wide service charge, printed on every Sandyq menu as "Қызмет ақысы 15%". */
export const SERVICE_CHARGE_PERCENT = 15

/** Operator PIN session lifetime. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

/** Manager-approval PIN session lifetime — deliberately short, single-use by construction. */
export const APPROVAL_TTL_MS = 5 * 60 * 1000

/** Failed-PIN lockout threshold and duration. */
export const LOCKOUT_THRESHOLD = 5
export const LOCKOUT_DURATION_MS = 10 * 60 * 1000

/** Idle-lock timeout applied client-side after the last POS interaction. */
export const IDLE_LOCK_MS = 5 * 60 * 1000
