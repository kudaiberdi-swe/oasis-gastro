import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The theme's type scale (index.css @theme) and radii are custom names; without this twMerge reads
// `text-body-sm` as a color and drops `text-foreground` next to it.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "body-sm", "body", "title-sm", "title", "display", "hero"],
      radius: ["control", "card", "panel", "round"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Visible keyboard focus for native inputs until the Input primitive (W0-FND-03) replaces them. */
export const focusRingClass = "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"

// Kept for existing imports; the implementation lives in format.ts.
export { formatTenge } from "./format"
