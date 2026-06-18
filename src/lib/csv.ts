// Сериализация таблицы в CSV без внешних зависимостей (CLAUDE.md правило 6).
// По умолчанию — разделитель «;» и BOM: так русский Excel открывает файл без кракозябр
// и сам раскладывает значения по столбцам. Переводы строк — CRLF (дружелюбно к Excel).

export type CsvCell = string | number | null | undefined;

// U+FEFF (UTF-8 BOM) — задаём кодом, чтобы в исходнике не было невидимого символа.
const BOM = String.fromCharCode(0xfeff);

export function toCsv(rows: CsvCell[][], opts?: { delimiter?: string; bom?: boolean }): string {
  const delimiter = opts?.delimiter ?? ";";
  const withBom = opts?.bom ?? true;
  const escape = (v: CsvCell): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((row) => row.map(escape).join(delimiter)).join("\r\n");
  return (withBom ? BOM : "") + body;
}
