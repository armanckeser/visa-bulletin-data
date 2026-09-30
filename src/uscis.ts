import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { MONTH_NAMES } from './months.js';
import { fetchLive, closeBrowser } from './http.js';

export const USCIS_URL =
  'https://www.uscis.gov/green-card/green-card-processes-and-procedures/visa-availability-priority-dates/adjustment-of-status-filing-charts-from-the-visa-bulletin';

export type UscisChoice = { family: 'dates_for_filing' | 'final_action'; employment: 'dates_for_filing' | 'final_action' };

/** Parse the "Current Month's" section of the USCIS filing-charts page. */
export function parseUscisChart(html: string): { month: string; choice: UscisChoice } {
  const $ = cheerio.load(html);
  const text = ($('main').text() || $.root().text()).replace(/ /g, ' ').replace(/\s+/g, ' ');
  const start = text.search(/Current Month/i);
  if (start < 0) throw new Error('USCIS page: no "Current Month" section');
  let section = text.slice(start);
  const end = section.search(/Next Month/i);
  if (end > 0) section = section.slice(0, end);
  const pick = (label: RegExp) => {
    const m = label.exec(section);
    if (!m) throw new Error(`USCIS page: missing ${label}`);
    const rest = section.slice(m.index + m[0].length);
    const c = /you must use the (Dates for Filing|Final Action Dates) chart in the Department of State Visa Bulletin for ([A-Za-z]+) (\d{4})/i.exec(rest);
    if (!c) throw new Error(`USCIS page: cannot read chart choice after ${label}`);
    const mi = MONTH_NAMES.indexOf(c[2].toLowerCase());
    return { chart: /filing/i.test(c[1]) ? ('dates_for_filing' as const) : ('final_action' as const), month: `${c[3]}-${String(mi + 1).padStart(2, '0')}` };
  };
  const fam = pick(/For Family-Sponsored Filings:?/i);
  const emp = pick(/For Employment-Based Preference Filings:?/i);
  if (fam.month !== emp.month) throw new Error('USCIS page: family/employment months differ');
  return { month: fam.month, choice: { family: fam.chart, employment: emp.chart } };
}

async function main() {
  const html = await fetchLive(USCIS_URL);
  await closeBrowser();
  const { month, choice } = parseUscisChart(html);
  const file = path.resolve('data/uscis_chart.json');
  const cur: Record<string, UscisChoice> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  cur[month] = choice;
  const sorted = Object.fromEntries(Object.entries(cur).sort(([a], [b]) => a.localeCompare(b)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`uscis chart ${month}: ${JSON.stringify(choice)}`);
}

if (process.argv[1]?.endsWith('uscis.ts')) main();
