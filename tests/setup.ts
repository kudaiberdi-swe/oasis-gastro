// jsdom has no ResizeObserver; Radix (Select, RadioGroup, Popover) measures elements with it.
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.assign(window, { ResizeObserver: ResizeObserverStub })
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub })
}

// Tests never reach a real provider (W3-INT-06): provider keys from a developer shell are cleared; a test
// that needs one stubs the env variable and fetch itself.
for (const name of ["RESEND_API_KEY", "EMAIL_FROM", "MOBIZON_API_KEY", "SMS_SENDER", "TELEPHONY_WEBHOOK_SECRET"]) delete process.env[name]
