import { describe, expect, it } from "vitest"

import { calculateDiscountAmount, calculateOrderTotal, calculateServiceCharge, orderDiscountAmount, roundKzt } from "../../convex/lib/money"

describe("money (S-10: one rounding rule)", () => {
  it("rounds to whole tenge, half up", () => {
    expect(roundKzt(1234.5)).toBe(1235)
    expect(roundKzt(1234.49)).toBe(1234)
    expect(calculateDiscountAmount(1999, 15)).toBe(300) // 299.85
    expect(calculateDiscountAmount(1990, 5)).toBe(100) // 99.5
  })

  it("charges service on the discounted subtotal, never on a negative base", () => {
    expect(calculateServiceCharge(2000, 500, 15)).toBe(225)
    expect(calculateServiceCharge(2000, 2500, 15)).toBe(0)
    expect(calculateServiceCharge(2000, -200, 10)).toBe(220) // markup raises the base
    expect(calculateOrderTotal(2000, 500, 225)).toBe(1725)
  })

  it("reads the stored discount first and derives the old percent-only ones", () => {
    expect(orderDiscountAmount({ subtotal: 2000, discountPercent: 0, discountAmount: 500 })).toBe(500)
    expect(orderDiscountAmount({ subtotal: 2000, discountPercent: 10 })).toBe(200)
  })
})
