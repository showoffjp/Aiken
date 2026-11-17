# Aiken Web Refresh

Research, audit and redesign concepts for independent, locally owned businesses in and around Aiken, South Carolina.

**Live site:** https://aiken-web-refresh.vercel.app (deploys automatically from `main` via Vercel)

The repo does three things:

1. **Finds the businesses.** Collectors pull public member directories into one de-duplicated list with phone, email, website and category.
2. **Audits their websites.** Each site is fetched and scored on observable signs of age: no mobile layout, no HTTPS, table layouts, dead platforms, stale copyright years, unpatched CMS versions.
3. **Shows a better version.** The most dated sites are rebuilt as working concepts, all hosted from one portfolio index.

## What's in here

| Path | What it is |
| --- | --- |
| `data/prospects.csv` | **The outreach list.** One row per local business: priority, phone, email, website, site status, datedness score, top issues. Opens in Excel or Google Sheets. |
| `data/prospects.json` | The same list, machine-readable. |
| `data/businesses.json` | Every listing found (including chains and institutions, flagged with `segment` and `include`). |
| `data/audit.json` | Raw audit result for every website checked. |
| `data/overrides.json` | Hand corrections: exact business names to force in or out of the list. |
| `src/demos/*.json` | One file per redesign concept: content, colours, fonts, layout style. |
| `src/pages/index.astro` | The portfolio index. |
| `src/pages/[slug].astro` | The concept page template. |
| `src/styles/demo.css` | The design system: one set of sections, five looks (`editorial`, `bold`, `warm`, `clean`, `boutique`). |
| `public/demo-assets/` | Optimised photos and logos for each concept. |
| `public/shots/` | Before / after screenshots used on the index. |
| `scripts/` | The data pipeline (below). |

## What each concept comes with

- **The concept itself** at `/<slug>/`, with a "Concept preview" bar and a "What changed?" panel.
- **A website checkup** at `/<slug>/report/`: the current site next to the concept, what we noticed, and what the concept changes. Written to be sent as a link or printed.
- **A link preview**: pasting either link into an email, text or Facebook message shows a picture of the redesign.
- **A full SEO & social media report** at `/<slug>/seo/`: scorecard, how the site looks in Google and when shared, an 18-point technical SEO checklist, keyword placement, crawl results and broken links, directory listing consistency, social profiles and marketing tags, domain age, a side-by-side table against up to five local competitors, and a prioritized fix list. It has a "Save as PDF" button, and `npm run print` writes it to `outreach/print/seo/`. The checkup page summarizes it and links to it.
- **Motion**: concepts, checkups and reports share a motion layer: an animated gradient in the business's own colours that flows behind the whole page (text colours are checked against it in `src/lib/contrast.ts`), a scroll progress bar in the theme gradient, sections that rise in on scroll, cards with a pointer-following glow and an animated gradient border, a hero photo with a turning gradient ring and glow that tilts toward the pointer, facts that count up, button sheens, gauges that fill and count up, and an aurora behind the dark cinematic sections. The index and 404 pages get the same treatment in the studio colours. The first screen never animates in (so speed scores are unaffected), and everything switches off for visitors who prefer reduced motion and when printed.
- **Cinematic mode** for photo-heavy concepts (`"cinematic": true` in the concept file; on for Verdant Landscape, Scott Webster Photography, Bloom Salon, Prescott & Sons, Veg Out, HBOL Architects, Iron Gate Candles and Carolina HVAC): a full-screen hero that settles as you scroll while the headline rises away, gallery photos pinned as full-screen scenes that slide over one another (the outgoing one shrinks and dims), a mosaic whose columns drift at different speeds, a photo reel tied to scroll, parallax on story photos, film grain and a dark glass header. Scenes use landscape photos at least 1000px wide; set `"cinematic": { "heroImage": "/demo-assets/..." }` to choose the hero photo. Static (and still good-looking) for reduced motion, screenshots and print.
- **A slide-to-compare view** on the checkup page: drag (or use the arrow keys) to wipe between today's site and the concept.
- **A share card**: a 1200x630 before/after image at `/cards/<slug>.jpg`, used as the link preview and copied into the outreach kit for attaching to a Facebook or Instagram message.
- **An outreach draft**: `npm run outreach` writes an email, a text message, a Facebook/Instagram message and a voicemail script for every concept into `./outreach` (kept out of git). Nothing is sent.

## Sales tools

