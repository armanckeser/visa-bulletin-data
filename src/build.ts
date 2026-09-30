import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { parseBulletin, sortRows, type Row } from './parse.js';
import { pdfToHtml } from './pdf.js';

const RAW = path.resolve('raw');
const DATA = path.resolve('data');

export const COLUMNS = ['bulletin', 'chart', 'kind', 'category', 'country', 'status', 'date'] as const;

export function toCsv(rows: Row[]): string {
  return [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => r[c]).join(','))].join('\n') + '\n';
}

export interface Change {
  chart: string;
  kind: string;
  category: string;
  country: string;
  from: string | null;
  to: string | null;
  delta_days: number | null;
}

const cellValue = (r: Row | undefined): string | null => (!r ? null : r.status === 'date' ? r.date : r.status === 'current' ? 'C' : 'U');

export function diffBulletins(prev: Row[], cur: Row[]): Change[] {
  const k = (r: Row) => [r.chart, r.kind, r.category, r.country].join('|');
  const pm = new Map(prev.map((r) => [k(r), r]));
  const cm = new Map(cur.map((r) => [k(r), r]));
  const keys = [...new Set([...pm.keys(), ...cm.keys()])].sort();
  const out: Change[] = [];
  for (const key of keys) {
    const a = pm.get(key);
    const b = cm.get(key);
    const from = cellValue(a);
    const to = cellValue(b);
    if (from === to) continue;
    const [chart, kind, category, country] = key.split('|');
    const delta = a?.status === 'date' && b?.status === 'date' ? Math.round((Date.parse(b.date) - Date.parse(a.date)) / 86400000) : null;
    out.push({ chart, kind, category, country, from, to, delta_days: delta });
  }
  return out;
}

export async function buildAll(): Promise<{ rows: Row[]; months: string[] }> {
  // raw/YYYY-MM.html is the web bulletin; raw/YYYY-MM.pdf is the PDF edition, used only when the page was unobtainable.
  const files = fs.readdirSync(RAW).filter((f) => /^\d{4}-\d{2}\.(html|pdf)$/.test(f)).sort();
  let rows: Row[] = [];
  for (const f of files) {
    const ym = f.slice(0, 7);
    if (f.endsWith('.pdf') && files.includes(`${ym}.html`)) continue;
    const html = f.endsWith('.pdf')
      ? await pdfToHtml(new Uint8Array(fs.readFileSync(path.join(RAW, f))))
      : fs.readFileSync(path.join(RAW, f), 'utf8');
    rows.push(...parseBulletin(html, ym));
  }
  rows = sortRows(rows);
  const months = [...new Set(rows.map((r) => r.bulletin))];

  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'visa_bulletin.csv'), toCsv(rows));
  fs.writeFileSync(path.join(DATA, 'visa_bulletin.json'), JSON.stringify(rows, null, 0).replace(/\},\{/g, '},\n{') + '\n');

  const latest = months[months.length - 1];
  const previous = months.length > 1 ? months[months.length - 2] : null;
  const latestRows = rows.filter((r) => r.bulletin === latest);
  const prevRows = previous ? rows.filter((r) => r.bulletin === previous) : [];
  const latestDoc = {
    bulletin: latest,
    rows: latestRows,
    previous_bulletin: previous,
    changes: previous ? diffBulletins(prevRows, latestRows) : [],
  };
  fs.writeFileSync(path.join(DATA, 'latest.json'), JSON.stringify(latestDoc, null, 2) + '\n');

  const dbPath = path.join(DATA, 'visa_bulletin.sqlite');
  for (const suffix of ['', '-journal', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE visa_bulletin (
    bulletin TEXT NOT NULL, chart TEXT NOT NULL, kind TEXT NOT NULL, category TEXT NOT NULL,
    country TEXT NOT NULL, status TEXT NOT NULL, date TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (bulletin, chart, kind, category, country)
  ) WITHOUT ROWID;
  CREATE INDEX idx_vb_lookup ON visa_bulletin (category, country, chart, bulletin);`);
  const ins = db.prepare('INSERT INTO visa_bulletin VALUES (@bulletin,@chart,@kind,@category,@country,@status,@date)');
  db.transaction(() => rows.forEach((r) => ins.run(r)))();
  db.pragma('journal_mode = DELETE');
  db.close();
  return { rows, months };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build.ts')) {
  const { rows, months } = await buildAll();
  console.log(`built ${rows.length} rows across ${months.length} bulletins (${months[0]}..${months[months.length - 1]})`);
}
