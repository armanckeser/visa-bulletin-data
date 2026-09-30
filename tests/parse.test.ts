import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBulletin } from '../src/parse.js';

const GOLDEN = ['2015-10', '2019-06', '2023-07', '2026-07'];

for (const ym of GOLDEN) {
  test(`${ym} parses to the reviewed golden rows`, () => {
    const rows = parseBulletin(fs.readFileSync(`raw/${ym}.html`, 'utf8'), ym);
    const expected = JSON.parse(fs.readFileSync(`tests/golden/${ym}.expected.json`, 'utf8'));
    assert.deepEqual(rows, expected);
  });
}

// Hand-checked against the bulletin HTML.
const SPOT: [string, string, string, string, string, string][] = [
  ['2019-06', 'final_action', 'EB2', 'IN', 'date', '2009-04-19'],
  ['2019-06', 'dates_for_filing', 'EB2', 'IN', 'date', '2009-06-01'],
  ['2023-07', 'final_action', 'EB3', 'ROW', 'date', '2022-02-01'],
  ['2023-07', 'dates_for_filing', 'EB3', 'ROW', 'date', '2023-05-01'],
  ['2026-07', 'final_action', 'EB2', 'ROW', 'current', ''],
  ['2026-07', 'final_action', 'EB2', 'IN', 'unavailable', ''],
  ['2026-07', 'final_action', 'F2A', 'MX', 'date', '2024-01-01'],
];

test('spot values match the bulletins', () => {
  for (const [ym, chart, category, country, status, date] of SPOT) {
    const row = parseBulletin(fs.readFileSync(`raw/${ym}.html`, 'utf8'), ym).find(
      (r) => r.chart === chart && r.category === category && r.country === country,
    );
    assert.ok(row, `${ym} ${chart} ${category} ${country} missing`);
    assert.equal(row.status, status, `${ym} ${chart} ${category} ${country}`);
    assert.equal(row.date, date, `${ym} ${chart} ${category} ${country}`);
  }
});

test('every raw bulletin parses with no duplicate keys', () => {
  for (const f of fs.readdirSync('raw').filter((name) => name.endsWith('.html'))) {
    const ym = f.slice(0, 7);
    const rows = parseBulletin(fs.readFileSync(`raw/${f}`, 'utf8'), ym);
    const keys = rows.map((r) => [r.chart, r.kind, r.category, r.country].join('|'));
    assert.equal(new Set(keys).size, keys.length, `${ym} has duplicate rows`);
    assert.ok(rows.some((r) => r.chart === 'final_action' && r.kind === 'employment'), `${ym} missing employment FAD`);
    assert.ok(rows.some((r) => r.chart === 'final_action' && r.kind === 'family'), `${ym} missing family FAD`);
  }
});
