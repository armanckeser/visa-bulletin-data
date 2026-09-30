import fs from 'node:fs';
import path from 'node:path';
import { INDEX_URL, FIRST_BULLETIN, bulletinUrl, bulletinPdfUrl, monthsBetween, monthsFromIndex } from './months.js';
import { fetchLive, fetchWayback, fetchPdf, closeBrowser, sleep, BlockedError } from './http.js';
import { pdfToHtml } from './pdf.js';
import { parseBulletin } from './parse.js';

const RAW = path.resolve('raw');
const DELAY_MS = 2000;

function looksLikeBulletin(html: string) {
  return /Visa Bulletin For/i.test(html) && /<table/i.test(html);
}

async function getIndexMonths(): Promise<{ months: string[]; source: string }> {
  try {
    const html = await fetchLive(INDEX_URL);
    const months = monthsFromIndex(html);
    if (months.length) return { months, source: 'live index' };
  } catch (e) {
    console.warn(`index live fetch failed: ${(e as Error).message}`);
  }
  try {
    const html = await fetchWayback(INDEX_URL);
    const months = monthsFromIndex(html);
    if (months.length) return { months, source: 'wayback index' };
  } catch (e) {
    console.warn(`index wayback fetch failed: ${(e as Error).message}`);
  }
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const to = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  return { months: monthsBetween(FIRST_BULLETIN, to), source: 'generated range' };
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const { months, source } = await getIndexMonths();
  // Index snapshots can lag behind: also probe every month up to next month.
  const now = new Date();
  const nx = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const knownMax = months[months.length - 1];
  const probe = new Set(monthsBetween(knownMax, `${nx.getFullYear()}-${String(nx.getMonth() + 1).padStart(2, '0')}`).slice(1));
  const wanted = [...new Set([...months, ...probe])].sort().filter((m) => m >= FIRST_BULLETIN);
  const have = (m: string) => fs.existsSync(path.join(RAW, `${m}.html`)) || fs.existsSync(path.join(RAW, `${m}.pdf`));
  const missing = wanted.filter((m) => !have(m));
  console.log(`month source: ${source}; ${wanted.length} wanted, ${missing.length} missing`);
  // A bulletin normally appears mid-month for the next month, so from the 20th on a missing next month
  // is overdue (the fetch is failing) rather than unpublished.
  const ymOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const thisMonth = ymOf(now);
  const nextMonth = ymOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
  const overdue = (ym: string) => ym <= thisMonth || (ym === nextMonth && now.getUTCDate() >= 20);
  const overdueMissing: string[] = [];
  let blocked = 0, notFound = 0, fetched = 0;
  let liveOk = true;
  if (process.env.REVERSE === '1') missing.reverse();
  for (const ym of missing) {
    if (have(ym)) continue; // another worker got it
    const url = bulletinUrl(ym);
    let html: string | undefined;
    if (liveOk) {
      try {
        html = await fetchLive(url);
      } catch (e) {
        if (e instanceof BlockedError) liveOk = false; // stop hammering a blocked origin
        else if ((e as Error).message.startsWith('404')) {
          notFound++;
          console.log(`${ym}: 404 (not published)`);
          await sleep(DELAY_MS);
          continue;
        }
      }
    }
    if (!html) {
      try {
        html = await fetchWayback(url);
      } catch {
        // Last resort: the PDF edition (its /content/dam path is archived more often than the HTML page).
        try {
          const pdf = await fetchPdf(bulletinPdfUrl(ym));
          parseBulletin(await pdfToHtml(new Uint8Array(pdf)), ym); // throws unless it parses cleanly
          fs.writeFileSync(path.join(RAW, `${ym}.pdf`), pdf);
          fetched++;
          console.log(`${ym}: saved PDF (${pdf.length} bytes)`);
          await sleep(DELAY_MS);
          continue;
        } catch (e) {
          if (!(e instanceof BlockedError)) console.log(`${ym}: PDF unusable: ${(e as Error).message}`);
        }
        if (probe.has(ym) && !overdue(ym)) console.log(`${ym}: not available (probe, probably unpublished)`);
        else {
          blocked++;
          overdueMissing.push(ym);
          console.log(`${ym}: BLOCKED (live + wayback + PDF)`);
        }
        await sleep(DELAY_MS);
        continue;
      }
    }
    if (!looksLikeBulletin(html)) {
      console.log(`${ym}: unexpected content`);
      blocked++;
      continue;
    }
    fs.writeFileSync(path.join(RAW, `${ym}.html`), html);
    fetched++;
    console.log(`${ym}: saved (${html.length} bytes)`);
    await sleep(DELAY_MS);
  }
  await closeBrowser();
  console.log(`fetched=${fetched} notFound=${notFound} blocked=${blocked}`);
  // Read by the workflow for the "blocked" issue body (not committed).
  fs.writeFileSync(
    'missing.md',
    overdueMissing.map((ym) => `- \`raw/${ym}.pdf\` from ${bulletinPdfUrl(ym)}`).join('\n') + '\n',
  );
  if (blocked > 0) process.exitCode = 2;
}
main();
