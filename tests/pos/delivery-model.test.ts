import { describe, expect, it } from "vitest"

import { addProduct, isMaskedPhone, saveArgs, validateDraft, type DeliveryDraft } from "@/office/features/delivery/model/order-draft"
import { needsPayment, quickTransition, transitionActions } from "@/office/features/delivery/model/statuses"
import { formatCoordinates, parseCoordinates, polygonProblem, projectPolygon } from "@/office/features/delivery/model/zone-polygon"
import { describeStatus } from "@/shared/lib/status-dictionary"

// W2-DLV-03/05/06: the delivery model of the office — coordinates parser, transitions, the order form.

describe("zone coordinates parser (W2-DLV-06)", () => {
  it("reads one latitude,longitude per line in the usual separators and skips blank lines", () => {
    const parsed = parseCoordinates("43.2567,76.9286\n\n43.2601, 76.9530\n43,2402; 76,9555\n  43.25 76.94  ")
    expect(parsed.errors).toEqual([])
    expect(parsed.points).toEqual([
      { latitude: 43.2567, longitude: 76.9286 },
      { latitude: 43.2601, longitude: 76.953 },
      { latitude: 43.2402, longitude: 76.9555 },
      { latitude: 43.25, longitude: 76.94 },
    ])
  })

  it("reports every bad line with its number and range errors", () => {
    const parsed = parseCoordinates("43.25,76.9\nабв\n95,76\n43,200\n-43.1,-76.2")
    expect(parsed.points).toEqual([
      { latitude: 43.25, longitude: 76.9 },
      { latitude: -43.1, longitude: -76.2 },
    ])
    expect(parsed.errors).toEqual([
      { line: 2, message: "Нужен формат latitude,longitude" },
      { line: 3, message: "Широта должна быть от −90 до 90" },
      { line: 4, message: "Долгота должна быть от −180 до 180" },
    ])
  })

  it("round-trips through formatCoordinates", () => {
    const points = [
      { latitude: 43.1, longitude: 76.1 },
      { latitude: 43.2, longitude: 76.3 },
    ]
    expect(parseCoordinates(formatCoordinates(points)).points).toEqual(points)
  })

  it("explains why a polygon cannot be saved, in the server's words", () => {
    expect(polygonProblem(parseCoordinates("43,76\n43.1,76.1"))).toBe("Зона должна содержать минимум три точки")
    expect(polygonProblem(parseCoordinates("43,76\nx"))).toBe("Строка 2: нужен формат latitude,longitude")
    // A bow tie: the edges 1→2 and 3→4 cross.
    expect(polygonProblem(parseCoordinates("0,0\n1,1\n0,1\n1,0"))).toBe("Границы зоны пересекают сами себя")
    expect(polygonProblem(parseCoordinates("0,0\n0,1\n1,1\n1,0"))).toBeNull()
  })

  it("projects the polygon north-up into the preview box", () => {
    const { points, path } = projectPolygon(
      [
        { latitude: 43.3, longitude: 76.9 },
        { latitude: 43.2, longitude: 76.9 },
        { latitude: 43.2, longitude: 77.0 },
      ],
      240,
      16,
    )
    expect(points).toHaveLength(3)
    // The northern point is above (smaller y) the southern ones; everything stays inside the box.
    expect(points[0].y).toBeLessThan(points[1].y)
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(16)
      expect(point.x).toBeLessThanOrEqual(224)
      expect(point.y).toBeGreaterThanOrEqual(16)
      expect(point.y).toBeLessThanOrEqual(224)
    }
    expect(path.startsWith("M ")).toBe(true)
    expect(path.endsWith(" Z")).toBe(true)
    expect(projectPolygon([])).toEqual({ points: [], path: "" })
  })
})

