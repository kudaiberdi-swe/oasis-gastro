import { cronJobs } from "convex/server"

import { internal } from "./_generated/api"

const crons = cronJobs()

crons.interval("cleanup expired pos sessions", { hours: 1 }, internal.domains.auth.internal.cleanupExpiredSessions, {})

export default crons
