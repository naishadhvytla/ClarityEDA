# Brag Plan: Clarity

## What is this app?
Clarity turns any spreadsheet into a plain-English report: upload a CSV or Excel file and it cleans it, works out what each column means, and writes what's driving the numbers, category by category.

## The angle
A quiet, premium product film that proves the claim on real data. The hero isn't a mock-up: it's the user's own retail dataset (107,836 transactions from six Andhra Pradesh cities, Jan–Jun 2026) going through the live app at clarityeda.netlify.app. It shows what the app found: Electronics is under 4% of transactions but half the revenue, and one category explains the whole revenue drop.

## Hook (first 3 seconds)
A number counting up on a calm cream canvas: **107,836 rows.** Then: "Six months of sales. One question."

## Key moments (the middle)
- The spreadsheet problem: real rows from the file drifting past, "Spreadsheets give you rows. Not answers."
- The ingest moment: the file card and four steps ticking: Reading, Checking quality, Understanding columns, Writing report.
- The Columns page: `transaction_id` → Identifier, `revenue` → Money (₹), `store_city` → Location, `date` → Date.
- The Summary: ₹46 Cr in revenue, 107,836 transactions, and six takeaways in plain English.
- Insight 1: share of transactions vs share of revenue. Electronics is 3.7% of transactions but 49% of revenue; Grocery is 50% of transactions but 9% of revenue.
- Insight 2: revenue −18% from January to June. Electronics is −20% quarter on quarter and alone explains the drop; Apparel is +23%.
- Insight 3: Vijayawada leads (₹10.1 Cr, 22%), Saturdays are busiest (19%), and 15 of 25 products make 80% of revenue.

## Outro / punchline
"Clarity. Turn any spreadsheet into a report you can act on." URL: clarityeda.netlify.app. Music resolves, silence.

## User flow worth showing
Upload file (dashboard dropzone → ingest steps) → Clarity reads the columns (Columns page) → the written Summary and its insights → Report export.

## Tone
- Preset: polished
- Creative direction: premium product-launch film with real data, calm and confident, like a keynote demo
- Interpretation: slow crossfades, generous holds, one idea per scene. The user asked for 90 seconds rather than 15–25, so the scenes breathe with the narration instead of cutting fast.

## Format: landscape — 1920x1080
## Duration: ~90s (user-specified; overrides the 15–25s default)

## Visual identity (from the project)
- Background: #f6f6f3 (page), #ffffff (surfaces)
- Accent: #0b7380 (brand teal); chart teal #00929e; brand gradient #13909d → #0a5f69
- Text: #121417 (ink), #3b3e43 (secondary), #676a70 (muted)
- Good / bad: #1d7a47 / #b3372a
- Display + body font: Inter (600–800 for headlines)
- Strongest visual element: the Summary screen: "This looks like sales data…" with KPI tiles and takeaways

## Voiceover script
(Kokoro, voice af_heart at 1.1× speed, loudness-normalized to −16 LUFS; one clip per scene; scene lengths flex to the audio. Final cut: 92.2s)
1. "Six months of retail sales, from six cities across Andhra Pradesh. A hundred and seven thousand rows, and one question: what is really happening to the business?"
2. "A spreadsheet gives you rows. It doesn't tell you what they mean."
3. "Meet Clarity. Drop in any CSV or Excel file, and it writes you a report you can actually act on."
4. "It runs right in your browser. In a few seconds it reads the file, checks the data quality, and works out what every column means."
5. "It knows a transaction ID is an identifier, not a number to add up. Revenue is money, in rupees. Store city is a location. And the date powers the trends."
6. "Then it writes the summary: a hundred and seven thousand transactions, forty-six crore rupees in revenue, and the takeaways, in plain English."
7. "Here's the first thing it found. Electronics is under four percent of transactions, but almost half of all revenue. Grocery is the opposite: half the transactions, just nine percent of the money."
8. "It also spots what's changing. Revenue slid eighteen percent from January to June, and Clarity traces the drop to one place: Electronics, down twenty percent quarter on quarter. Apparel, meanwhile, is up twenty-three percent."
9. "It breaks down every city, day and product. Vijayawada leads. Saturday is the busiest day. And just fifteen products bring in eighty percent of revenue."
10. "Then it tells you what to do next, and exports the whole report, ready to share."
11. "Clarity. Turn any spreadsheet into a report you can act on."

## Share copy (draft)
Introducing Clarity: drop in a spreadsheet, get a plain-English report you can act on. Here it is reading 107,836 real retail transactions.

