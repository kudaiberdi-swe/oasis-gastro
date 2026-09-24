import { describe, expect, it } from "vitest"

import { activeCountLabel, instructionKind, ticketOrigin } from "@/kitchen/features/board/model/ticket"
import { formatElapsed, KITCHEN_TIMER, ticketTimer, timerTone } from "@/kitchen/features/board/model/timer"

const MINUTE = 60_000

describe("kitchen timer thresholds (W1-KDS-02)", () => {
  it("is muted below the first threshold, warning from it, destructive from the second", () => {
    const { warningAfterMs, dangerAfterMs } = KITCHEN_TIMER.cooking
    expect(warningAfterMs).toBeLessThan(dangerAfterMs)
    expect(timerTone(0, KITCHEN_TIMER.cooking)).toBe("muted")
    expect(timerTone(warningAfterMs - 1, KITCHEN_TIMER.cooking)).toBe("muted")
    expect(timerTone(warningAfterMs, KITCHEN_TIMER.cooking)).toBe("warning")
    expect(timerTone(dangerAfterMs - 1, KITCHEN_TIMER.cooking)).toBe("warning")
    expect(timerTone(dangerAfterMs, KITCHEN_TIMER.cooking)).toBe("danger")
  })

  it("takes thresholds from the config it is given", () => {
    const config = { cooking: { warningAfterMs: MINUTE, dangerAfterMs: 2 * MINUTE }, pickup: { warningAfterMs: MINUTE, dangerAfterMs: 2 * MINUTE } }
    const now = 10 * MINUTE
    expect(ticketTimer({ status: "queued", createdAt: now - 90_000 }, now, config).tone).toBe("warning")
    expect(ticketTimer({ status: "queued", createdAt: now - 90_000 }, now).tone).toBe("muted")
  })

  it("counts queued and preparing from the ticket, ready from the pass", () => {
    const now = 100 * MINUTE
    const createdAt = now - 20 * MINUTE
    expect(ticketTimer({ status: "preparing", createdAt }, now)).toMatchObject({ elapsedMs: 20 * MINUTE, tone: "danger", label: "20:00" })
    expect(ticketTimer({ status: "ready", createdAt, readyAt: now - MINUTE }, now)).toMatchObject({ elapsedMs: MINUTE, tone: "muted" })
    expect(ticketTimer({ status: "ready", createdAt, readyAt: now - KITCHEN_TIMER.pickup.dangerAfterMs }, now).tone).toBe("danger")
  })

  it("formats elapsed time as m:ss and h:mm:ss, never negative", () => {
    expect(formatElapsed(0)).toBe("0:00")
    expect(formatElapsed(754_000)).toBe("12:34")
    expect(formatElapsed(3_723_000)).toBe("1:02:03")
    expect(formatElapsed(-5_000)).toBe("0:00")
  })
})

describe("kitchen ticket labels", () => {
  it("shows the table or the order type, then the source", () => {
    expect(ticketOrigin({ tableLabel: "5", fulfillment: "dine-in", source: "pos" })).toBe("Стол 5 · Касса")
    expect(ticketOrigin({ tableLabel: "Терраса 2", fulfillment: "dine-in", source: "pos" })).toBe("Терраса 2 · Касса")
    expect(ticketOrigin({ fulfillment: "takeaway", source: "kiosk" })).toBe("С собой · Киоск")
    expect(ticketOrigin({ fulfillment: "delivery", source: "delivery" })).toBe("Доставка")
  })

  it("tells removals, additions and free notes apart", () => {
    expect(instructionKind("БЕЗ ЛУКА")).toBe("remove")
    expect(instructionKind("без соли")).toBe("remove")
    expect(instructionKind("+СЫР ×2")).toBe("add")
    expect(instructionKind("Подать после супа")).toBe("note")
  })

  it("pluralizes the active counter", () => {
    expect(activeCountLabel(1)).toBe("1 активный")
    expect(activeCountLabel(2)).toBe("2 активных")
    expect(activeCountLabel(11)).toBe("11 активных")
    expect(activeCountLabel(21)).toBe("21 активный")
  })
})
