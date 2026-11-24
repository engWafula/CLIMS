import { describe, expect, it } from 'vitest';

import { csvCell, downloadName, toCsv } from './download';

describe('CSV export', () => {
  it('neutralises text a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+256 772')).toBe("'+256 772");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@user')).toBe("'@user");
  });

  it('quotes commas and line breaks, keeps numbers, and leaves blanks blank', () => {
    expect(csvCell('Kampala, Central')).toBe('"Kampala, Central"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('starts with a byte order mark so Excel reads UTF-8', () => {
    const text = toCsv(['District', 'Pieces'], [['Gulu', 1200]]);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe('District,Pieces\r\nGulu,1200\r\n');
  });

  it('names files after the report and the day', () => {
    expect(downloadName('Stock by store', 'csv', new Date('2026-11-24T08:00:00Z'))).toBe(
      'clims-stock-by-store-2026-11-24.csv',
    );
  });
});
