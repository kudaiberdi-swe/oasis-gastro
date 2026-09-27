import { useMemo, useRef, useState } from "react"

import { Banner, Button, Field, Input, SegmentedControl, Select, Textarea, useToast } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"
import { errorMessage } from "@/shared/lib/error-message"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useBankStatementMutations, useImportProfiles, useRecentImports, type ImportProfile } from "../data/use-bank-statements"
import { formatBusinessDate } from "../model/modules"
import { bankName, groupIban } from "../model/bank-lines"
import {
  AMOUNT_MODE_LABELS,
  BANK_PRESETS,
  chunkRows,
  decodeStatement,
  DEFAULT_INCOMING,
  FIELD_LABELS,
  guessHeaderRow,
  isIban,
  mappingFields,
  mappingToSave,
  normalizeIban,
  parseStatement,
  presetById,
  readTable,
  requiredFields,
  statementTotals,
  UNVERIFIED_NOTE,
  type AmountMode,
  type Delimiter,
  type Encoding,
  type StatementField,
  type StatementMapping,
} from "../model/parse-statement"

const NEW_ACCOUNT = "new"
const NONE = "none"
const SAMPLE_FORMAT = "Дата;номер;контрагент;БИН;назначение;сумма;incoming/outgoing"
const PLACEHOLDER = "ГГГГ-ММ-ДД;номер;контрагент;БИН;назначение;сумма;incoming/outgoing"

const ENCODING_OPTIONS: { value: Encoding; label: string }[] = [
  { value: "auto", label: "Кодировка: авто" },
  { value: "utf-8", label: "UTF-8" },
  { value: "windows-1251", label: "Windows-1251" },
]
const DELIMITER_OPTIONS: { value: Delimiter; label: string }[] = [
  { value: "auto", label: "Разделитель: авто" },
  { value: ";", label: "Точка с запятой ;" },
  { value: ",", label: "Запятая ," },
]

const mappingOfProfile = (profile: ImportProfile): StatementMapping => ({
  bank: profile.bank,
  encoding: profile.encoding,
  delimiter: profile.delimiter,
  amountMode: profile.amountMode,
  hasHeader: profile.hasHeader,
  columns: profile.columns.map((column) => ({ field: column.field as StatementField, header: column.header, index: column.index })),
  incomingValues: profile.incomingValues,
})

export interface BankImportPanelProps {
  restaurants: { externalId: string; name: string }[]
  defaultRestaurantExternalId?: string
}

/**
 * «Импорт CSV» above the bank statement register (W3-FIN-11): the account, the bank's format (presets for
 * Kaspi Business and Halyk are not checked on a sample file yet; any other bank maps its columns once — the
 * mapping is saved per account), a file or pasted text, a preview, «Импортировать» and «Сопоставить автоматически».
 */
