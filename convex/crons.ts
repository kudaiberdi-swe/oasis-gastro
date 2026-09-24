import { cronJobs } from "convex/server"

import { internal } from "./_generated/api"

const crons = cronJobs()

crons.interval("cleanup expired pos sessions", { hours: 1 }, internal.domains.auth.internal.cleanupExpiredSessions, {})
crons.interval("publish transactional outbox", { minutes: 1 }, internal.domains.integrations.internal.publishOutboxEvents, {})
crons.interval("process integration jobs", { minutes: 1 }, internal.domains.integrations.internal.processIntegrationJobs, {})

export default crons
