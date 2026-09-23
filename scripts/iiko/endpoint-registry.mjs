// The only two iiko endpoints this project ever calls — both GET, both master data.
// Deliberately narrow: Phase 3 imports organization structure + workforce only. Adding an
// endpoint here is a real decision (what data enters the mirror, what PII rules apply) —
// don't add one without updating lib.mjs's sanitizeRecord allowlist for its domain first.
export const ENDPOINTS = [
  { key: "corporation/departments", path: "corporation/departments", domain: "organization" },
  { key: "employees", path: "employees", domain: "workforce" },
]