## Audio direction
- Role: warm, low bed under continuous narration
- Music: happy-beats-business-moves-vol-12-by-ende-dot-app.mp3 (117s, covers 90s)
- Music treatment: fade in over 1.5s, sit around 0.12 under the voice, rise slightly under the outro, fade out over the last 3s
- Music cue guidance: no bundled preset for vol-12 in the planning window beyond the grid; detect at composition time with `hyperframes beats` if available, and lock only the logo reveal (scene 3) and the final outro to strong beats
- Audio-reactive treatment: subtle; the brand-mark glow breathes with the bed. No visualiser graphics.
- SFX posture: sparse, motion-matched: soft drop when the file card lands, gentle clicks on the ingest ticks and the role chips, one soft impact on the logo reveal
- Audio-coupled moments: ingest step ticks, role chips, insight number count-ups, logo
- Restraint rule: nothing competes with the narration; no SFX under important spoken numbers

## Storyboard

### Scene 1 — Hook — ~12s
Cream canvas. "107,836" counts up in large Inter, with "rows" beside it. Below, it fades in: "Six months of sales · 6 cities · Andhra Pradesh".
Sequential/interaction: count-up, then subtitle
Audio intent: calm curiosity. Audio-coupled idea: counter settles on a soft tick. Music: fade in.
Transition mood: soft → Scene 2

### Scene 2 — Rows, not answers — ~5s
A spreadsheet grid of the real first rows of the CSV (TXN000001…, Vijayawada, Electronics, Smart TV…) drifting upward. Overlay: "Spreadsheets give you rows. Not answers."
Sequential/interaction: rows drift. Audio intent: slight tension. Transition mood: soft → Scene 3

### Scene 3 — Reveal — ~7s
The Clarity brand mark scales in, then the wordmark and the tagline "Turn any spreadsheet into a report you can act on" (verbatim from the site), with the real landing-page screenshot rising in a browser frame.
Audio: soft impact on the logo. Transition mood: clean → Scene 4

### Scene 4 — Upload — ~9s
The real Home screen (dropzone) in a browser frame. A file card "retail_sales.csv · 8.1 MB" drops in, then the four ingest steps tick one by one: Reading the file → Checking data quality → Understanding the columns → Writing your report.
Sequential/interaction: yes, 4 steps. Audio: drop + 4 soft clicks.
Transition mood: clean → Scene 5

### Scene 5 — It understands — ~11s
The real Columns screen, slowly panning. Four role chips arrive on the right: transaction_id → Identifier · revenue → Money (₹) · store_city → Location · date → Date.
Sequential/interaction: yes, chips one by one. Audio: light clicks. Transition mood: soft → Scene 6

### Scene 6 — The summary — ~10s
The real Summary screen in a browser frame, gently pushing in on the KPI row (₹46 Cr).
Transition mood: soft → Scene 7

### Scene 7 — Insight 1: where the money is — ~13s
A custom chart in Clarity's style: two horizontal bars per category, "share of transactions" vs "share of revenue". Electronics 3.7% → 49%, Grocery 50% → 9.2%. Headline: "Electronics: 3.7% of transactions. 49% of revenue."
Sequential/interaction: bars grow. Transition mood: soft → Scene 8

### Scene 8 — Insight 2: what's changing — ~15s
Monthly revenue line (₹8.48 Cr Jan → ₹6.93 Cr Jun) draws in, then the Electronics and Apparel lines. Callouts: "Revenue −18%", "Electronics −20% (−₹2.45 Cr)", "Apparel +23%". The real "What's changing" section appears as the proof card.
Transition mood: soft → Scene 9

### Scene 9 — Insight 3: everywhere else — ~10s
Three stat cards arrive: "Vijayawada leads · ₹10.1 Cr · 22%", "Saturday is busiest · 19% of transactions", "15 of 25 products · 80% of revenue".
Sequential/interaction: yes, 3 cards. Transition mood: soft → Scene 10

### Scene 10 — Act and share — ~6s
The real "What to do next" recommendations card, plus export chips: PDF · HTML · Markdown · Cleaned CSV.
Transition mood: soft → Scene 11

### Scene 11 — Outro — ~5s
Brand mark, "Clarity", tagline, clarityeda.netlify.app. Music resolves, then silence.

**Music mood for this video:** warm, upbeat-corporate, kept low
**Audio summary:** a low warm bed carries a calm narrator through the demo, with tiny motion-matched clicks, then resolves under the logo.

## Privacy note
The capture account's email is masked in the sidebar. No personal data appears; the dataset is aggregate retail data.
