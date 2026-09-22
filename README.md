# Clarity — turn any spreadsheet into a report you can act on

Clarity is a browser-based data analysis app. Upload a CSV, Excel or JSON file and it:

1. **Cleans it transparently.** It finds duplicates, blanks, “Guntur” vs “guntur ”, numbers stored as text and mixed date formats. Every fix is previewed, logged and can be undone.
2. **Understands what each column means.** It tells money (₹ in lakh/crore), counts, categories, locations, dates, yes/no outcomes and IDs apart, and recognises what kind of dataset it is: sales, students, customers, HR and so on.
3. **Writes a plain-English report.** The report covers:
   - Who leads and who lags in every category.
   - Trends, and which segments are growing or shrinking.
   - What drives an outcome such as churn or pass/fail.
   - Top items, relationships between measures, and recommendations.

   Every sentence comes from a number computed on your data.

It also has **Explore** (group any measure by any category, split and filter), **Columns** (change how a column is used), **Data**, **Correlations**, and a **Report** you can export as PDF, HTML, Markdown or cleaned CSV. Accounts, saved analyses and dataset storage run on **Supabase**.

---

## Deploy to Netlify (drag and drop)

Everything that goes online is in the **`site/`** folder. No build step.

1. Open your site in Netlify → **Deploys**.
2. Drag the **`site`** folder (or `clarity-netlify.zip`) onto the “Drag and drop your site output folder here” box.
3. Wait for the deploy to finish, then open https://clarityeda.netlify.app.

`clarity-netlify.zip` is the same `site` folder, zipped for convenience. If you change anything in `site/`, drag the folder rather than the old zip. If you deploy from Git instead, `netlify.toml` already sets the publish directory to `site`.

### One-time Supabase settings (2 minutes)

The app already points at your Supabase project (`site/assets/js/config.js`). In the Supabase dashboard:

- **Authentication → URL Configuration**
  - **Site URL:** `https://clarityeda.netlify.app`
  - **Redirect URLs:** add `https://clarityeda.netlify.app/**`

  This makes the email-confirmation, password-reset and Google sign-in links return to your site.
- **Authentication → Providers → Google** is already enabled. In the Google Cloud console, the authorised redirect URI must be `https://revgvcklkozqrizurann.supabase.co/auth/v1/callback`.
- *(Optional)* Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL Editor. It is safe on your existing project and adds the `update` policy that lets **Save changes** update a saved analysis in place. Without it, Clarity deletes the old copy and saves a new one instead.

### Preview locally

```bash
npx serve site      # then open http://localhost:3000
```

(Opening `index.html` straight from disk won't work, because browsers block JavaScript modules on `file://`.)

---

## What's in `site/`

| Path | Purpose |
|---|---|
| `index.html` | Landing page and app container |
| `assets/css/app.css` | Design system: light/dark themes, components, print styles |
| `assets/js/app.js` | Routing, sign-in/sign-up/reset, upload, save/open/delete |
| `assets/js/data.js` | Parsing numbers and dates (incl. DD/MM/YYYY, ₹1,23,456), profiling, quality score, cleaning |
| `assets/js/semantics.js` | Column meanings, dataset type, formatting (₹ L/Cr, %, units) |
| `assets/js/story.js` | The report engine: breakdowns, trends, movers, drivers, rankings, recommendations |
| `assets/js/charts.js` | Dependency-free charts with tooltips |
| `assets/js/views.js`, `home.js`, `report.js` | Pages and exports |
| `assets/js/backend.js`, `config.js` | Supabase client and settings |
| `assets/vendor/` | PapaParse, Supabase JS, SheetJS (self-hosted; no third-party CDNs) |
| `_headers` | Security headers (CSP, HSTS, no framing) and caching |
| `404.html`, `manifest.webmanifest`, `favicon.svg`, `robots.txt` | Site extras |

### Backend contract (unchanged from the previous version)

- `profiles(id, full_name, team)`
- `analyses(id, user_id, name, dataset_name, rows, cols, quality, storage_path, report jsonb, created_at)`
- A database trigger limits each account to **2** saved analyses. The app shows the same limit via `CONFIG.MAX_SAVED`.
- Cleaned datasets are stored in the private `datasets` bucket under `<user id>/<uuid>.csv`.

Analyses saved by the old version still open. Ones without a stored file show their saved summary.

## Privacy

Files are parsed and analysed entirely in the browser. Nothing leaves the device until the user presses **Save**, and saved data is readable only by its owner (row-level security and per-user storage folders).
