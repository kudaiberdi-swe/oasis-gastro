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
