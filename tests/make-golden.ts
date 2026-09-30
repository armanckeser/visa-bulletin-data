// Regenerates tests/golden/<ym>.expected.json from raw/. Review the diff by hand before committing.
import fs from 'node:fs';
import { parseBulletin } from '../src/parse.js';
for (const ym of process.argv.slice(2)) {
  const rows = parseBulletin(fs.readFileSync(`raw/${ym}.html`, 'utf8'), ym);
  fs.writeFileSync(`tests/golden/${ym}.expected.json`, JSON.stringify(rows, null, 0).replace(/\},\{/g, '},\n{') + '\n');
  console.log(ym, rows.length);
}
