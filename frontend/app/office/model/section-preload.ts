// Office sections are separate chunks (router.tsx). The router registers how to load each one; the
// sidebar asks for a section's chunk when a link is pointed at or focused, so opening it rarely waits.

const loaders = new Map<string, () => Promise<unknown>>()
const started = new Set<string>()

export function registerSectionPreload(sectionId: string, load: () => Promise<unknown>) {
  loaders.set(sectionId, load)
}

/** Starts downloading a section's chunk once; a failed download is retried by the next open. */
export function preloadSection(sectionId: string) {
  const load = loaders.get(sectionId)
  if (!load || started.has(sectionId)) return
  started.add(sectionId)
  load().catch(() => started.delete(sectionId))
}
