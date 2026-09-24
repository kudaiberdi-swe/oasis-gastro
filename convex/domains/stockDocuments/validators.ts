import { v } from "convex/values"

export const stockDocumentType = v.union(v.literal("outgoing-invoice"), v.literal("supplier-return"), v.literal("inventory"), v.literal("transfer"), v.literal("writeoff"))
export const documentStatus = v.union(v.literal("draft"), v.literal("posted"), v.literal("reversed"))