export function BankImportPanel({ restaurants, defaultRestaurantExternalId }: BankImportPanelProps) {
  const profiles = useImportProfiles()
  const { importStatement, saveImportProfile, autoMatch } = useBankStatementMutations()
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const [account, setAccount] = useState<string>(NEW_ACCOUNT)
  const [iban, setIban] = useState("")
  const [restaurantExternalId, setRestaurantExternalId] = useState(defaultRestaurantExternalId ?? restaurants[0]?.externalId ?? "")
  const [presetId, setPresetId] = useState("sandyq")
  const [mapping, setMapping] = useState<StatementMapping>(BANK_PRESETS[0].mapping)
  const [pasted, setPasted] = useState("")
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [busy, setBusy] = useState<"import" | "match" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statement, setStatement] = useState<string | null>(null)
  const recent = useRecentImports(restaurantExternalId || undefined)

  const decoded = useMemo(() => (file ? decodeStatement(file.bytes, mapping.encoding) : null), [file, mapping.encoding])
  const text = decoded?.text ?? pasted
  const parsed = useMemo(() => (text.trim() ? parseStatement(text, mapping) : null), [text, mapping])
  const totals = parsed ? statementTotals(parsed.rows) : null
  const manual = presetId === "manual"
  // The manual mapping picks columns from the file's header line.
  const table = useMemo(() => {
    if (!manual || !text.trim()) return null
    const read = readTable(text, mapping.delimiter)
    const index = mapping.hasHeader ? guessHeaderRow(read.rows) : null
    const width = Math.max(0, ...read.rows.slice(0, 30).map((row) => row.length))
    const header = index === null ? null : read.rows[index]
    return { options: Array.from({ length: width }, (_, column) => ({ value: String(column), label: `${column + 1} · ${header?.[column] || "без названия"}` })), header }
  }, [manual, text, mapping.delimiter, mapping.hasHeader])

  const selectedImport = statement ?? recent?.[0]?.externalId ?? null
  const preset = presetById(presetId)
  const accountOptions = [...(profiles ?? []).map((profile) => ({ value: profile.accountIban, label: `${groupIban(profile.accountIban)} · ${bankName(profile.bank)}` })), { value: NEW_ACCOUNT, label: "Другой счёт" }]

  const pickAccount = (value: string) => {
    setAccount(value)
    setError(null)
    const profile = profiles?.find((row) => row.accountIban === value)
    if (!profile) return
    setIban(profile.accountIban)
    setRestaurantExternalId(profile.restaurantExternalId)
    setPresetId(presetById(profile.bank) ? profile.bank : "manual")
    setMapping(mappingOfProfile(profile))
  }
  const pickPreset = (value: string) => {
    setPresetId(value)
    setMapping({ ...(presetById(value)?.mapping ?? BANK_PRESETS[0].mapping), encoding: mapping.encoding, delimiter: value === "sandyq" ? ";" : mapping.delimiter })
  }
  const setColumn = (field: StatementField, value: string) => {
    const index = value === NONE ? undefined : Number(value)
    const others = mapping.columns.filter((column) => column.field !== field)
    setMapping({ ...mapping, columns: index === undefined ? others : [...others, { field, index, ...(table?.header?.[index] ? { header: table.header[index] } : {}) }] })
  }
  const columnOf = (field: StatementField) => {
    const index = parsed?.columns[field] ?? mapping.columns.find((column) => column.field === field)?.index
    return index === undefined ? NONE : String(index)
  }

  const accountIban = normalizeIban(account === NEW_ACCOUNT ? iban : account)
  const blocked = !accountIban
    ? "Укажите счёт — IBAN из выписки"
    : !isIban(accountIban)
      ? "IBAN — KZ и 18 символов"
      : !restaurantExternalId
        ? "Выберите ресторан"
        : !parsed
          ? "Загрузите файл или вставьте строки выписки"
          : parsed.problems.length
            ? parsed.problems[0]
            : parsed.errors.length
              ? "Исправьте строки с ошибками"
              : !parsed.rows.length
                ? "В файле не найдено строк с датой"
                : null

  async function runImport() {
    if (blocked || !parsed || busy) return
    setBusy("import")
    setError(null)
    try {
      await saveImportProfile({ accountIban, restaurantExternalId, ...mappingToSave(mapping, parsed) })
      const statementExternalId = `statement-${crypto.randomUUID()}`
      let imported = 0
      let duplicates = 0
      for (const rows of chunkRows(parsed.rows)) {
        const result = await importStatement({ restaurantExternalId, accountIban, bank: mapping.bank, statementExternalId, ...(file ? { fileName: file.name } : {}), rows })
        imported += result.imported
        duplicates += result.duplicates
      }
      setStatement(statementExternalId)
      setPasted("")
      setFile(null)
      toast(duplicates ? `Загружено строк: ${imported}, уже были: ${duplicates}` : `Загружено строк: ${imported}`, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось загрузить выписку"))
    } finally {
      setBusy(null)
    }
  }

  async function runMatch() {
    if (!selectedImport || busy) return
    setBusy("match")
    setError(null)
    try {
      const result = await autoMatch({ statementExternalId: selectedImport })
      toast(result.suggested ? `Предложено сопоставлений: ${result.suggested} из ${result.checked} — подтвердите их в строках` : `Точных совпадений нет (${result.checked} строк) — сопоставьте вручную`, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сопоставить"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Импорт CSV" className="flex flex-col gap-4 rounded-card border border-border bg-card p-4 shadow-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-body font-semibold text-foreground">Импорт CSV</h2>
        <p className="text-caption text-muted-foreground">{SAMPLE_FORMAT}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {profiles?.length ? (
          <Field label="Счёт">{(control) => <Select {...control} value={account} onValueChange={pickAccount} options={accountOptions} />}</Field>
        ) : null}
        {account === NEW_ACCOUNT ? (
          <Field label="IBAN счёта" hint="Счёт компании в банке — по нему запоминается формат">
            {(control) => <Input {...control} value={iban} onChange={(event) => setIban(event.target.value)} placeholder="KZ00 0000 0000 0000 0000" autoComplete="off" />}
          </Field>
        ) : null}
        {restaurants.length > 1 ? (
          <Field label="Ресторан">{(control) => <Select {...control} value={restaurantExternalId || undefined} onValueChange={setRestaurantExternalId} options={restaurantSelectOptions(restaurants)} />}</Field>
        ) : null}
        <Field label="Формат банка" hint={preset && !preset.verified ? `Колонки угаданы — ${UNVERIFIED_NOTE}; проверьте предпросмотр` : undefined}>
          {(control) => <Select {...control} value={presetId} onValueChange={pickPreset} options={BANK_PRESETS.map((row) => ({ value: row.id, label: row.label }))} />}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Кодировка" className="w-full sm:w-52" value={mapping.encoding} onValueChange={(encoding) => setMapping({ ...mapping, encoding: encoding as Encoding })} options={ENCODING_OPTIONS} />
        <Select aria-label="Разделитель" className="w-full sm:w-52" value={mapping.delimiter} onValueChange={(delimiter) => setMapping({ ...mapping, delimiter: delimiter as Delimiter })} options={DELIMITER_OPTIONS} />
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={async (event) => {
            const picked = event.target.files?.[0]
            event.target.value = ""
            if (!picked) return
            setFile({ name: picked.name, bytes: new Uint8Array(await picked.arrayBuffer()) })
            setPasted("")
          }}
        />
        <Button variant="secondary" onClick={() => fileInput.current?.click()}>
          {file ? "Другой файл" : "Выбрать файл"}
        </Button>
        {file ? (
          <p className="text-body-sm text-muted-foreground">
            {file.name}
            {decoded ? ` · ${decoded.encoding === "utf-8" ? "UTF-8" : "Windows-1251"}` : ""}{" "}
            <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
              Убрать
            </Button>
          </p>
        ) : null}
      </div>
      {!file ? (
        <Field label="Или вставьте строки выписки">
          {(control) => <Textarea {...control} value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={PLACEHOLDER} className="min-h-20 font-mono text-caption" />}
        </Field>
      ) : null}

      {manual && table ? (
        <fieldset className="flex flex-col gap-3 rounded-card border border-border p-3">
          <legend className="px-1 text-body-sm font-semibold text-foreground">Колонки выписки</legend>
          <p className="text-caption text-muted-foreground">Выберите колонки один раз — сопоставление сохранится для этого счёта при импорте.</p>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl<AmountMode>
              aria-label="Как указана сумма"
              value={mapping.amountMode}
              onValueChange={(amountMode) => setMapping({ ...mapping, amountMode })}
              options={(Object.keys(AMOUNT_MODE_LABELS) as AmountMode[]).map((value) => ({ value, label: AMOUNT_MODE_LABELS[value] }))}
            />
            <SegmentedControl<"yes" | "no">
              aria-label="Строка заголовков"
              value={mapping.hasHeader ? "yes" : "no"}
              onValueChange={(value) => setMapping({ ...mapping, hasHeader: value === "yes" })}
              options={[
                { value: "yes", label: "Есть заголовки" },
                { value: "no", label: "Без заголовков" },
              ]}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {mappingFields(mapping.amountMode).map((field) => (
              <Field key={field} label={`${FIELD_LABELS[field]}${requiredFields(mapping.amountMode).includes(field) ? "" : " (необязательно)"}`}>
                {(control) => <Select {...control} value={columnOf(field)} onValueChange={(value) => setColumn(field, value)} options={[{ value: NONE, label: "Не выбрана" }, ...table.options]} />}
              </Field>
            ))}
            {mapping.amountMode === "direction" ? (
              <Field label="Значения прихода" hint="Через запятую; остальное — расход">
                {(control) => <Input {...control} value={mapping.incomingValues ?? DEFAULT_INCOMING} onChange={(event) => setMapping({ ...mapping, incomingValues: event.target.value })} />}
              </Field>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      {parsed && totals ? (
        parsed.problems.length ? (
          <Banner tone="danger" title="Файл не разобран">
            {parsed.problems.join(". ")}
          </Banner>
        ) : (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-body-sm text-foreground">
              Распознано строк: <span className="font-semibold">{totals.count}</span> · приход {formatTenge(totals.incoming)} · расход {formatTenge(totals.outgoing)}
              {parsed.skipped ? <span className="text-muted-foreground"> · без даты пропущено: {parsed.skipped}</span> : null}
            </p>
            {parsed.errors.length ? (
              <Banner tone="danger" title={`Строк с ошибками: ${parsed.errors.length}`}>
                <ul className="list-disc pl-4">
                  {parsed.errors.slice(0, 5).map((row) => (
                    <li key={row.line}>
                      Строка {row.line}: {row.message}
                    </li>
                  ))}
                </ul>
              </Banner>
            ) : null}
          </div>
        )
      ) : null}
      {error ? (
        <Banner tone="danger" title="Не удалось выполнить действие">
          {error}
        </Banner>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void runImport()} disabled={Boolean(blocked) || busy !== null} title={blocked ?? undefined}>
            {busy === "import" ? "Импорт…" : "Импортировать"}
          </Button>
          {blocked && parsed ? <p className="text-caption text-muted-foreground">{blocked}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {recent?.length ? (
            <Select
              aria-label="Выписка"
              className="w-full sm:w-72"
              value={selectedImport ?? undefined}
              onValueChange={setStatement}
              options={recent.map((row) => ({ value: row.externalId, label: `${formatBusinessDate(row.periodFrom)} — ${formatBusinessDate(row.periodTo)} · ${bankName(row.bank)}`, hint: `${row.importedCount} строк` }))}
            />
          ) : null}
          <Button variant="secondary" onClick={() => void runMatch()} disabled={!selectedImport || busy !== null}>
            {busy === "match" ? "Сопоставление…" : "Сопоставить автоматически"}
          </Button>
        </div>
      </div>
    </section>
  )
}
