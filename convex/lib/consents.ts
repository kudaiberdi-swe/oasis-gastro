import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"

type QueryCtx = GenericQueryCtx<DataModel>

export type ConsentChannel = Doc<"guestConsents">["channel"]
export type MessagingChannel = "sms" | "email"

/**
 * A consent is in force when the latest event of the channel (guestConsents is append-only) grants it
 * and its validUntil, if any, has not passed.
 */
export async function hasActiveConsent(ctx: QueryCtx, guestId: Id<"guests">, channel: ConsentChannel, now = Date.now()) {
  const latest = await ctx.db
    .query("guestConsents")
    .withIndex("by_guest_channel_recorded", (q) => q.eq("guestId", guestId).eq("channel", channel))
    .order("desc")
    .first()
  return Boolean(latest?.granted && (latest.validUntil === undefined || latest.validUntil > now))
}

/**
 * Whether a guest may receive a mailing on a channel (Г-2): an active guest whose consent state is
 * known and granted (POS guests stay «unknown» and are excluded), with consent to personal data and to
 * the channel in force, and a contact for it.
 */
export async function canMessageGuest(ctx: QueryCtx, guest: Doc<"guests">, channel: MessagingChannel, now = Date.now()) {
  if (guest.status === "inactive" || guest.consentState !== "granted") return false
  if (channel === "sms" ? !guest.phone : !guest.email) return false
  return (await hasActiveConsent(ctx, guest._id, "personal-data", now)) && (await hasActiveConsent(ctx, guest._id, channel, now))
}
