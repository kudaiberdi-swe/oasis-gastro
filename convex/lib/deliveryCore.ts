import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"

type QueryCtx = GenericQueryCtx<DataModel>

// Delivery core (W2-DLV-01): zone geometry and the status machine, shared by office and future channels.

export type GeoPoint = { latitude: number; longitude: number }
export type DeliveryStatus = Doc<"deliveryOrders">["status"]

const EPSILON = 1e-12

function onSegment(point: GeoPoint, a: GeoPoint, b: GeoPoint) {
  const cross = (b.longitude - a.longitude) * (point.latitude - a.latitude) - (b.latitude - a.latitude) * (point.longitude - a.longitude)
  if (Math.abs(cross) > EPSILON) return false
  return point.longitude >= Math.min(a.longitude, b.longitude) - EPSILON && point.longitude <= Math.max(a.longitude, b.longitude) + EPSILON && point.latitude >= Math.min(a.latitude, b.latitude) - EPSILON && point.latitude <= Math.max(a.latitude, b.latitude) + EPSILON
}

/** Ray casting; a point on the border counts as inside (an address on the zone's edge is delivered). */
export function pointInPolygon(point: GeoPoint, polygon: GeoPoint[]) {
  if (polygon.length < 3) return false
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]
    const before = polygon[previous]
    if (onSegment(point, before, current)) return true
    const crosses = current.latitude > point.latitude !== before.latitude > point.latitude
    if (crosses && point.longitude < ((before.longitude - current.longitude) * (point.latitude - current.latitude)) / (before.latitude - current.latitude) + current.longitude) inside = !inside
  }
  return inside
}

function orientation(a: GeoPoint, b: GeoPoint, c: GeoPoint) {
  const value = (b.longitude - a.longitude) * (c.latitude - a.latitude) - (b.latitude - a.latitude) * (c.longitude - a.longitude)
  return Math.abs(value) < EPSILON ? 0 : value > 0 ? 1 : -1
}

function segmentsIntersect(a: GeoPoint, b: GeoPoint, c: GeoPoint, d: GeoPoint) {
  const [o1, o2, o3, o4] = [orientation(a, b, c), orientation(a, b, d), orientation(c, d, a), orientation(c, d, b)]
  if (o1 !== o2 && o3 !== o4) return true
  return (o1 === 0 && onSegment(c, a, b)) || (o2 === 0 && onSegment(d, a, b)) || (o3 === 0 && onSegment(a, c, d)) || (o4 === 0 && onSegment(b, c, d))
}

/** True when two non-adjacent edges of the closed polygon touch or cross. */
export function polygonSelfIntersects(polygon: GeoPoint[]) {
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsIntersect(polygon[i], polygon[(i + 1) % n], polygon[j], polygon[(j + 1) % n])) return true
    }
  }
  return false
}

export const deliveryTransitions: Record<DeliveryStatus, DeliveryStatus[]> = {
  unprocessed: ["unconfirmed", "waiting", "cancelled"],
  unconfirmed: ["waiting", "ready-to-cook", "cancelled"],
  waiting: ["ready-to-cook", "cancelled"],
  "ready-to-cook": ["cooking", "cancelled"],
  cooking: ["cooked", "cancelled"],
  cooked: ["awaiting-dispatch", "on-way", "cancelled"],
  "awaiting-dispatch": ["on-way", "cancelled"],
  "on-way": ["delivered", "cancelled"],
  delivered: ["closed", "on-way"],
  closed: [],
  cancelled: [],
}

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus) {
  return deliveryTransitions[from]?.includes(to) ?? false
}

export const OPEN_DELIVERY_STATUSES: DeliveryStatus[] = ["unprocessed", "unconfirmed", "waiting", "ready-to-cook", "cooking", "cooked", "awaiting-dispatch", "on-way"]

/** The active zone containing the point with the highest priority. */
export async function findZone(ctx: QueryCtx, restaurantExternalId: string, point: GeoPoint) {
  const zones = await ctx.db.query("deliveryZones").withIndex("by_restaurant_active", (q) => q.eq("restaurantExternalId", restaurantExternalId).eq("active", true)).order("desc").take(100)
  return zones.find((zone) => pointInPolygon(point, zone.polygon)) ?? null
}
