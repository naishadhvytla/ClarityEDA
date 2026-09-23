# Hyperframes Composition Brief: Clarity

## Objective
A launch-style product film (with narration) for Clarity. It shows how the web app works on the user's real retail dataset and explains the insights it finds.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape, 1920x1080
- Duration: about 92s. The user asked for 1:30; this overrides brag's 15–25s default, and scene lengths are set by the narration.

## Source Material
- Project root: `/home/user/ClarityEDA` (the app lives in `site/`, live at clarityeda.netlify.app)
- Primary files read: `site/index.html`, `site/assets/css/app.css`, `site/assets/js/{app,home,story,semantics}.js`, `site/favicon.svg`, `README.md`
- Product name: Clarity
- Tagline / strongest claim: "Turn any spreadsheet into a report you can act on"
- Key UI to show:
  - Real 1920×1200 screenshots of the live app running the user's file (`assets/ui/`): landing, home dropzone, Columns, Summary, and the "What to do next" section.
  - A recreation of the real ingest card (`app.js` `ingestScreen`), with its four steps.
- Copy that must appear verbatim:
  - Turn any spreadsheet into a report you can act on
  - Reading the file · Checking data quality · Understanding the columns · Writing your report
  - PDF · HTML · Markdown · Cleaned CSV (the export formats)
- Dataset facts (computed from `retail_sales.csv`, 107,836 rows):
  - Category shares (transactions → revenue): Electronics 3.7% → 49.3%, Home & Kitchen 7.8% → 17.8%, Apparel 14.2% → 15.1%, Grocery 50.2% → 9.2%, Personal Care 24.1% → 8.6%.
  - Monthly revenue (₹ Cr):
    - Total: 8.48, 7.38, 8.07, 7.57, 7.56, 6.93.
    - Electronics: 4.57, 3.90, 4.08, 3.71, 3.42, 2.97.
    - Apparel: 1.00, 0.95, 1.15, 1.17, 1.32, 1.35.
  - Revenue by city (₹ Cr): Vijayawada 10.1, Guntur 9.46, Tirupati 8.36, Rajahmundry 7.01, Nellore 5.57, Kakinada 5.48.
  - Share of transactions by weekday: Mon 11.7, Tue 12.3, Wed 12.0, Thu 12.7, Fri 14.9, Sat 19.2, Sun 17.1.
  - Products: 15 of 25 make 80% of revenue; Headphones is the top product at ₹4.77 Cr.

## Creative Direction
- Tone preset: polished
- Creative direction: a premium product-launch film on real data, calm and confident, like a keynote demo.
- Interpretation:
  - Soft dissolves between scenes, with generous holds and one idea per scene.
  - Visuals complement the narration rather than repeating it.
  - Every on-screen highlight lands on the word that names it, using word timings from `hyperframes transcribe`.
- Angle: the hero is the user's own dataset going through the live app, ending on three findings a manager would act on.
- Hook: "107,836" counting up on a cream canvas while the narrator says "Six months of retail sales…"
- Outro / punchline: the brand mark, "Clarity", the tagline, and the pill "clarityeda.netlify.app".
- Avoid: generic SaaS language, abstract filler, and redesigning the product UI.

## Visual Identity
- Background: #f6f6f3 (page); surfaces #ffffff
- Text: #121417 (ink), #3b3e43 (secondary), #676a70 (muted)
- Accent: #0b7380. Chart teal is #00929e; the brand gradient runs #13909d → #0a5f69.
- Good / bad: #1d7a47 / #b3372a
- Fonts: Inter 400–800 for display and body, self-hosted from @fontsource (latin + latin-ext, which covers ₹)
- Visual references: the browser-framed product shots, the pills and cards of `app.css`, and the brand mark from `favicon.svg`

## Storyboard
Follows `brag-output/brag-plan.md`. Each scene lasts as long as its narration line, plus a 0.4s breath.

1. Hook: counter, subtitle, six city pills, then the question "What's really happening to the business?"
2. Rows, not answers: the real CSV rows drifting past, and the card "Spreadsheets give you rows. Not answers."
3. Reveal: the brand mark and wordmark, then the tagline, then the landing screenshot rising.
4. Upload: the home screenshot, a file chip dropping into the dropzone, and the ingest card with four steps ticking on their spoken words.
5. It understands: the Columns screenshot with row highlights, and a role panel (`transaction_id`→Identifier, `revenue`→Money ₹, `store_city`→Location, `date`→Date).
6. Summary: the Summary screenshot. The camera pushes to the KPI tiles (107,836 · ₹46 Cr), then to the Key takeaways.
7. Insight 1: paired bars for share of transactions vs share of revenue. The headline swaps from Electronics to Grocery.
8. Insight 2: the monthly revenue line draws in, then the Electronics and Apparel lines, then −18% / −20% / +23% cards and a Q1 | Q2 divider.
9. Insight 3: three stat cards (Vijayawada, Saturday, 15 of 25 products), each with a mini chart.
10. Act and share: the real "What to do next" card and the export chips.
11. Outro: brand mark, wordmark, tagline and URL.

## Audio
- Audio role: a warm, low bed under continuous narration.
- Audio arc: the music fades in, sits under the voice, lifts slightly for the outro, then fades out.
- Voice:
  - 11 Kokoro clips (`af_heart`, speed 1.1) in `assets/vo/`, normalized to −16 LUFS.
  - Each clip is timed to its scene.
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (117s).
- Music treatment:
  - A volume lane: 0 → 0.16 over 1.2s, holding at 0.16 under the voice (the source track is about 8 LUFS hotter than the normalized voice).
  - Rises to 0.34 under the outro, then fades to 0 over the final 2.2s.
- Music cue guidance:
  - Use the bundled preset `assets/music/cues/…vol-12….music-cues.json` (about 110 BPM).
  - Lock the logo reveal (scene 3) and the outro logo to the nearest strong cues.
  - Sequential reveals follow the narration's word timings rather than the beat grid, for readability.
- Audio-reactive treatment: subtle. A soft teal ambient glow behind all scenes breathes with music RMS and bass, sampled at 15fps. There are no visualiser graphics.
- SFX (sparse, low-HF-risk picks from `sfx-analysis.md`):
  - A soft tick when the counter settles.
  - `impactSoft_medium_001` on the logo.
  - `drop_002` when the ingest card lands, and `click_002` on each step tick.
  - `rollover2` on the role chips.
  - `card-slide-1` on the stat cards.
  - `click_003` on the export chips.
  - `bong_001` on the outro logo.
  - No SFX under the spoken insight numbers in scenes 6–8.

## Hyperframes Instructions
Built with `hyperframes-core`, `-animation`, `-creative`, `-keyframes` and `-cli` conventions:
- A standalone `index.html` with one paused GSAP timeline registered at `window.__timelines["main"]`.
- GSAP and all fonts, images and audio are local.
- `npx hyperframes check` must pass before render.
