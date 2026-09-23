# Parsed menu data

Extracted from the three official menu PDFs in `../menu-pdfs/`. All three are now **transcribed by direct visual reading of each rendered PDF page** (not OCR) — significantly more reliable for this stylized, bilingual menu than the earlier OCR pass.

## `almaty.json`, `shymkent.json`, `turkistan.json`

Same shape:

```json
{ "price_kzt": 4990, "name_kk": "...", "name_ru": "...", "category": "...", "note": "..." }
```

Drink sections (Дәстүрлі сусындар, Салқындатқыш сусындар, Фреш, Лимонад) use volume-keyed prices instead of a single `price_kzt`, since they're priced per 0.2л/0.5л/0.75л/1л:

```json
{ "name_kk": "Шұбат", "name_ru": "Шубат", "price_02l": 850, "price_1l": 2850, "category": "..." }
```

- **72 items** (Almaty), **~75 items** (Shymkent, Turkistan) — salads, delicacies/appetizers, soups, two "main dishes" sections (one meat-forward, one "second dishes"), garnishes, sauces, bakery, desserts, traditional/cold drinks, fresh juice, lemonade, and a 5–6 person group menu.
- `category` values are the menu's own bilingual section headers (Kazakh / Russian), kept as-is rather than remapped to generic POS categories — do that mapping deliberately when seeding the catalog, not automatically.
- `note` (where present) captures a branch restriction printed on the menu itself, e.g. `"тек Шымкент қаласында"` (Shymkent only) — several dishes are genuinely branch-exclusive, don't assume the three menus are identical.
- Prices are in KZT. A 15% service charge (`Қызмет ақысы 15%` / `Обслуживание 15%`) applies restaurant-wide and is **not** included per item.
- Almaty's `name_kk` was originally extracted from the PDF's real text layer (`pdftotext`) rather than read visually like the other two — a small number of entries there may have a slightly truncated Kazakh name where a line wrapped; the Russian name is reliable in all cases. Cross-check against `raw/almaty-pdftotext.txt` if something looks cut off.

## `raw/`

Superseded intermediate extraction artifacts, kept for reference/audit only — not the source of truth anymore:
- `almaty-pdftotext.txt` — the real embedded text layer from the Almaty PDF (still accurate, source for `almaty.json`).
- `shymkent-ocr.txt`, `turkistan-ocr.txt` — the original Tesseract OCR pass on the two scanned-image PDFs. **Low quality, superseded** by the visual re-transcription now in `shymkent.json`/`turkistan.json` — kept only in case a specific line needs cross-checking against a machine pass.

## Recommendation

All three JSON files are now usable as a first draft for seeding the catalog. The three branch menus overlap heavily (same dish names, different prices, a handful of branch-exclusive items flagged via `note`) — worth deduping shared dishes into one product catalog with per-branch price overrides rather than three independent catalogs.
