import { describe, expect, it } from "vitest"

import { productPickerEmptyText } from "@/office/features/delivery/model/order-draft"
import { formatPhone } from "@/office/features/loyalty/model/loyalty-model"
import { plural, recordCount } from "@/shared/lib/plural"
import { formatPhoneNumber } from "@/shared/lib/phone"
import { restaurantCode, restaurantSelectOptions } from "@/shared/lib/restaurant-options"

// Office display helpers shared by the registers and the delivery card: counters, the dish search
// prompt, restaurant pickers with repeated names and phone formatting.

describe("register counters", () => {
  it("decline «запись» in Russian — never «1 записей»", () => {
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(recordCount)).toEqual([
      "0 записей",
      "1 запись",
      "2 записи",
      "4 записи",
      "5 записей",
      "11 записей",
      "12 записей",
      "14 записей",
      "21 запись",
      "22 записи",
      "25 записей",
      "101 запись",
      "111 записей",
    ])
    expect(plural(3, ["блюдо", "блюда", "блюд"])).toBe("блюда")
  })
})

describe("delivery dish search", () => {
  it("asks to type while the search is empty, «Ничего не найдено» only for a real search", () => {
    expect(productPickerEmptyText("", false)).toBe("Начните вводить название блюда")
    expect(productPickerEmptyText("   ", false)).toBe("Начните вводить название блюда")
    expect(productPickerEmptyText("плов", false)).toBe("Ничего не найдено")
    expect(productPickerEmptyText("плов", true)).toBe("Загрузка…")
  })
})

describe("restaurant pickers", () => {
  it("unique names stay plain", () => {
    expect(restaurantSelectOptions([{ externalId: "a", name: "Sandyq Astana" }, { externalId: "b", name: "Sandyq Шымкент" }])).toEqual([
      { value: "a", label: "Sandyq Astana" },
      { value: "b", label: "Sandyq Шымкент" },
    ])
  })

  it("repeated names (also differing only in spaces or case) get the code", () => {
    const options = restaurantSelectOptions([
      { externalId: "sandyq-almaty", name: "Sandyq Алматы" },
      { externalId: "700917ce-77e5-479a-a4a9-68c2a9e76fc2", name: "Sandyq  Алматы" },
      { externalId: "c", name: "Sandyq Astana" },
    ])
    expect(options).toEqual([
      { value: "sandyq-almaty", label: "Sandyq Алматы", hint: "код sandyq-almaty" },
      { value: "700917ce-77e5-479a-a4a9-68c2a9e76fc2", label: "Sandyq Алматы", hint: "код 700917ce" },
      { value: "c", label: "Sandyq Astana" },
    ])
  })

  it("the city is the caption when it tells the repeated names apart", () => {
    expect(
      restaurantSelectOptions([
        { externalId: "a", name: "Sandyq", city: "Алматы" },
        { externalId: "b", name: "Sandyq", city: "Шымкент" },
      ]).map((option) => option.hint),
    ).toEqual(["Алматы", "Шымкент"])
    expect(
      restaurantSelectOptions([
        { externalId: "a", name: "Sandyq", city: "Алматы" },
        { externalId: "b", name: "Sandyq", city: "Алматы" },
      ]).map((option) => option.hint),
    ).toEqual(["код a", "код b"])
    expect(restaurantCode("sandyq-almaty")).toBe("sandyq-almaty")
  })
})

describe("phones", () => {
  it("a full number is shown «+7 700 000 00 01»", () => {
    expect(formatPhoneNumber("77000000001")).toBe("+7 700 000 00 01")
    expect(formatPhoneNumber("+7 (701) 123-45-67")).toBe("+7 701 123 45 67")
    expect(formatPhoneNumber("87011234567")).toBe("+7 701 123 45 67")
  })

  it("masked, partial and empty phones stay as they are", () => {
    expect(formatPhoneNumber("7701••••90")).toBe("7701••••90")
    expect(formatPhoneNumber("7701")).toBe("7701")
    expect(formatPhoneNumber("")).toBe("")
    expect(formatPhoneNumber("abc 77000000001")).toBe("abc 77000000001")
  })

  it("the guest card format uses the same helper", () => {
    expect(formatPhone("77011234567")).toBe("+7 701 123 45 67")
    expect(formatPhone(undefined)).toBe("—")
  })
})
