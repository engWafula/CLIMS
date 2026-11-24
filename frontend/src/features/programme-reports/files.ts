import type { HttpClient } from '@/lib/api';
import { exportFileName, toExportCell } from '@/lib/export/excel';
import { EMPTY_VALUE, formatDate, formatNumber, formatTimestamp } from '@/lib/format';

import { getCsv, type ReportCell, type ReportTable } from './api';

/** Columns holding a code, shown in words: `awaiting_acknowledgement` → "Awaiting acknowledgement". */
const CODE_COLUMNS = new Set([
  'status',
  'order_status',
  'selection',
  'band',
  'coverage_status',
  'category',
  'store_type',
]);

export function humanize(code: string): string {
  const text = code.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MIDNIGHT_UTC = /T00:00:00(\.0+)?Z$/;

/**
 * A cell as text. Blank data shows the empty marker, never 0, so a genuine
 * zero and a missing value stay distinct (RF15). Date columns, sent as UTC
 * midnight, keep their calendar day.
 */
export function displayCell(key: string, value: ReportCell): string {
  if (value === null || value === '') return EMPTY_VALUE;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return formatNumber(Math.round(value * 10) / 10);
  if (CODE_COLUMNS.has(key)) return humanize(value);
  if (ISO_TIMESTAMP.test(value)) {
    return MIDNIGHT_UTC.test(value) ? formatDate(value.slice(0, 10)) : formatTimestamp(value);
  }
  return value;
}

/**
 * A cell for a printed document: as on screen, except times are absolute
 * ("24 Nov 2026, 06:38" rather than "Today, 06:38"), since paper outlives the day.
 */
export function printCell(key: string, value: ReportCell): string {
  if (typeof value === 'string' && ISO_TIMESTAMP.test(value) && !MIDNIGHT_UTC.test(value)) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Kampala',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }
  return displayCell(key, value);
}

function save(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Downloads the server's CSV for `path`, e.g. `/reports/export/stock?format=csv`. */
export async function downloadCsv(http: HttpClient, path: string, name: string): Promise<void> {
  const text = await getCsv(http, path);
  save(
    new Blob([text], { type: 'text/csv;charset=utf-8' }),
    exportFileName(name, new Date()).replace(/\.xlsx$/, '.csv'),
  );
}

/**
 * Saves the table as .xlsx: the rows as on screen, and an "About" sheet with
 * the period, data update time, scope, product, rule version and definitions.
 */
export async function downloadExcel(table: ReportTable): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const bold = (value: string) => ({ value, type: String, fontWeight: 'bold' as const });
  const rows = table.rows.map((row) =>
    table.columns.map(({ key }) => {
      const value = row[key] ?? null;
      return toExportCell(
        typeof value === 'number' ? value : value === null ? null : displayCell(key, value),
      );
    }),
  );
  const about: [string, string][] = [
    ['Report', table.title],
    ['Period', table.period],
    ['Data updated', formatTimestamp(table.data_updated_at)],
    ['Scope', table.scope],
    ['Product', table.product],
    ['Rule version', table.rule_version],
    ...table.definitions.map((text): [string, string] => ['Definition', text]),
  ];
  await writeExcelFile([
    { sheet: 'Report', data: [table.columns.map((column) => bold(column.header)), ...rows] },
    {
      sheet: 'About',
      data: about.map(([label, text]) => [bold(label), { value: text, type: String }]),
      columns: [{ width: 16 }, { width: 100 }],
    },
  ]).toFile(exportFileName(table.title, new Date()));
}
