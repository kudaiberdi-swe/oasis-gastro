import { describe, expect, it } from "vitest"

import {
  clientToGrid,
  containsPoint,
  freeSpot,
  hitResizeHandle,
  hitTest,
  moveTable,
  nextTableLabel,
  nudgeTable,
  planViewBox,
  resizeTable,
  rotatePoint,
  snapToGrid,
  tableBounds,
  tableOccupancy,
  type PlanTable,
} from "@/office/features/loyalty/model/floor-plan"
import { dateInputToMs } from "@/office/features/loyalty/model/loyalty-model"
import { almatyMoment, draftPeriod, formatTimeRange, paymentTypeServes, reservationDraftOf, reservationSaveArgs, shiftDate, validateReservation } from "@/office/features/loyalty/model/reservations"

// W2-LOY-07: geometry of the floor plan (hit test, snapping, pointer → grid) and the booking card rules.

const table = (overrides: Partial<PlanTable> = {}): PlanTable => ({ label: "Стол 1", capacity: 4, shape: "rect", x: 2, y: 3, width: 2, height: 2, rotation: 0, active: true, ...overrides })
const close = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 6)

describe("floor plan geometry", () => {
  it("snaps to the grid without float dust or −0", () => {
    expect(snapToGrid(2.4)).toBe(2)
    expect(snapToGrid(2.6)).toBe(3)
    expect(snapToGrid(-0.2)).toBe(0)
    expect(Object.is(snapToGrid(-0.2), -0)).toBe(false)
    expect(snapToGrid(1.26, 0.5)).toBe(1.5)
    expect(snapToGrid(0.1 + 0.2, 0.1)).toBe(0.3)
  })

  it("converts pointer pixels to grid units with one scale (preserveAspectRatio meet, top-left)", () => {
    const viewBox = { x: 0, y: 0, width: 24, height: 14 }
    // 960×560 px → 40 px per cell on both axes.
    expect(clientToGrid({ x: 100 + 80, y: 50 + 120 }, { left: 100, top: 50, width: 960, height: 560 }, viewBox)).toEqual({ x: 2, y: 3 })
    // A wider box letterboxes: the scale comes from the height (560 / 14 = 40), the plan starts at the left edge.
    expect(clientToGrid({ x: 40, y: 40 }, { left: 0, top: 0, width: 2000, height: 560 }, viewBox)).toEqual({ x: 1, y: 1 })
    // Not laid out yet (jsdom, hidden tab): no point instead of NaN.
    expect(clientToGrid({ x: 10, y: 10 }, { left: 0, top: 0, width: 0, height: 0 }, viewBox)).toBeNull()
  })

  it("hits rectangles by their bounds and circles by the ellipse, not the bounding box", () => {
    const rect = table()
    expect(containsPoint(rect, { x: 2, y: 3 })).toBe(true) // the corner is on the table
    expect(containsPoint(rect, { x: 3.9, y: 4.9 })).toBe(true)
    expect(containsPoint(rect, { x: 4.1, y: 4 })).toBe(false)

    const round = table({ shape: "circle" })
    expect(containsPoint(round, { x: 3, y: 4 })).toBe(true) // the center
    expect(containsPoint(round, { x: 2.1, y: 3.1 })).toBe(false) // a corner of the bounding box is outside the circle
    expect(containsPoint(round, { x: 3.99, y: 4 })).toBe(true)

    const oval = table({ shape: "circle", width: 4, height: 2 })
    expect(containsPoint(oval, { x: 5.9, y: 4 })).toBe(true)
    expect(containsPoint(oval, { x: 4, y: 4.99 })).toBe(true)
    expect(containsPoint(oval, { x: 5.5, y: 4.9 })).toBe(false)
  })

  it("honours rotation: a 4×1 table turned 90° is hit along the vertical axis", () => {
    const long = table({ x: 0, y: 0, width: 4, height: 1, rotation: 90 })
    // Center (2, 0.5); rotated it spans x 1.5…2.5, y −1.5…2.5.
    expect(containsPoint(long, { x: 2, y: 2.3 })).toBe(true)
    expect(containsPoint(long, { x: 3.5, y: 0.5 })).toBe(false)
    const bounds = tableBounds(long)
    close(bounds.x, 1.5)
    close(bounds.width, 1)
    close(bounds.height, 4)
    const turned = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90)
    close(turned.x, 0)
    close(turned.y, 1)
  })

  it("the table drawn last wins where two overlap; empty space hits nothing", () => {
    const below = table({ externalId: "t-below" })
    const above = table({ externalId: "t-above", x: 3, y: 4 })
    expect(hitTest([below, above], { x: 3.5, y: 4.5 })?.externalId).toBe("t-above")
    expect(hitTest([below, above], { x: 2.5, y: 3.5 })?.externalId).toBe("t-below")
    expect(hitTest([below, above], { x: 10, y: 10 })).toBeNull()
  })

  it("the resize handle sits in the bottom-right corner", () => {
    const rect = table()
    expect(hitResizeHandle(rect, { x: 3.8, y: 4.8 })).toBe(true)
    expect(hitResizeHandle(rect, { x: 4.2, y: 5.2 })).toBe(true) // a little outside still grabs it
    expect(hitResizeHandle(rect, { x: 3, y: 4 })).toBe(false)
  })

  it("drag moves by the pointer delta, snaps and stays on the plan; resize keeps the corner and a minimal side", () => {
    const rect = table()
    const grab = { origin: { x: 2, y: 3 }, pointer: { x: 2.5, y: 3.5 } }
    expect(moveTable(rect, grab, { x: 5.1, y: 3.4 })).toMatchObject({ x: 5, y: 3 })
    expect(moveTable(rect, grab, { x: -4, y: -4 })).toMatchObject({ x: 0, y: 0 })
    expect(moveTable(rect, grab, { x: 2.6, y: 3.6 })).toBe(rect) // same cell — no new object, no re-render
    expect(resizeTable(rect, { x: 6.2, y: 4.4 })).toMatchObject({ x: 2, y: 3, width: 4, height: 1 })
    expect(resizeTable(rect, { x: 1, y: 1 })).toMatchObject({ width: 1, height: 1 })
    expect(nudgeTable(rect, 1, -1)).toMatchObject({ x: 3, y: 2 })
    expect(nudgeTable(table({ x: 0 }), -1, 0)).toMatchObject({ x: 0 })
  })

  it("the plan is at least 24×14 cells and grows with the tables", () => {
    expect(planViewBox([])).toEqual({ x: 0, y: 0, width: 24, height: 14 })
    expect(planViewBox([table({ x: 30, y: 1, width: 3 })])).toEqual({ x: 0, y: 0, width: 35, height: 14 })
  })

  it("a new table goes to the first free spot, one cell away from the others; labels continue the numbering", () => {
    expect(freeSpot([], { width: 2, height: 2 })).toEqual({ x: 1, y: 1 })
    expect(freeSpot([table({ x: 1, y: 1 })], { width: 2, height: 2 })).toEqual({ x: 4, y: 1 })
    expect(nextTableLabel([{ label: "Стол 4" }, { label: "VIP 7" }, { label: "Бар" }])).toBe("Стол 8")
    expect(nextTableLabel([])).toBe("Стол 1")
  })

  it("the colour follows the most binding booking of the day; cancelled ones do not count", () => {
    expect(tableOccupancy([])).toBe("free")
    expect(tableOccupancy([{ status: "cancelled" }])).toBe("free")
    expect(tableOccupancy([{ status: "draft" }, { status: "completed" }])).toBe("draft")
    expect(tableOccupancy([{ status: "draft" }, { status: "approved" }, { status: "pending-approval" }])).toBe("approved")
  })
})

