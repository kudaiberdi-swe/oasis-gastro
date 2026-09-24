// The iiko endpoints this project calls — every one GET, master data only (D7). Adding an endpoint
// is a real decision (what data enters the mirror, what PII rules apply): update lib.mjs's
// sanitizeRecord allowlist for its domain first. `flag` endpoints run only when the extract is asked
// for them (products and balances wait for blocker Б-B4 — whether the iiko menu joins the seed menu).
export const ENDPOINTS = [
  { key: "corporation/departments", path: "corporation/departments", domain: "organization", classification: "mirrored" },
  { key: "employees", path: "employees", domain: "workforce", classification: "mirrored" },
  { key: "corporation/stores", path: "corporation/stores", domain: "warehouse", classification: "mirrored" },
  { key: "corporation/terminals", path: "corporation/terminals", domain: "terminal", classification: "mirrored" },
  { key: "v2/entities/list?rootType=MeasureUnit", path: "v2/entities/list?rootType=MeasureUnit", domain: "unit", classification: "mirrored" },
  { key: "suppliers", path: "suppliers", domain: "supplier", classification: "mirrored" },
  { key: "v2/entities/products/group/list", path: "v2/entities/products/group/list", domain: "product-group", classification: "mirrored", flag: "withProducts" },
  { key: "v2/entities/products/list", path: "v2/entities/products/list", domain: "product", classification: "mirrored", flag: "withProducts" },
  { key: "v2/reports/balance/stores", path: "v2/reports/balance/stores", domain: "balance", classification: "mirrored", flag: "withBalances", timestamped: true },
]