describe("delivery transitions (W2-DLV-03)", () => {
  it("offers the server's next statuses, the first forward move as the main one and «Отменить» last", () => {
    expect(transitionActions("unprocessed", { canEdit: true, canCancel: true })).toEqual([
      { to: "unconfirmed", label: "Ждёт подтверждения", kind: "primary" },
      { to: "waiting", label: "Подтвердить", kind: "secondary" },
      { to: "cancelled", label: "Отменить", kind: "danger" },
    ])
    expect(transitionActions("waiting", { canEdit: true, canCancel: false }).map((action) => action.label)).toEqual(["Пора готовить"])
    expect(transitionActions("delivered", { canEdit: true, canCancel: true }).map((action) => [action.label, action.kind])).toEqual([
      ["Закрыть", "primary"],
      ["Вернуть в путь", "secondary"],
    ])
    expect(transitionActions("closed", { canEdit: true, canCancel: true })).toEqual([])
    expect(transitionActions("cooking", { canEdit: false, canCancel: true }).map((action) => action.to)).toEqual(["cancelled"])
  })

  it("keeps quick row actions to moves that need no courier or payment", () => {
    expect(quickTransition("waiting")).toBe("ready-to-cook")
    expect(quickTransition("cooking")).toBe("cooked")
    expect(quickTransition("awaiting-dispatch")).toBeNull()
    expect(quickTransition("on-way")).toBeNull()
    expect(quickTransition("cancelled")).toBeNull()
  })

  it("asks for the payment exactly where transitionOrder settles the order", () => {
    expect(needsPayment("delivered", "on-delivered", "unpaid")).toBe(true)
    expect(needsPayment("delivered", "on-closed", "unpaid")).toBe(false)
    expect(needsPayment("closed", "on-closed", "unpaid")).toBe(true)
    // An order not paid at delivery is paid at close whatever the source says.
    expect(needsPayment("closed", "on-delivered", "unpaid")).toBe(true)
    expect(needsPayment("closed", "on-delivered", "paid")).toBe(false)
    expect(needsPayment("on-way", "on-delivered", "unpaid")).toBe(false)
  })

  it("labels every delivery, courier, transport and price list status in Russian", () => {
    expect(describeStatus("delivery", "ready-to-cook")).toMatchObject({ label: "Пора готовить", known: true })
    expect(describeStatus("delivery", "awaiting-dispatch").label).toBe("Ждёт отправки")
    expect(describeStatus("courier", "on-delivery").label).toBe("На доставке")
    expect(describeStatus("transport", "scooter").label).toBe("Самокат")
    expect(describeStatus("price-list", "expired").label).toBe("Истёк")
  })
})

function draft(overrides: Partial<DeliveryDraft> = {}): DeliveryDraft {
  return {
    restaurantExternalId: "r1",
    customerName: "Айгерим",
    phone: "+7 701 555 12 34",
    email: "",
    address: "Абая 10, кв. 5",
    latitude: "43,2389",
    longitude: "76.8897",
    sourceExternalId: "source-phone",
    expectedAt: "2026-09-25T19:30",
    courierExternalId: "",
    comment: " Домофон 5 ",
    lines: addProduct([], { productExternalId: "p-beshbarmak", name: "Бешбармак", price: 4500 }),
    ...overrides,
  }
}

describe("delivery order form (W2-DLV-05)", () => {
  it("validates the guest, the address, both coordinates and the lines", () => {
    expect(validateDraft(draft())).toEqual({ rows: {} })
    const errors = validateDraft(draft({ customerName: "А", phone: "123", address: "", longitude: "", lines: [] }))
    expect(errors).toMatchObject({ customerName: "Укажите имя гостя", phone: "Телефон — от 10 до 15 цифр", address: "Укажите адрес", longitude: "Укажите обе координаты — по ним выбирается зона доставки", lines: "Добавьте хотя бы одну позицию" })
  })

  it("sends the Almaty time, parsed coordinates and lines without prices — the server prices them", () => {
    const args = saveArgs(draft(), { channel: "call-center" })
    expect(args).toMatchObject({ channel: "call-center", restaurantExternalId: "r1", latitude: 43.2389, longitude: 76.8897, comment: "Домофон 5", expectedAt: Date.parse("2026-09-25T14:30:00Z") })
    expect(args.lines).toEqual([{ productExternalId: "p-beshbarmak", quantity: 1 }])
    expect("externalId" in args).toBe(false)
    expect(saveArgs(draft(), { channel: "delivery", externalId: "delivery-1", expectedVersion: 3 })).toMatchObject({ externalId: "delivery-1", expectedVersion: 3 })
  })

  it("adds the same dish as +1 and recognizes a masked phone", () => {
    const lines = addProduct(draft().lines, { productExternalId: "p-beshbarmak", name: "Бешбармак", price: 4500 })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ quantity: "2", unitPrice: 4500, lineTotal: null })
    expect(isMaskedPhone("7701••••34")).toBe(true)
    expect(isMaskedPhone("77015551234")).toBe(false)
  })
})
