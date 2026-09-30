import * as cheerio from 'cheerio';

export type Chart = 'final_action' | 'dates_for_filing';
export type Kind = 'employment' | 'family';
export type Status = 'date' | 'current' | 'unavailable';

export interface Row {
  bulletin: string;
  chart: Chart;
  kind: Kind;
  category: string;
  country: string;
  status: Status;
  date: string;
}

export class ParseError extends Error {}

const norm = (s: string) =>
  s
    .replace(/[  -​ ﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Normalised key: lowercase, letters/digits only separated by single spaces. */
const key = (s: string) =>
  norm(s)
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

/* ------------------------------------------------------------------ countries */

// Keys are key()-normalised header text (footnote markers already stripped).
const COUNTRY_HEADERS: Record<string, string> = {
  'all chargeability areas except those listed': 'ROW',
  'all chargeability areas': 'ROW',
  china: 'CN',
  'china mainland born': 'CN',
  'china mainland': 'CN',
  'china born': 'CN',
  india: 'IN',
  mexico: 'MX',
  philippines: 'PH',
  'el salvador guatemala honduras': 'SV_GT_HN',
  'central america': 'SV_GT_HN',
  vietnam: 'VN',
  'viet nam': 'VN',
};

/* ------------------------------------------------------------------ categories */

const FAMILY_ROWS: Record<string, string> = {
  f1: 'F1',
  f2a: 'F2A',
  f2b: 'F2B',
  f3: 'F3',
  f4: 'F4',
  '1st': 'F1',
  '2a': 'F2A',
  '2b': 'F2B',
  '3rd': 'F3',
  '4th': 'F4',
};

// Employment: "1st".."4th", "5th ..." set-aside variants, explicit codes.
// Older EB5 labels are documented in the README.
function employmentCategory(label: string): string | undefined {
  const k = key(label);
  if (k === '1st' || k === 'eb 1' || k === 'eb1') return 'EB1';
  if (k === '2nd' || k === 'eb 2' || k === 'eb2') return 'EB2';
  if (k === '3rd' || k === 'professionals' || k === 'skilled workers professionals') return 'EB3';
  if (k === 'other workers') return 'EW';
  if (k === '4th' || k === 'certain special immigrants') return 'EB4';
  if (k === 'certain religious workers') return 'EB4_RW';
  // EB-5 generations
  if (/^5th\b/.test(k) || /^(eb ?5)\b/.test(k)) {
    if (/set aside rural|rural/.test(k)) return 'EB5_RURAL';
    if (/high unemployment/.test(k)) return 'EB5_HIGH_UNEMPLOYMENT';
    if (/infrastructure/.test(k)) return 'EB5_INFRASTRUCTURE';
    // May 2022 only: the regional-center lapse split unreserved into I5/R5 and everything else.
    if (/unreserved/.test(k) && /\bi5\b.*\br5\b/.test(k)) return 'EB5_UNRESERVED_I5_R5';
    if (/unreserved/.test(k)) return 'EB5_UNRESERVED';
    // Pre-2022 labels (before the EB-5 Reform and Integrity Act set-asides); documented in the README.
    if (/non regional center/.test(k)) return 'EB5_NON_REGIONAL_CENTER';
    if (/targeted employment/.test(k)) return 'EB5_TEA_REGIONAL_PILOT';
    if (/regional center/.test(k)) return 'EB5_REGIONAL_CENTER';
    if (k === '5th') return 'EB5_UNRESERVED';
  }
  return undefined;
}

/* ------------------------------------------------------------------ cells */

export function parseCell(raw: string): { status: Status; date: string } {
  // strip footnote markers (*, digits in brackets, superscripts) and whitespace
  const t = norm(raw).replace(/[*†‡¹²³]/g, '').replace(/\s+/g, '').toUpperCase();
  if (t === 'C' || t === 'CURRENT') return { status: 'current', date: '' };
  if (t === 'U' || t === 'UNAVAILABLE' || t === 'UNAUTHORIZED') return { status: 'unavailable', date: '' };
  const m = /^(\d{1,2})([A-Z]{3})(\d{2}|\d{4})$/.exec(t);
  if (!m) throw new ParseError(`unparseable cell: ${JSON.stringify(raw)}`);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const mi = months.indexOf(m[2]);
  if (mi < 0) throw new ParseError(`bad month in cell: ${JSON.stringify(raw)}`);
  let y = Number(m[3]);
  if (m[3].length === 2) y = y >= 50 ? 1900 + y : 2000 + y;
  const iso = `${y}-${String(mi + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new ParseError(`invalid date ${iso} from ${JSON.stringify(raw)}`);
  return { status: 'date', date: iso };
}

/* ------------------------------------------------------------------ tables */

export interface FoundTable {
  kind: Kind;
  chart: Chart;
  rows: string[][];
}

const cellText = ($: cheerio.CheerioAPI, el: any) => norm($(el).text());

export function findTables(html: string): FoundTable[] {
  const $ = cheerio.load(html);
  const tables = $('table').filter((_, el) => $(el).parents('table').length === 0).toArray();
  // Replace each table with a marker so we can read the text that precedes it.
  tables.forEach((el, i) => {
    $(el).replaceWith(`\n@@TABLE${i}@@\n`);
  });
  const fullText = $.root().text().replace(/ /g, ' ');
  const segments: string[] = [];
  let last = 0;
  tables.forEach((_, i) => {
    const idx = fullText.indexOf(`@@TABLE${i}@@`);
    segments.push(fullText.slice(last, idx));
    last = idx + `@@TABLE${i}@@`.length;
  });

  // The replaced elements are detached from the document but still readable.
  const found: FoundTable[] = [];
  tables.forEach((el, i) => {
    const trs = $(el).find('tr').toArray();
    if (!trs.length) return;
    const rows = trs.map((tr) => $(tr).children('td,th').toArray().map((c) => cellText($, c)));
    const first = key(rows[0][0] ?? '');
    let kind: Kind | undefined;
    if (/^family/.test(first)) kind = 'family';
    else if (/^employment/.test(first)) kind = 'employment';
    if (!kind) return;
    const seg = norm(segments[i]).toUpperCase();
    // Nearest chart cue before the table.
    let chart: Chart | undefined;
    let pos = -1;
    for (const m of seg.matchAll(/FINAL\s+ACTION|DATES?\s+FOR\s+FILING/g)) {
      pos = m.index ?? -1;
      chart = /FINAL/.test(m[0]) ? 'final_action' : 'dates_for_filing';
    }
    if (!chart || pos < 0) throw new ParseError(`cannot determine chart for ${kind} table #${i}`);
    found.push({ kind, chart, rows });
  });
  return found;
}

