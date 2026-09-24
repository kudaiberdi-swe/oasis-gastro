// Mirrors convex/lib/officeAccess.ts allowsCapability: "*", an exact match, or "office.<module>.*".
export function allowsCapability(capabilities: readonly string[], capability: string): boolean {
  return capabilities.some((candidate) => candidate === "*" || candidate === capability || (candidate.endsWith(".*") && capability.startsWith(candidate.slice(0, -1))))
}
