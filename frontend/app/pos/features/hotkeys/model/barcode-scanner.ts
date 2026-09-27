// Barcode scanner as a keyboard (W3-POS-01): a USB/Bluetooth scanner "types" the code a few ms per
// character and ends it with Enter. A burst is a scan when every gap is within SCAN_MAX_GAP_MS and it
// has at least SCAN_MIN_LENGTH characters; a person typing is several times slower, so their Enter
// stays an ordinary Enter.

export const SCAN_MAX_GAP_MS = 50
export const SCAN_MIN_LENGTH = 6
const SCAN_MAX_LENGTH = 64

export interface ScanDetector {
  /** Feeds one keydown (`key` as in KeyboardEvent.key, `at` in ms); returns the code when Enter ends a scan. */
  key: (key: string, at: number) => string | null
  reset: () => void
}

export function createScanDetector({ maxGapMs = SCAN_MAX_GAP_MS, minLength = SCAN_MIN_LENGTH }: { maxGapMs?: number; minLength?: number } = {}): ScanDetector {
  let buffer = ""
  let last = Number.NEGATIVE_INFINITY
  const reset = () => {
    buffer = ""
    last = Number.NEGATIVE_INFINITY
  }
  return {
    key(key, at) {
      const fast = at - last <= maxGapMs
      if (key === "Enter") {
        const code = fast && buffer.length >= minLength ? buffer : null
        reset()
        return code
      }
      // Shift and other non-character keys a scanner never sends between digits end the burst.
      if (key.length !== 1) {
        if (key !== "Shift") reset()
        return null
      }
      // A slow key starts a new burst: whatever was typed by hand before it is not part of the code.
      buffer = (fast ? buffer + key : key).slice(-SCAN_MAX_LENGTH)
      last = at
      return null
    },
    reset,
  }
}
