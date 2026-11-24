import { exportFileName } from './excel';

/** Saves `blob` as a download named `fileName`. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start the download after the click returns.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** A file name like `clims-stock-by-store-2026-11-24.csv` for `name`. */
export function downloadName(name: string, extension: string, now: Date = new Date()): string {
  return exportFileName(name, now).replace(/\.xlsx$/, `.${extension}`);
}

/**
 * One CSV cell. Text a spreadsheet could run as a formula (=, +, -, @, tab,
 * carriage return) is prefixed with an apostrophe, as the server's CSV does.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const BOM = String.fromCharCode(0xfeff);

/** A CSV document with a byte order mark, so Excel reads it as UTF-8. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return `${BOM}${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function downloadCsvText(text: string, name: string): void {
  saveBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), downloadName(name, 'csv'));
}
