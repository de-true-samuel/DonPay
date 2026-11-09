export interface CsvRow { line: number; cells: string[] }

/** Small CSV reader: quoted cells, escaped quotes, CRLF. Blank lines are skipped but line numbers stay true. */
export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  const t = text.replace(/^\uFEFF/, '');
  let cur: string[] = [];
  let cell = '';
  let inQ = false;
  let line = 1;
  let rowLine = 1;
  const push = () => { cur.push(cell.trim()); cell = ''; };
  const endRow = () => { push(); if (cur.some((c) => c !== '')) rows.push({ line: rowLine, cells: cur }); cur = []; };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else { if (ch === '\n') line++; cell += ch; }
    } else if (ch === '"') inQ = true;
    else if (ch === ',') push();
    else if (ch === '\r') { /* ignore */ }
    else if (ch === '\n') { endRow(); line++; rowLine = line; }
    else cell += ch;
  }
  if (cell !== '' || cur.length) endRow();
  return rows;
}

export const parseConsent = (s: string | undefined): boolean => /^(1|y|yes|true|ok)$/i.test((s ?? '').trim());

export interface CsvCheck { ok: boolean; rows: number; message?: string }

/** Quick look before uploading: is there a header with name and phone, and how many people are in it? */
export function inspectCsv(text: string): CsvCheck {
  const rows = parseCsv(text);
  if (!rows.length) return { ok: false, rows: 0, message: 'Paste or choose a CSV first.' };
  const header = rows[0].cells.map((c) => c.toLowerCase());
  if (!header.includes('name') || !header.includes('phone')) {
    return { ok: false, rows: rows.length - 1, message: 'The first line must be a header with name and phone.' };
  }
  return { ok: rows.length > 1, rows: rows.length - 1, message: rows.length > 1 ? undefined : 'There are no customers under the header.' };
}
