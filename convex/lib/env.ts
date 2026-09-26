// Convex environment variables (set with the dashboard or `convex env`, never in code). The office app
// typechecks these modules without node types, hence the local declaration.
declare const process: { env: Record<string, string | undefined> }

/** An env variable's value, or undefined when it is not set or blank. */
export function envValue(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() ? value : undefined
}

/** Whether an env variable is set — for «задан / не задан» without ever returning its value. */
export function envIsSet(name: string): boolean {
  return envValue(name) !== undefined
}
