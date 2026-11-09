import { describe, expect, it } from 'vitest';
import { inspectCsv, parseConsent, parseCsv } from './csv';

describe('parseCsv', () => {
  it('handles CRLF, blank lines and true line numbers', () => {
    const rows = parseCsv('name,phone\r\nTolu,0803\r\n\r\nAda,0809');
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
    expect(rows[2].cells).toEqual(['Ada', '0809']);
  });
  it('handles quoted commas and escaped quotes', () => {
    const rows = parseCsv('name,phone\n"Okafor, Emeka","08 03"\n"Say ""hi""",1');
    expect(rows[1].cells).toEqual(['Okafor, Emeka', '08 03']);
    expect(rows[2].cells[0]).toBe('Say "hi"');
  });
});

describe('inspectCsv', () => {
  it('needs a name and phone header', () => {
    expect(inspectCsv('').ok).toBe(false);
    expect(inspectCsv('a,b\n1,2').ok).toBe(false);
    expect(inspectCsv('name,phone\nTolu,0803 123 4567')).toEqual({ ok: true, rows: 1 });
    expect(inspectCsv('Name,Phone').ok).toBe(false);
  });
});

describe('parseConsent', () => {
  it('reads yes-like values', () => {
    expect(parseConsent('Yes')).toBe(true);
    expect(parseConsent('1')).toBe(true);
    expect(parseConsent('no')).toBe(false);
    expect(parseConsent(undefined)).toBe(false);
  });
});
