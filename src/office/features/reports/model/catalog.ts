import { FAMILY_LABELS, REPORT_CATALOG, type ReportDefinition, type ReportFamily } from "../../../../../convex/domains/reports/catalog"

// The office reads the report catalog straight from the backend module (one source of truth, W1-RPT-01).
// Whether a report is ready comes from `coverage().implementedIds`, never from the catalog itself.

export { FAMILY_LABELS, REPORT_CATALOG, type ReportDefinition, type ReportFamily }

export const REPORT_FAMILIES = Object.keys(FAMILY_LABELS) as ReportFamily[]
export const ALL_FAMILIES = "all"

export function findCatalogReport(reportId: string | undefined) {
  return reportId ? REPORT_CATALOG.find((report) => report.id === reportId) : undefined
}

export function isNotApplicableKz(report: ReportDefinition) {
  return report.kzApplicability === "not-applicable-kz"
}

/** Owner decision Г-11: the mechanic behind the report is switched off, so it is never computed. */
export function isMechanicDisabled(report: ReportDefinition) {
  return report.mechanicDisabled
}

export function filterReports(
  reports: ReportDefinition[],
  { search, family, onlyReady, implemented }: { search: string; family: string; onlyReady?: boolean; implemented?: ReadonlySet<string> },
) {
  const needle = search.trim().toLocaleLowerCase("ru")
  return reports.filter((report) => {
    if (family !== ALL_FAMILIES && report.family !== family) return false
    if (onlyReady && !implemented?.has(report.id)) return false
    if (!needle) return true
    return [report.title, report.description, report.familyLabel, report.id].some((text) => text.toLocaleLowerCase("ru").includes(needle))
  })
}
