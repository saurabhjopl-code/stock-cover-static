
# Stock Cover Analyzer — Static HTML (Client-side)

This is a **zero-backend** implementation of the Stock Cover Analyzer.
Everything runs in the browser — users upload two CSV files and the analysis happens locally with JavaScript.

## Features
- Parse Sales CSV and Stock CSV using PapaParse (client-side)
- Compute DRR (Daily Run Rate), 30-day requirement
- Compute SKU-level and Warehouse-level stock cover
- Recommend refill quantities and warehouses
- Report excess stock (>60 days)
- Download analysis CSVs
- Works entirely in the browser, suitable for GitHub Pages

## How to host on GitHub Pages
1. Create a new repository or use your existing repo.
2. Add these files (`index.html`, `script.js`, `styles.css`) to the repo root or a `docs/` folder.
3. In repo settings → Pages → select branch `main` and folder `/ (root)` or `/docs` depending on where you put files.
4. Save — GitHub Pages will publish the static site.

## Local testing
Open `index.html` in your browser (double-click) or serve with a static server (recommended):
```
npx http-server .
# or
python -m http.server 8000
```

## Notes & Assumptions
- DRR uses unique sale days if `Order Date` column exists in Sales CSV; otherwise defaults to 30 days.
- Column name matching is flexible (handles common variants).
- All processing stays on the user's machine (no file uploads to servers).