describe("booking card rules", () => {
  it("Almaty wall-clock time: 19:00 on 2026-10-01 is 14:00 UTC", () => {
    expect(almatyMoment("2026-10-01", "19:00")).toBe(Date.UTC(2026, 9, 1, 14, 0))
    expect(almatyMoment("2026-10-01", "25:00")).toBeNull()
    expect(shiftDate("2026-09-30", 1)).toBe("2026-10-01")
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28")
  })

  it("an end not after the start is the next day (a banquet past midnight)", () => {
    const period = draftPeriod({ date: "2026-10-01", startTime: "20:00", endTime: "02:00" })!
    expect(period.nextDay).toBe(true)
    expect(period.end - period.start).toBe(6 * 3_600_000)
    expect(formatTimeRange(period.start, period.end)).toBe("20:00–02:00 (+1)")
    expect(formatTimeRange(almatyMoment("2026-10-01", "19:00")!, almatyMoment("2026-10-01", "21:00")!)).toBe("19:00–21:00")
  })

  it("a new card starts at 19:00–22:00 with the table picked on the plan", () => {
    const draft = reservationDraftOf(null, { date: "2026-10-01", hall: "Основной зал", tableExternalIds: ["t4"] })
    expect(draft).toMatchObject({ date: "2026-10-01", hall: "Основной зал", tableExternalIds: ["t4"], startTime: "19:00", endTime: "22:00", guestCount: "2", recordType: "reservation" })
    expect(reservationDraftOf(null, { date: "2026-10-01", startTime: "22:30" }).endTime).toBe("01:30")
  })

  it("checks what the server checks, including the capacity of the chosen tables", () => {
    const capacity = (id: string) => ({ t4: 4, t5: 2 })[id]
    const draft = { ...reservationDraftOf(null, { date: "2026-10-01" }), guestCount: "5" }
    expect(validateReservation(draft, capacity)).toMatchObject({ hall: "Выберите зал", tableExternalIds: "Выберите стол", guestName: "Укажите имя гостя", phone: "Телефон — 10–15 цифр" })

    const filled = { ...draft, hall: "Основной зал", tableExternalIds: ["t4"], guestName: "Айгерим", phone: "+7 701 555 11 22" }
    expect(validateReservation(filled, capacity)).toEqual({ guestCount: "Вместимость выбранных столов — 4, гостей 5" })
    expect(validateReservation({ ...filled, tableExternalIds: ["t4", "t5"] }, capacity)).toEqual({})
    expect(validateReservation({ ...filled, tableExternalIds: ["t4", "t5"], prepayment: 10_000 }, capacity)).toEqual({ prepaymentTypeExternalId: "Укажите тип оплаты предоплаты" })
    // A masked phone (no PII right) is not the user's input to check.
    expect(validateReservation({ ...filled, tableExternalIds: ["t4", "t5"], phone: "7701•••••22" }, capacity)).toEqual({})
  })

  it("save arguments: Almaty start/end, tenge, the payment type only with an advance", () => {
    const draft = { ...reservationDraftOf(null, { date: "2026-10-01", hall: " Основной зал ", tableExternalIds: ["t4", "t4"] }), guestName: " Айгерим ", phone: "+7 701 555 11 22", guestCount: "4", prepayment: 0, prepaymentTypeExternalId: "pt-cash" }
    const args = reservationSaveArgs(draft, "r1", null)
    expect(args).toEqual({
      restaurantExternalId: "r1",
      recordType: "reservation",
      hall: "Основной зал",
      tableExternalIds: ["t4"],
      guestName: "Айгерим",
      phone: "+7 701 555 11 22",
      start: dateInputToMs("2026-10-01") + 19 * 3_600_000,
      end: dateInputToMs("2026-10-01") + 22 * 3_600_000,
      guestCount: 4,
      occasion: "",
      prepayment: 0,
      menu: "",
    })
    expect(reservationSaveArgs({ ...draft, prepayment: 15_000 }, "r1", { externalId: "rsv-1", version: 3 })).toMatchObject({ externalId: "rsv-1", expectedVersion: 3, prepayment: 15_000, prepaymentTypeExternalId: "pt-cash" })
  })

  it("offers only payment types in force for the restaurant", () => {
    const now = 1_000
    const row = { status: "published", effectiveFrom: 0, restaurantExternalIds: [] as string[] }
    expect(paymentTypeServes(row, "r1", now)).toBe(true)
    expect(paymentTypeServes({ ...row, restaurantExternalIds: ["r2"] }, "r1", now)).toBe(false)
    expect(paymentTypeServes({ ...row, status: "draft" }, "r1", now)).toBe(false)
    expect(paymentTypeServes({ ...row, effectiveTo: 500 }, "r1", now)).toBe(false)
    expect(paymentTypeServes({ ...row, effectiveFrom: 2_000 }, "r1", now)).toBe(false)
  })
})
