/** The kitchen screen of one terminal: the kitchen signs in there with its own PIN, never the office session. */
export function kitchenHref(terminalExternalId: string) {
  return `/kitchen?terminal=${encodeURIComponent(terminalExternalId)}`
}

/** 1 активный, 2 активных, 11 активных. */
export function activeTicketsLabel(count: number) {
  return `${count} ${count % 10 === 1 && count % 100 !== 11 ? "активный" : "активных"}`
}
