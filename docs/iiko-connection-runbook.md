# iiko connection runbook

How to pull real Sandyq branch/employee data from the chain's iiko Server account. For the code that implements this, see `scripts/iiko/` and `convex/domains/iiko/`; for how it fits the rest of the system, see [ARCHITECTURE.md § iiko integration](ARCHITECTURE.md#iiko-integration).

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

Only two endpoints, ever — see `scripts/iiko/endpoint-registry.mjs`:

- `corporation/departments` → the org/branch tree (JURPERSON and DEPARTMENT rows)
- `employees` → staff records

No sales, orders, stock, or menu data is imported from iiko. That's deliberate — see the BRD for why (the seeded menu from `public/menu-data/*.json` is the source of truth for the catalog; iiko is only for real org structure and staff).

## Brand scoping

The account is a holding of 8 brands (`Sandyq`, `Tary`, `Shopan`, `Salam Bro`, `Cinotti`, `Anor Korday`, `Kainar`, `BURABAY SKY`) sharing one corporate structure — roughly 30 branches, 2,700+ employees total. `extract.mjs` filters every department by name (`["sandyq", "сандык"]`, case-insensitive substring match — the Cyrillic alias exists specifically because one real department, "Сандык Кайнар", has no Latin spelling) **before** anything reaches the local staging file. An employee is kept only if their `departmentCodes`/`responsibilityDepartmentCodes` intersect a matched department's code. Verified against the real account: 12 Sandyq departments, 363 Sandyq employees, correctly excluding the other 7 brands.

If the business ever confirms a wider scope, pass `--brand <term>` to match a single different term instead of the default alias list — don't just delete the filter.

## PII handling

`sanitizeRecord` (`lib.mjs`) works by **allowlist, not blocklist** — only these fields are ever read out of a source response, for either domain:

- `organization`: `id, parentId, code, name, type, deleted`
- `workforce`: `id, code, name, mainRoleId, rolesIds, mainRoleCode, roleCodes, departmentCodes, responsibilityDepartmentCodes, deleted, supplier, client, employee`

Nothing else — no phone, email, IIN, login, or address — is ever selected from the raw XML, so there's no PII-strip step to keep in sync as the source schema changes.

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

Against production, prefix with a one-off deploy key (see [ARCHITECTURE.md § Environments](ARCHITECTURE.md#environments) for the mint-use-delete pattern) — none of the iiko scripts have a dev-only guard the way `seed-sandyq.mjs` does, since re-running the import is always idempotent and safe.

## Known sharp edge: XML declaration parsing

`lib.mjs:parseXml`'s tokenizer regex must keep its `<\?[\s\S]*?\?>` alternative *before* the generic opening-tag alternative — without it, `<?xml version="1.0" encoding="UTF-8"?>` gets tokenized as an unclosed element named `?xml`, which silently nests the *entire* real document one level too deep under a phantom root, and every extraction reports matching 0 records even though the request succeeded. If extraction ever again reports "Matched 0/N" against a real non-empty response, this is the first thing to check.

## Connecting an entity back to the operational side of the system

An imported `iikoEmployees` row is not a POS login by itself. `domains/workforce/mutations.ts:provisionPosAccess` (surfaced in `/office` → Кадры → "Из iiko") bridges one to a real `employees` row — the code and PIN are always generated locally there, never derived from anything iiko returns.

## Stock master data (W1-IIKO-01..03) — still GET only

1. In the office, `/office/data-exchange` → «Сопоставление филиалов»: link every Sandyq restaurant to its iiko
   department (`restaurantSourceLinks`). Stores and terminals of an unlinked department are skipped and
   reported on their endpoint — never attached to the first restaurant at hand.
2. Extract with the stock master endpoints: `npm run iiko:extract -- --with-stock-master`
   (stores, terminals, measure units, suppliers; all `GET`). Products and balances need
   `--with-products` / `--with-balances` too and wait for blocker Б-B4.
3. Import as usual (`npm run iiko:import -- --input=…`). Imported terminals arrive **inactive** with the next
   free number of their restaurant; enable them in the office. Suppliers arrive without a BIN — fill it in
   the office. Every re-import only touches records whose payload hash changed.