| Command | What it does |
| --- | --- |
| `npm run weigh -- --sites` | Loads every business website as a phone would and records page size and file count in `data/weights.json`. |
| `npm run weigh -- --concepts` | The same for every concept, so checkup pages can compare the two. |
| `npm run a11y -- --sites` | Runs the axe-core accessibility rules (WCAG 2.1 A/AA) on every business home page as a phone sees it, into `data/a11y.json`. Checkup pages show the count next to the concept's. |
| `npm run a11y -- --concepts` | The same for every concept (add `--details` to print each finding). Every concept should come back with zero. |
| `npm run domains` | Looks up every business's web address in the public domain registry (RDAP) and records when it expires, whether it has lapsed, and whether it is on hold, in `data/domains.json`. |
| `npm run recheck` | Before a send: refetches every concept business's current website and writes `outreach/recheck.md`, flagging any site that has come back up, changed platform or been redesigned since the concept was made. |
| `npm run lighthouse -- --sites` | Runs Google Lighthouse (mobile, simulated slow 4G: the same test as PageSpeed Insights) on the current website of every business with a concept, into `data/lighthouse.json`. Add `--all` for every audited site (about 20 seconds each). |
| `npm run lighthouse -- --concepts` | The same for every concept, served from `./dist` with gzip. Checkup pages show both scores as Lighthouse-style gauges, and outreach emails quote the score when the current site is under 50. Add `--missing` to fill gaps only. |
| `npm run seo` | Builds the SEO & social profile for every concept business into `data/seo.json`: crawls up to 15 pages like a search engine, reads robots.txt and the sitemap, checks up to 60 internal links, parses titles, descriptions, headings, structured data and share tags, checks keyword placement for the main service and town, compares the business's directory listings with its site, collects social profiles, and picks up to five local competitors from related directory categories. Add `--fresh` to refetch, `--competitors-only` to refresh competitor rows after new Lighthouse runs. |
| `npm run rankings` | Google, Google Maps and Bing positions for each business's main search and its own name, searched as a phone in Aiken, through the DataForSEO API (licensed search data; scraping search engines directly breaks their terms). Needs `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` or a saved network secret for `api.dataforseo.com`. Search phrases come from directory categories, with overrides in `data/keywords.json`. Add `--dry-run` to list the searches without spending anything. The SEO report shows a "Where you show up in search" table once this has run. |
| `npm run cards` | Draws the before/after share card for every concept into `public/cards/`. |
| `npm run variants` | Makes 640px and 960px copies of concept photos so phones download a file sized for their screen. |
| `npm run print` | Prints every checkup page to a two-sided Letter PDF in `outreach/print/`, with a QR code that opens the concept. For walk-in visits. |
| `npm run outreach` | Email, follow-up email, text, Facebook/Instagram and voicemail drafts per concept in `outreach/`, including a P.S. when a directory lists a different phone number than the business's own site. Also writes `outreach/urgent-calls.md`: businesses whose site is down or whose domain has lapsed, with a call script for each. |

`data/prospects.csv` is sorted by **Rank**, from a 0–100 **Pitch score** that weighs how badly the current site is doing (broken, dated or missing), how heavy it is on a phone, how many serious accessibility problems it has, whether a directory lists the wrong phone number, and whether there is an email address to write to and a concept ready to show. It also flags businesses whose directory phone number differs from their own website (49 of them, 5 that look like typos), domains that have lapsed (no longer registered, or on hold at the registrar) or now show a parking page, and has blank Status / Last contact / Next step / Notes columns for tracking outreach.

**Who looked?** Vercel Web Analytics is enabled on the project. In the Vercel dashboard, open the `aiken-web-refresh` project, then Analytics, and filter by page path to see which concept or checkup pages were opened.

## Sources

- Greater Aiken Chamber of Commerce member directory
- Visit Aiken (city tourism) eat / explore / stay listings
- Aiken Downtown Development Association members
- North Augusta Chamber of Commerce directory (covers North Augusta, Graniteville, Beech Island, Belvedere)

Only information these organisations and the businesses themselves publish is collected.

## Running it

```bash
npm install
npm run dev        # local preview at http://localhost:4321
npm run build      # static site in ./dist
```

Refreshing the data (each step caches its downloads in `.cache/`):

```bash
npm run collect    # pull the four directories
npm run merge      # de-duplicate, filter out chains and institutions
npm run audit      # fetch and score every website
npm run export     # write data/prospects.csv and .json
```

**Fixing the data by hand.** `data/overrides.json` forces businesses in or out of the list by exact name, and its `website` map replaces a directory's link when it points at a dead page but the business's home page still works. Re-run `npm run merge`, then audit just those businesses with `node scripts/audit.mjs <slug> [<slug> ...]` (add `--fresh` to refetch instead of using the cache).

## Adding a concept

```bash
# 1. Crawl the business's current site: text, images, "before" screenshot
node scripts/digest.mjs <prospect-slug>
#    -> .cache/digests/<prospect-slug>/digest.txt   (their words)
#    -> .cache/digests/<prospect-slug>/sheet.jpg    (numbered contact sheet of their photos)

# 2. Publish the photos you want, by contact-sheet number
node scripts/assets.mjs <prospect-slug> <demo-slug> 1=hero 5=shop 17=logo

# 3. Write src/demos/<demo-slug>.json (copy an existing one as a starting point)

# 4. Build, refresh the thumbnails and share card, and check it
npm run variants && npm run build && node scripts/shots.mjs <demo-slug> && npm run cards
npm run a11y -- --concepts <demo-slug> --details && npm run weigh -- --concepts
```

`digest.mjs` and `shots.mjs` need Playwright with Chromium available on the machine.

## Ground rules built into the site

- Every concept carries a visible "Concept preview" bar and a footer note saying it is not the business's official site.
- Every concept is `noindex`, so it can never compete with the real business in search results. The portfolio index is `noindex` too until `indexable` is switched on in `src/lib/site.ts`.
- Copy on a concept comes from the business's own public pages (for a business with no site yet: its directory listings and local press). Nothing is invented: no made-up reviews, prices, awards or hours. Where a site did not say, the concept leaves it out.
- Contact forms on concepts are inert. They collect and send nothing.

## Before sending anything

- Run `npm run recheck` and read `outreach/recheck.md`: a business may have fixed its site since the concept was made.

- Put your studio name and contact details in `src/lib/site.ts`.
- Photos and logos in `public/demo-assets/` belong to the businesses. They are used here only to show each owner a proposal for their own site; get their sign-off before a concept becomes a real site.
- Cold email to businesses is legal in the US under CAN-SPAM if each message is truthful, identifies you, includes a postal address and offers an opt-out.
