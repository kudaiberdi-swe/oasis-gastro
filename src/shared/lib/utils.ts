import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTenge(value: number) {
  return new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 0 }).format(value) + " ₸"
}
