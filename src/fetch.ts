import fs from 'node:fs';
import path from 'node:path';
import { INDEX_URL, FIRST_BULLETIN, bulletinUrl, monthsBetween, monthsFromIndex } from './months.js';
import { fetchLive, fetchWayback, closeBrowser, sleep, BlockedError } from './http.js';

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
  const missing = wanted.filter((m) => !fs.existsSync(path.join(RAW, `${m}.html`)));
  console.log(`month source: ${source}; ${wanted.length} wanted, ${missing.length} missing`);
  let blocked = 0, notFound = 0, fetched = 0;
  let liveOk = true;
  if (process.env.REVERSE === '1') missing.reverse();
  for (const ym of missing) {
    if (fs.existsSync(path.join(RAW, `${ym}.html`))) continue; // another worker got it
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
        if (probe.has(ym)) console.log(`${ym}: not available (probe, probably unpublished)`);
        else {
          blocked++;
          console.log(`${ym}: BLOCKED (live + wayback)`);
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
  if (blocked > 0) process.exitCode = 2;
}
main();
