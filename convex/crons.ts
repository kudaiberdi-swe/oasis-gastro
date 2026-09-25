import { cronJobs } from "convex/server"

import { internal } from "./_generated/api"

const crons = cronJobs()

crons.interval("cleanup expired pos sessions", { hours: 1 }, internal.domains.auth.internal.cleanupExpiredSessions, {})
crons.interval("publish transactional outbox", { minutes: 1 }, internal.domains.integrations.internal.publishOutboxEvents, {})
crons.interval("process integration jobs", { minutes: 1 }, internal.domains.integrations.internal.processIntegrationJobs, {})
crons.daily("recalculate guest categories", { hourUTC: 21, minuteUTC: 30 }, internal.domains.loyalty.office.recalculateGuestCategories, { cursor: null })
crons.daily("rebuild yesterday sales facts", { hourUTC: 22, minuteUTC: 0 }, internal.domains.reports.internal.rebuildYesterday, {})
crons.interval("flag shifts open over 24 hours", { hours: 1 }, internal.domains.pos.internal.flagLongShifts, {})
crons.interval("expire retail settings", { minutes: 10 }, internal.domains.retail.internal.expireSettings, {})
crons.daily("expire loyalty points", { hourUTC: 22, minuteUTC: 0 }, internal.domains.loyalty.expiry.expireLoyaltyPoints, {})
crons.interval("release stale loyalty reservations", { minutes: 10 }, internal.domains.loyalty.expiry.releaseStaleReservations, {})
crons.interval("reconcile price order statuses", { minutes: 1 }, internal.domains.pricing.crons.reconcileStatuses, {})

export default crons
