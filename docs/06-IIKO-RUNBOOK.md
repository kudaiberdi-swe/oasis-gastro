# iiko connection runbook

How to pull a restaurant chain's real data (branches, staff, and behind flags stock master data, products, charts, balances, prices, shifts and orders) from the chain's iiko Server account. For the code that implements this, see `scripts/iiko/` and `convex/domains/iiko/`; for how it fits the rest of the system, see [03-ARCHITECTURE.md § iiko integration](03-ARCHITECTURE.md#iiko-integration).

## The one rule

**Never write to iiko.** Every call this project makes is `GET`. `scripts/iiko/lib.mjs`'s `IikoClient` doesn't even expose a method to do anything else. This is a live production account for a real, currently-operating 8-brand restaurant holding — not a sandbox. If you're ever tempted to call a mutating endpoint (`POST`/`PUT`/`DELETE`, e.g. `/documents/import/*`, `/edi/*/orders/ack`) for testing, don't — not even against a single record.

## Credentials

Three env vars, read from `.env` (gitignored) by every `iiko:*` npm script via `--env-file=.env`:

```
IIKO_BASE_URL=https://sandy-co-co.iiko.it
IIKO_LOGIN=<login>
IIKO_PASSWORD=<password>
```

`lib.mjs:readIikoConfig` also accepts a `iiko-credentials.md` file as a fallback (also gitignored) if you'd rather keep them out of `.env`. Never commit either file.

Auth itself is session-key based: `GET /resto/api/auth?login=&pass=sha1(password)` returns a session key appended to every subsequent request as `?key=`, and `client.logout()` releases it when the script exits (see the `finally` block in `extract.mjs`).

## What actually gets pulled

Every endpoint is a `GET` listed in `scripts/iiko/endpoint-registry.mjs`. By default only the org tree and
staff; the rest behind flags (decisions Б-B4 and D7 of 2026-09-26, `docs/08-IMPLEMENTATION-PLAN.md` §2.5):

| Flag | Endpoints | Lands in |
|---|---|---|
| — | `corporation/departments`, `employees` | `iikoDepartments` → organizations / restaurants; `iikoEmployees` |
| `--with-stock-master` | `corporation/stores`, points of sale of `corporation/groups`, `v2/entities/list?rootType=MeasureUnit`, `suppliers` | warehouses, POS terminals (inactive), units, suppliers |
| `--with-products` | `v2/entities/products/group/list`, `v2/entities/products/list`, `v2/assemblyCharts/getAll` | product groups, dishes / preparations / stock items, recipe versions «из iiko» |
| `--with-balances` | `v2/reports/balance/stores` | opening stock movements + journal entries (only where Sandyq has no movements yet) |
| `--with-prices` | `v2/price` | branch prices (`productPrices` with `sourceSystem: "iiko-server"`; Sandyq's own price wins) |
| `--with-sales --from --to` | `v2/cashshifts/list`, `reports/olap?report=SALES` | `iikoCashShifts`, `iikoOrders` (read-only; «Источник: iiko» in the office) |

`corporation/terminals` is not used: on this account it lists only anonymous back-office machines; the POS
cash registers are the points of sale of `corporation/groups`. `v2/*` endpoints answer JSON (406 for XML).

**Brand scope of the shared nomenclature.** Products of the brand's top-level groups (names matching the
brand from the `IIKO_BRAND_ALIASES` setting), plus whatever lies in the brand's stores, plus everything their
assembly charts use (transitively). Chart lines excluded for every department of the brand by their store
specification are dropped.
A seed dish (from the menu PDFs) with the same normalized name is linked instead of duplicated; every other
iiko dish arrives **hidden from the POS** — show it in the product card, or show all the ones priced in your branches at once with «Показать блюда iiko с ценой» in «Номенклатура» (a dry run counts them first; a dish hidden on purpose stays hidden, and a shown one stays shown after a re-import). The same action hides the PDF stand-in menu (the seed's `sandyq-…` dishes without an iiko link; needs access to all branches). On the POS a dish shows in a branch only when it has that branch's own price — an iiko price, an office price or a price order; with only the base price it is not on that branch's menu. On **dev**, `npm run dev:iiko-menu` does the whole switch the way prod is set up: links the three pilot branches to their iiko departments, re-imports the branch prices (GET only) and runs the same show/hide code (`convex/domains/iiko/devMenu.ts`, internal).

## Brand scoping

An iiko account may hold several brands sharing one corporate structure. The brand is a setting, never a code default: `IIKO_BRAND_ALIASES` in the local `.env` (or `--brand=<alias,alias>` for one run) is a comma list of the spellings of the brand name. `extract.mjs` filters every department by name (case-insensitive substring match on any alias) **before** anything reaches the local staging file, and refuses to run without the setting. List every spelling the account uses, Latin and Cyrillic — a department named only in Cyrillic is missed otherwise. An employee is kept only if their `departmentCodes`/`responsibilityDepartmentCodes` intersect a matched department's code.

First deployment (for reference): its account holds 8 brands, about 30 branches and 2,700+ employees; its aliases are the Latin and Cyrillic spellings of its brand (one real department has only a Cyrillic name), which matched 12 departments and 363 employees and excluded the other 7 brands.

If the business ever confirms a wider scope, add the aliases to the setting — don't just delete the filter.

## PII handling

`sanitizeRecord` (`lib.mjs`) works by **allowlist, not blocklist** — only the keys in `ALLOWLISTS` are ever
read out of a source response. No phone, email, IIN, login or address; cash shifts carry the manager only by
iiko id (the office shows the code); orders come from OLAP columns chosen by `extract.mjs` — no waiter, guest,
phone or address columns are ever requested (D7). `tests/scripts/iikoReadOnly.test.ts` pins this.

## Running it

```bash
npm run iiko:discover    # maps application.wadl, pulls zero business data — safe to run any time
npm run iiko:seed        # extract → import → reconcile, in one command (the usual path)
```

Or step by step (useful when debugging one stage):

```bash
npm run iiko:extract     # → .iiko-cache/<run>/staging.jsonl (gitignored)
npm run iiko:import      # reads the latest staged run, upserts into Convex
npm run iiko:reconcile   # compares staged vs mirrored counts, exits non-zero on mismatch
```

`import-convex.mjs` chunks records into batches of 50 before calling `domains/iiko/mutations:importBatch` — a single call with all ~363 employees at once hits Convex's per-mutation operation budget and times out. Don't remove the chunking if you're touching this script.

Against production, use `bash scripts/prod-iiko-import.sh` (`--from <date>` for sales since a date, `--yes` to skip the question): it mints a one-off deploy key into a temp file, runs the flagged extract and import, and deletes the key on exit. By hand, prefix with a one-off deploy key (see [03-ARCHITECTURE.md § Environments](03-ARCHITECTURE.md#environments) for the mint-use-delete pattern) — none of the iiko scripts have a dev-only guard the way `seed-sandyq.mjs` does, since re-running the import is always idempotent and safe.

## Known sharp edge: XML declaration parsing

`lib.mjs:parseXml`'s tokenizer regex must keep its `<\?[\s\S]*?\?>` alternative *before* the generic opening-tag alternative — without it, `<?xml version="1.0" encoding="UTF-8"?>` gets tokenized as an unclosed element named `?xml`, which silently nests the *entire* real document one level too deep under a phantom root, and every extraction reports matching 0 records even though the request succeeded. If extraction ever again reports "Matched 0/N" against a real non-empty response, this is the first thing to check.

## Connecting an entity back to the operational side of the system

An imported `iikoEmployees` row is not a POS login by itself. `domains/workforce/mutations.ts:provisionPosAccess` (surfaced in `/office` → «Сотрудники» → «Из iiko», and in «Корпорация → Обмен данными с iiko → Доступ сотрудников к кассе OASIS Gastro») bridges one to a real `employees` row — the code and PIN are always generated locally there, never derived from anything iiko returns.

## Stock master data (W1-IIKO-01..03) — still GET only

1. In the office, «Корпорация → Обмен данными с iiko» (`/office/data-exchange`) → «Сопоставление филиалов»: link every Sandyq restaurant to its iiko
   department (`restaurantSourceLinks`). Stores and terminals of an unlinked department are skipped and
   reported on their endpoint — never attached to the first restaurant at hand.
2. Extract with the flags you need (table above), e.g. everything for the last week:
   `npm run iiko:seed -- --with-stock-master --with-products --with-balances --with-prices --with-sales`.
3. Import as usual (`npm run iiko:import -- --input=…`). Imported terminals arrive **inactive** with the next
   free number of their restaurant; enable them in the office. Suppliers arrive without a BIN — fill it in
   the office. Every re-import only touches records whose payload hash changed.
