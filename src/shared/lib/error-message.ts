export function errorMessage(error: unknown, fallback = "Произошла ошибка"): string {
  if (error instanceof Error) return error.message.replace(/^\[.*?\]\s*/, "")
  return fallback
}
