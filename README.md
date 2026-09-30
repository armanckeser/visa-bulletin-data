# visa-bulletin-data

A free, openly licensed, machine-readable dataset of the U.S. Department of State **Visa Bulletin**, with every monthly bulletin from **October 2015 (FY2016)** to the present, in CSV, JSON and SQLite. It updates itself daily through a GitHub Action.

## Why this exists

There was no free, openly licensed, machine-readable Visa Bulletin dataset. The existing options are HTML-only or non-commercial, unlicensed, or cover a small slice (for example, employment final-action dates for a handful of countries). Bulletins are U.S. government works (17 U.S.C. section 105), so they are in the public domain, and this dataset should be too.

## Consume it

```
https://raw.githubusercontent.com/armanckeser/visa-bulletin-data/main/data/latest.json
https://raw.githubusercontent.com/armanckeser/visa-bulletin-data/main/data/visa_bulletin.csv
https://raw.githubusercontent.com/armanckeser/visa-bulletin-data/main/data/visa_bulletin.json
https://raw.githubusercontent.com/armanckeser/visa-bulletin-data/main/data/visa_bulletin.sqlite
https://raw.githubusercontent.com/armanckeser/visa-bulletin-data/main/data/uscis_chart.json
```

| File | Contents |
| --- | --- |
| `data/visa_bulletin.csv` | Long format, sorted by bulletin, chart, kind, category, country. |
| `data/visa_bulletin.json` | The same rows as an array of objects. |
| `data/latest.json` | `{bulletin, rows, previous_bulletin, changes}`. `changes` lists every cell that moved versus the previous bulletin (`from`/`to` are an ISO date, `C` or `U`; `delta_days` is set when both are dates). `published_at` is omitted: the bulletin pages do not expose a reliable publication timestamp. |
| `data/visa_bulletin.sqlite` | Table `visa_bulletin` with the same columns, indexed on `(category, country, chart, bulletin)`. |
| `data/uscis_chart.json` | `{ "YYYY-MM": {"family": ..., "employment": ...} }`: which chart USCIS designated for adjustment-of-status filing. Recorded going forward only (the USCIS page shows just the current month), so there is no backfill. |
| `raw/YYYY-MM.html` | The cached original bulletin pages. The parser reads only these, so builds are offline and deterministic. |

## Schema

Columns: `bulletin`, `chart`, `kind`, `category`, `country`, `status`, `date`.

- `bulletin`: `YYYY-MM`, the bulletin's month.
- `chart`: `final_action` or `dates_for_filing`.
- `kind`: `employment` or `family`.
- `status`: `date`, `current` (`C` in the bulletin) or `unavailable` (`U`).
- `date`: `YYYY-MM-DD` when `status` is `date`, otherwise empty. Two-digit years pivot at 50 (50-99 are 19xx).

### Category codes

- Family: `F1`, `F2A`, `F2B`, `F3`, `F4`.
- Employment: `EB1`, `EB2`, `EB3`, `EW` (Other Workers), `EB4`, `EB4_RW` (Certain Religious Workers).
- EB-5, current layout: `EB5_UNRESERVED`, `EB5_RURAL`, `EB5_HIGH_UNEMPLOYMENT`, `EB5_INFRASTRUCTURE`.
- EB-5, May 2022 only: `EB5_UNRESERVED_I5_R5` (unreserved regional-center investors, split out while the program lapsed).
- EB-5, older row labels (explicit codes, not folded into the ones above):
  - `EB5_NON_REGIONAL_CENTER`: "5th Non-Regional Center (C5 and T5)".
  - `EB5_REGIONAL_CENTER`: "5th Regional Center (I5 and R5)".
  - `EB5_TEA_REGIONAL_PILOT`: "5th Targeted Employment Areas/Regional Centers and Pilot Programs".

### Country codes

`ROW` (All Chargeability Areas Except Those Listed), `CN` (China-mainland born), `IN`, `MX`, `PH`, `SV_GT_HN` (El Salvador, Guatemala, Honduras), `VN`.

## How it works

`src/fetch.ts` collects bulletin links from the travel.state.gov index and downloads only months missing from `raw/`, sequentially with a 2 s delay. travel.state.gov sits behind Cloudflare, so it tries plain `fetch`, then Playwright, then the Wayback Machine. `src/parse.ts` finds the four tables by their header and the text just before them (never by position) and maps columns and row labels by name. An unknown header, row label or cell is a hard error rather than a silent guess. `src/build.ts` writes all outputs.

```
npm ci
npm run fetch   # download missing bulletins into raw/
npm run build   # parse raw/ and regenerate data/
npm test        # golden tests
```

## Scope and limits

- Bulletins before October 2015 are out of scope (the modern four-table layout, with both Final Action and Dates for Filing charts, starts there).
- **USCIS processing times are not collected.** egov.uscis.gov is behind a Cloudflare challenge that blocks automated access, so that feature was skipped.
- Some bulletins in `raw/` were retrieved from the Wayback Machine because travel.state.gov blocks automated clients.

## License

Code: MIT (`LICENSE`). Data: CC0 1.0. The bulletins are U.S. government works in the public domain in the United States (17 U.S.C. section 105); CC0 covers the compilation and any rights that might apply elsewhere.

## Disclaimer

This is not legal advice and is not affiliated with the U.S. Department of State or USCIS. Verify anything you rely on against the official bulletin.
