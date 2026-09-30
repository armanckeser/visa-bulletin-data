import { getDocumentProxy } from 'unpdf';

/**
 * Converts a Visa Bulletin PDF into the same HTML shape as the web bulletin (paragraphs + <table>s),
 * so parse.ts stays the single source of truth for categories, countries and cells.
 * Tables are rebuilt from positioned text: header clusters give the columns, each line of cells gives a row.
 */

interface Item {
  x: number;
  y: number;
  w: number;
  s: string;
}
type Line = { y: number; items: Item[] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (items: Item[]) =>
  [...items]
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((i) => i.s.trim())
    .join(' ')
    .replace(/([a-z])- ([a-z])/g, '$1$2') // "All Charge- ability Areas"
    .replace(/\s+/g, ' ')
    .trim();

function toLines(items: Item[]): Line[] {
  const lines: Line[] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 2);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

const ROW_LABEL = /^(1st|2nd|3rd|4th|5th|F1|F2A|F2B|F3|F4|Other Workers|Certain)\b/;
const TABLE_START = /^(Family|Employment)-?( ?-?(Based|Sponsored))?$/;

/** Joins "01" "JUL" "2" "3" into "01JUL23": glyph runs closer than `gap` belong to one cell. */
function mergeCells(items: Item[], gap = 4): Item[] {
  const out: Item[] = [];
  for (const it of [...items].sort((a, b) => a.x - b.x)) {
    const prev = out[out.length - 1];
    if (prev && it.x - (prev.x + prev.w) < gap) {
      prev.s += it.s.trim();
      prev.w = it.x + it.w - prev.x;
    } else out.push({ ...it, s: it.s.trim() });
  }
  return out;
}

function buildTable(lines: Line[], start: number): { html: string; end: number } {
  const anchor = lines[start];
  const labelX = anchor.items.find((i) => TABLE_START.test(i.s.trim()))!.x;
  // Header spans from a little above the anchor down to the first labelled data row.
  let first = lines.findIndex((l, i) => i > start && l.items.some((it) => it.x < labelX + 60 && ROW_LABEL.test(it.s.trim())));
  if (first < 0) throw new Error('pdf: table without data rows');
  let head = start;
  // Column-header lines above the anchor sit entirely right of the label column; prose does not.
  while (head > 0 && lines[head - 1].y - anchor.y < 50 && lines[head - 1].items.every((i) => i.x >= labelX + 60 && i.w < 150)) head--;
  const headerItems = lines.slice(head, first).flatMap((l) => l.items);
  const labelItems = headerItems.filter((i) => i.x < labelX + 60 && /^(Family|Employment|Sponsored|Based)\b/.test(i.s.trim()));
  const colItems = headerItems.filter((i) => !labelItems.includes(i));

  // Column clusters: header words whose x-ranges overlap (with slack) share a column.
  const cols: { x0: number; x1: number; items: Item[] }[] = [];
  for (const it of [...colItems].sort((a, b) => a.x - b.x)) {
    const c = cols.find((c) => it.x <= c.x1 + 6 && it.x + it.w >= c.x0 - 6);
    if (c) {
      c.items.push(it);
      c.x0 = Math.min(c.x0, it.x);
      c.x1 = Math.max(c.x1, it.x + it.w);
    } else cols.push({ x0: it.x, x1: it.x + it.w, items: [it] });
  }
  cols.sort((a, b) => a.x0 - b.x0);
  const boundary = cols[0].x0 - 6;
  const centers = cols.map((c) => (c.x0 + c.x1) / 2);

  // Body: until a paragraph-width line, the next table, or a big vertical gap.
  let end = first;
  while (
    end < lines.length &&
    !lines[end].items.some((i) => i.w > 200 || TABLE_START.test(i.s.trim())) &&
    (end === first || lines[end - 1].y - lines[end].y < 40)
  )
    end++;
  const body = lines.slice(first, end);
  const cellLines = body.filter((l) => l.items.some((i) => i.x >= boundary));
  const rows = cellLines.map((l) => ({ y: l.y, label: [] as Item[], cells: l.items.filter((i) => i.x >= boundary) }));
  // Labels wrap over several lines ("Certain / Religious / Workers"): a block starts at each row label
  // and runs until the next; it belongs to the cell line closest to the block's middle.
  const blocks: Item[][] = [];
  for (const it of body.flatMap((l) => l.items).filter((i) => i.x < boundary)) {
    if (ROW_LABEL.test(it.s.trim()) || !blocks.length) blocks.push([it]);
    else blocks[blocks.length - 1].push(it);
  }
  for (const b of blocks) {
    const ys = b.map((i) => i.y);
    const top = Math.max(...ys);
    const bottom = Math.min(...ys);
    const inside = rows.filter((r) => r.y <= top + 2 && r.y >= bottom - 2);
    const mid = (top + bottom) / 2;
    const pool = inside.length ? inside : rows;
    const target = pool.reduce((a, r) => (Math.abs(r.y - mid) < Math.abs(a.y - mid) ? r : a));
    if (target.label.length) throw new Error(`pdf: two labels for one row ("${text(target.label)}", "${text(b)}")`);
    target.label.push(...b);
  }

  const tr = (cells: string[]) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
  const out = [tr([text(labelItems), ...cols.map((c) => text(c.items))])];
  for (const r of rows) {
    const values: string[] = cols.map(() => '');
    for (const cell of mergeCells(r.cells)) {
      const mid = cell.x + cell.w / 2;
      const ci = centers.reduce((best, c, i) => (Math.abs(c - mid) < Math.abs(centers[best] - mid) ? i : best), 0);
      if (values[ci]) throw new Error(`pdf: two cells in one column on row "${text(r.label)}"`);
      values[ci] = cell.s;
    }
    out.push(tr([text(r.label), ...values]));
  }
  return { html: `<table>${out.join('')}</table>`, end };
}

export async function pdfToHtml(buf: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(buf);
  // One continuous stream of lines: page headers/footers dropped, and each page shifted to sit
  // just below the previous one, so tables that break across pages read as one table.
  const lines: Line[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const items: Item[] = (tc.items as any[])
      .filter((i) => typeof i.str === 'string' && i.str.trim())
      .map((i) => ({ x: i.transform[4], y: i.transform[5], w: i.width, s: i.str }))
      .filter((i) => i.y > 60 && i.y < 740);
    const page = toLines(items);
    if (!page.length) continue;
    const shift = lines.length ? lines[lines.length - 1].y - 15 - page[0].y : 0;
    for (const l of page) {
      for (const it of l.items) it.y += shift;
      lines.push({ y: l.y + shift, items: l.items });
    }
  }
  const parts: string[] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].items.some((it) => TABLE_START.test(it.s.trim()) && it.x < 140)) {
      // Header lines above the anchor were already emitted as text; they carry no chart cue, so that is harmless.
      const t = buildTable(lines, i);
      parts.push(t.html);
      i = t.end;
    } else {
      parts.push(`<p>${esc(text(lines[i].items))}</p>`);
      i++;
    }
  }
  return `<html><head><title>Visa Bulletin (from PDF)</title></head><body>${parts.join('\n')}</body></html>`;
}
