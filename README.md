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
- **An outreach draft**: `npm run outreach` writes an email, a text message and a voicemail script for every concept into `./outreach` (kept out of git). Nothing is sent.

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

## Adding a concept

```bash
# 1. Crawl the business's current site: text, images, "before" screenshot
node scripts/digest.mjs <prospect-slug>
#    -> .cache/digests/<prospect-slug>/digest.txt   (their words)
#    -> .cache/digests/<prospect-slug>/sheet.jpg    (numbered contact sheet of their photos)

# 2. Publish the photos you want, by contact-sheet number
node scripts/assets.mjs <prospect-slug> <demo-slug> 1=hero 5=shop 17=logo

# 3. Write src/demos/<demo-slug>.json (copy an existing one as a starting point)

# 4. Build and refresh the index thumbnail
npm run build && node scripts/shots.mjs <demo-slug> && npm run build
```

`digest.mjs` and `shots.mjs` need Playwright with Chromium available on the machine.

## Ground rules built into the site

- Every concept carries a visible "Concept preview" bar and a footer note saying it is not the business's official site.
- Every concept is `noindex`, so it can never compete with the real business in search results. The portfolio index is `noindex` too until `indexable` is switched on in `src/lib/site.ts`.
- Copy on a concept comes from the business's own public pages. Nothing is invented: no made-up reviews, prices, awards or hours. Where a site did not say, the concept leaves it out.
- Contact forms on concepts are inert. They collect and send nothing.

## Before sending anything

- Put your studio name and contact details in `src/lib/site.ts`.
- Photos and logos in `public/demo-assets/` belong to the businesses. They are used here only to show each owner a proposal for their own site; get their sign-off before a concept becomes a real site.
- Cold email to businesses is legal in the US under CAN-SPAM if each message is truthful, identifies you, includes a postal address and offers an opt-out.
