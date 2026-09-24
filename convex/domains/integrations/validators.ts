import { v } from "convex/values"

export const integrationJobStatus = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("retrying"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("dead-letter"),
  v.literal("cancelled"),
)