export function parseBulletin(html: string, bulletin: string): Row[] {
  const tables = findTables(html);
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    const id = `${t.kind}/${t.chart}`;
    if (seen.has(id)) throw new ParseError(`${bulletin}: duplicate ${id} table`);
    seen.add(id);
    const header = t.rows[0].slice(1);
    const countries = header.map((h) => {
      const c = COUNTRY_HEADERS[key(h)];
      if (!c) throw new ParseError(`${bulletin}: unknown country header ${JSON.stringify(h)} in ${id}`);
      return c;
    });
    for (const r of t.rows.slice(1)) {
      if (r.length < 2) continue;
      const label = r[0];
      const category = t.kind === 'family' ? FAMILY_ROWS[key(label)] : employmentCategory(label);
      if (!category) throw new ParseError(`${bulletin}: unknown ${t.kind} row label ${JSON.stringify(label)}`);
      if (r.length - 1 !== countries.length) throw new ParseError(`${bulletin}: row ${label} has ${r.length - 1} cells, header has ${countries.length}`);
      countries.forEach((country, i) => {
        const { status, date } = parseCell(r[i + 1]);
        out.push({ bulletin, chart: t.chart, kind: t.kind, category, country, status, date });
      });
    }
  }
  return sortRows(out);
}

export function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    for (const k of ['bulletin', 'chart', 'kind', 'category', 'country'] as const) {
      if (a[k] < b[k]) return -1;
      if (a[k] > b[k]) return 1;
    }
    return 0;
  });
}
