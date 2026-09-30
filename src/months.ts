export const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const BASE = 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin';
export const INDEX_URL = `${BASE}.html`;
export const FIRST_BULLETIN = '2015-10';

export function bulletinUrl(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const fy = m >= 10 ? y + 1 : y;
  return `${BASE}/${fy}/visa-bulletin-for-${MONTH_NAMES[m - 1]}-${y}.html`;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Extract YYYY-MM keys from index links like /visa-bulletin-for-july-2023.html */
export function monthsFromIndex(html: string): string[] {
  const set = new Set<string>();
  for (const mm of html.matchAll(/visa-bulletin-for-([a-z]+)-(\d{4})\.html/gi)) {
    const idx = MONTH_NAMES.indexOf(mm[1].toLowerCase());
    if (idx >= 0) set.add(`${mm[2]}-${String(idx + 1).padStart(2, '0')}`);
  }
  return [...set].sort();
}

/** The PDF edition, e.g. .../Bulletins/visabulletin_October2026.pdf (current naming; older years vary). */
export function bulletinPdfUrl(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const name = MONTH_NAMES[m - 1];
  return `https://travel.state.gov/content/dam/visas/Bulletins/visabulletin_${name[0].toUpperCase()}${name.slice(1)}${y}.pdf`;
}
