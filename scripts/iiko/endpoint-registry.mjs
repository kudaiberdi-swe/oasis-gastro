// The iiko endpoints this project calls — every one a GET that reads (never /documents/import/*, /edi/*, or
// anything else that changes iiko). Adding an endpoint is a real decision (what data enters the mirror,
// what PII rules apply): update lib.mjs's sanitizeRecord allowlist for its domain first. `flag` endpoints
// run only when the extract is asked for them; v2 endpoints answer JSON (they return 406 for XML).
//   withStockMaster — stores, POS cash registers (points of sale of corporation/groups), units, suppliers (W1-IIKO-03)
//   withProducts    — the brand's product groups, products and their assembly charts (W1-IIKO-04, W2-IIKO-08; Б-B4)
//   withBalances    — opening stock balances of the brand's stores (W1-IIKO-05)
//   withPrices      — prices of the brand's departments (W2-IIKO-09)
//   withSales       — cash shifts and orders without personal data (W2-RTL-01; D7)
export const ENDPOINTS = [
  { key: "corporation/departments", path: "corporation/departments", domain: "organization", classification: "mirrored" },
  { key: "employees", path: "employees", domain: "workforce", classification: "mirrored" },
  { key: "corporation/groups", path: "corporation/groups", domain: "department-group", classification: "lookup", flag: "withStockMaster" },
  { key: "corporation/stores", path: "corporation/stores", domain: "warehouse", classification: "mirrored", flag: "withStockMaster" },
  { key: "v2/entities/list?rootType=MeasureUnit", path: "v2/entities/list?rootType=MeasureUnit", domain: "unit", classification: "mirrored", flag: "withStockMaster", accept: "application/json" },
  { key: "suppliers", path: "suppliers", domain: "supplier", classification: "mirrored", flag: "withStockMaster" },
  { key: "v2/entities/products/group/list", path: "v2/entities/products/group/list", domain: "product-group", classification: "mirrored", flag: "withProducts", accept: "application/json" },
  { key: "v2/entities/products/list", path: "v2/entities/products/list", domain: "product", classification: "mirrored", flag: "withProducts", accept: "application/json" },
  { key: "v2/assemblyCharts/getAll", path: "v2/assemblyCharts/getAll", domain: "recipe", classification: "mirrored", flag: "withProducts", accept: "application/json" },
  { key: "v2/reports/balance/stores", path: "v2/reports/balance/stores", domain: "balance", classification: "mirrored", flag: "withBalances", accept: "application/json" },
  { key: "v2/price", path: "v2/price", domain: "price", classification: "mirrored", flag: "withPrices", accept: "application/json" },
  { key: "v2/cashshifts/list", path: "v2/cashshifts/list", domain: "cash-shift", classification: "mirrored", flag: "withSales", accept: "application/json" },
  { key: "reports/olap?report=SALES", path: "reports/olap", domain: "order", classification: "mirrored", flag: "withSales" },
]

export const endpointByKey = (key) => {
  const endpoint = ENDPOINTS.find((row) => row.key === key)
  if (!endpoint) throw new Error(`Unknown iiko endpoint: ${key}`)
  return endpoint
}
