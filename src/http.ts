import { chromium, type Browser } from 'playwright-core';
import { execFile } from 'node:child_process';

export const UA_SUFFIX = '(+https://github.com/armanckeser/visa-bulletin-data)';
export const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ${UA_SUFFIX}`;
export const HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

export class BlockedError extends Error {}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isBlocked(html: string): boolean {
  return /<title>\s*(Attention Required|Just a moment)/i.test(html);
}

export async function plainFetch(url: string, timeoutMs = 60000): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, body: await res.text() };
}

/** curl is markedly more reliable than undici against web.archive.org. */
export function curlGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-sS', '--compressed', '-L', '-m', '60', '-A', UA, '-w', '\n%{http_code}', url],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        const i = stdout.lastIndexOf('\n');
        resolve({ status: Number(stdout.slice(i + 1)), body: stdout.slice(0, i) });
      },
    );
  });
}

let browser: Browser | undefined;
async function getBrowser(): Promise<Browser> {
  if (!browser) {
    const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
    browser = await chromium.launch({
      headless: process.env.PW_HEADED !== '1',
      ...(channel ? { channel } : {}),
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }
  return browser;
}
export async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}

export async function playwrightFetch(url: string): Promise<string> {
  const b = await getBrowser();
  const ctx = await b.newContext({ locale: 'en-US', userAgent: UA });
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 6; i++) {
      const html = await page.content();
      if (!isBlocked(html)) return html;
      await page.waitForTimeout(4000);
    }
    throw new BlockedError(`playwright blocked: ${url}`);
  } finally {
    await ctx.close();
  }
}

/** Fetch a travel.state.gov / uscis page: plain fetch, then Playwright. */
export async function fetchLive(url: string): Promise<string> {
  try {
    const r = await plainFetch(url);
    if (r.status === 200 && !isBlocked(r.body)) return r.body;
    if (r.status === 404) throw new Error(`404 ${url}`);
  } catch (e) {
    if ((e as Error).message.startsWith('404')) throw e;
  }
  return playwrightFetch(url);
}

/** Wayback Machine fallback: newest non-blocked 200 snapshot, raw (id_) bytes. */
export async function fetchWayback(url: string): Promise<string> {
  const tryUrl = async (u: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await curlGet(u);
        if (r.status === 200 && !isBlocked(r.body)) return r.body;
        if (r.status === 404 || r.status === 403 || r.status === 200) return undefined;
        await sleep(3000);
      } catch {
        await sleep(3000);
      }
    }
    return undefined;
  };
  const direct = await tryUrl(`https://web.archive.org/web/2026id_/${url}`);
  if (direct) return direct;
  // Newest snapshots with status 200, tried from newest to oldest.
  const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}&output=txt&fl=timestamp&filter=statuscode:200&limit=-8`;
  let stamps: string[] = [];
  for (let attempt = 0; attempt < 3 && !stamps.length; attempt++) {
    try {
      const r = await curlGet(cdx);
      if (r.status === 200) stamps = r.body.trim().split(/\s+/).filter(Boolean).reverse();
    } catch {
      await sleep(3000);
    }
  }
  for (const ts of stamps) {
    const b = await tryUrl(`https://web.archive.org/web/${ts}id_/${url}`);
    if (b) return b;
  }
  throw new BlockedError(`wayback has no usable snapshot: ${url}`);
}
