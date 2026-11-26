# Launching a client's site

A concept becomes the business's own website in about a day. The same codebase builds it: one
setting (`CLIENT`) tells the build which concept to launch, and `scripts/launch.mjs` turns the
output into that business's site alone.

What launch mode changes, compared with the concept page:

- The page lives at the root of the business's own address (`https://theirbusiness.com/`).
- No concept banner, guided tour, "What changed?" notes or "not affiliated" line. The footer credit
  reads "Website by Aiken Web Refresh".
- Search engines may list it: no `noindex`, a canonical address, `robots.txt` and `sitemap.xml` for
  their domain.
- The app icon, home-screen install and offline copy all work from the root.
- The studio's own pages (the portfolio, checkups, SEO reports, the work page) are not built, and other
  concepts' photos are dropped. A typical launched site is about 2 MB.
- The contact form sends real messages once an email service is connected (step 5). Until then the
  form is left out and the page shows the phone, email and address, so no message is ever lost.

## 1. Make their edits

Everything the business sees comes from `src/demos/<slug>.json`: words, hours, menu or services,
photos (put new ones in `public/demo-assets/<slug>/`, then run `npm run variants`), colours and
fonts. Two rounds of edits are included in every package.

## 2. Preview it as the live site

```bash
CLIENT=<slug> CLIENT_URL=https://www.theirbusiness.com npm run build
npx serve dist
```

Send them the preview link once it is deployed (step 3); the private Vercel URL works before their
domain is connected.

## 3. Create their Vercel project

One project per client, all built from this repository:

```bash
vercel project add <client-name> --scope jason-pharr-s-projects
vercel link --yes --project <client-name> --scope jason-pharr-s-projects
vercel git connect https://github.com/showoffjp/Aiken
printf '%s' '<slug>' | vercel env add CLIENT production
printf '%s' 'https://www.theirbusiness.com' | vercel env add CLIENT_URL production
vercel deploy --prod
```

Every push to `main` then rebuilds their site too, which is how care-plan edits go live. To rebuild only
when their files or shared code change, set the project's **Ignored Build Step** (Settings → Git) to:

```bash
git diff --quiet HEAD^ HEAD -- "src/demos/$CLIENT.json" "public/demo-assets/$CLIENT" src/components src/styles src/lib "src/pages/[slug].astro"
```

## 4. Connect their web address

In the client's project: Settings → Domains → add `theirbusiness.com` (and `www`, redirecting to
one of them). At their registrar, keep the email (MX) records and set:

| Type | Host | Value |
| --- | --- | --- |
| A | @ | 76.76.21.21 |
| CNAME | www | cname.vercel-dns.com |

If the address has lapsed, register it in the business's name first.

## 5. Turn on the contact form

The form needs an email service. Vercel's recommended one is Resend (`resend/resend-email` on the
Vercel Marketplace):

1. With the client's project linked, run `vercel integration add resend/resend-email`. If it asks to
   finish in the browser, do that.
2. Verify the sending domain in Resend: it lists the DNS records to add.
3. Build `/api/contact` following the Resend agent skill that the install adds. The form posts JSON
   (`name`, `phone`, `email`, `topic`, `message`, `page`) and expects a 2xx reply. Send only to the
   business's own address, and add a honeypot field and a rate limit.
4. `printf '%s' '/api/contact' | vercel env add CLIENT_FORM_ENDPOINT production`, then redeploy.

If a message fails to send, the visitor sees the phone number and email instead.

## 6. After it is live

- Google Search Console: add the domain and submit `https://theirbusiness.com/sitemap.xml`.
- Google Business Profile, Chamber and Visit Aiken listings: point their website link at the new site.
- Old pages (`/menu.html` and so on) land on a 404 page with a link home. Add redirects for any that
  matter.
- Vercel: turn on Web Analytics for the project (the page already loads its script).
- The contacts sheet: set their Status to Won.

## Billing

Client sites are commercial, so the Vercel team needs the Pro plan before the first one goes live.
