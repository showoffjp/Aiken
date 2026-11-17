// SEO and social media profile for every business with a concept, plus a list
// of local competitors to compare against. Everything here is measured from
// public pages: the business's own site (crawled like a search engine would),
// its robots.txt and sitemap, the local directories it is listed in, and the
// social profiles it links to. Search positions come separately from
// scripts/rankings.mjs, which needs a SERP data provider.
//   node scripts/seo.mjs [slug ...] [--fresh]
//   node scripts/seo.mjs --competitors-only      refresh competitor rows only
// Output: data/seo.json  { "<prospect slug>": { site, onpage, crawl, links, keywords, citations, social, competitors, scores } }
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, fetchUrl, pool, stripTags } from './lib/http.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (f, d = {}) => JSON.parse(await readFile(path.join(ROOT, f), 'utf8').catch(() => JSON.stringify(d)));
const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const only = args.filter((a) => !a.startsWith('--'));

const businesses = await load('data/businesses.json', []);
const prospects = await load('data/prospects.json', []);
const audit = await load('data/audit.json');
const domains = await load('data/domains.json');
const lighthouse = await load('data/lighthouse.json');
const weights = await load('data/weights.json');
const a11y = await load('data/a11y.json');
const out = await load('data/seo.json');
const sources = Object.fromEntries(await Promise.all(['chamber', 'visitaiken', 'adda', 'northaugusta'].map(async (s) => [s, await load(`data/sources/${s}.json`, [])])));
const SOURCE_NAME = { chamber: 'Aiken Chamber of Commerce', visitaiken: 'Visit Aiken (city tourism)', adda: 'Aiken Downtown Development', northaugusta: 'North Augusta Chamber' };

const demos = [];
for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json'))) demos.push(JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8')));

const byslug = new Map(businesses.map((b) => [b.slug, b]));
const prow = new Map(prospects.map((r) => [r.slug, r]));
const digits = (s = '') => String(s).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').slice(-10);
const hostOf = (u = '') => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const nameKey = (n = '') => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’`.]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|llc|inc|co|company|corp|ltd|pa|pc|of aiken|aiken)\b/g, ' ').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------ parsing ----
const attr = (tag, name) => decode((tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')) || [])[2] ?? (tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i')) || [])[1] ?? '');
function metaContent(html, key) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    if ((attr(t, 'name') || attr(t, 'property')).toLowerCase() === key) return attr(t, 'content').trim();
  }
  return '';
}
const SOCIAL = [
  ['Facebook', /facebook\.com\/(?!sharer|share\.php|plugins|tr\?|dialog)/i],
  ['Instagram', /instagram\.com\/(?!p\/|explore)/i],
  ['YouTube', /youtube\.com\/(channel|c\/|user|@)|youtu\.be\//i],
  ['TikTok', /tiktok\.com\/@/i],
  ['LinkedIn', /linkedin\.com\/(company|in)\//i],
  ['X (Twitter)', /(twitter|x)\.com\/(?!share|intent|home)[a-z0-9_]+/i],
  ['Pinterest', /pinterest\.com\/(?!pin\/create)/i],
  ['Yelp', /yelp\.com\/biz\//i],
  ['Nextdoor', /nextdoor\.com\/(pages|page)\//i],
  ['Google Business Profile', /g\.page\/|business\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps|google\.com\/maps\/place|search\.google\.com\/local\/writereview/i],
  ['TripAdvisor', /tripadvisor\.com\//i],
];
function parsePage(html, url) {
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [''])[0];
  const bodyHtml = html.replace(/<head[\s\S]*?<\/head>/i, ' ');
  const text = stripTags(bodyHtml.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, ' '));
  const title = stripTags((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const h = (n) => [...bodyHtml.matchAll(new RegExp(`<h${n}\\b[^>]*>([\\s\\S]*?)<\\/h${n}>`, 'gi'))].map((m) => stripTags(m[1])).filter(Boolean);
  const imgs = [...bodyHtml.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const links = [...bodyHtml.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>/gi)].map((m) => decode(m[1]));
  const ld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => { try { return JSON.parse(m[1].trim()); } catch { return null; } }).filter(Boolean);
  const types = new Set();
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { const t = o['@type']; (Array.isArray(t) ? t : t ? [t] : []).forEach((x) => types.add(String(x))); Object.values(o).forEach(walk); } };
  walk(ld);
  const ldText = JSON.stringify(ld);
  const robotsMeta = metaContent(head, 'robots');
  const canon = (head.match(/<link\b[^>]*rel=["']?canonical["']?[^>]*>/i) || [''])[0];
  return {
    url, title, description: metaContent(head, 'description'),
    canonical: canon ? attr(canon, 'href') : '',
    noindex: /noindex/i.test(robotsMeta),
    lang: attr((html.match(/<html\b[^>]*>/i) || [''])[0], 'lang'),
    viewport: /<meta[^>]+name=["']viewport["']/i.test(head),
    favicon: /<link[^>]+rel=["'][^"']*icon/i.test(head),
    og: { title: metaContent(head, 'og:title'), description: metaContent(head, 'og:description'), image: metaContent(head, 'og:image'), type: metaContent(head, 'og:type') },
    twitterCard: metaContent(head, 'twitter:card'),
    h1: h(1), h2: h(2).length, h3: h(3).length,
    words: text ? text.split(/\s+/).length : 0,
    firstWords: text.split(/\s+/).slice(0, 150).join(' '),
    text,
    images: imgs.length, imagesNoAlt: imgs.filter((t) => !/\balt\s*=\s*["'][^"']+["']/i.test(t)).length,
    links,
    schemaTypes: [...types],
    schemaLocal: [...types].some((t) => /LocalBusiness|Restaurant|Store|Service|Contractor|Plumber|Electrician|HVAC|Dentist|Attorney|LegalService|Salon|Spa|Shop|Organization|Bakery|Cafe|BarOrPub|Florist|AutoRepair|HomeAndConstructionBusiness|ProfessionalService|LodgingBusiness|FoodEstablishment|HealthAndBeautyBusiness/i.test(t)),
    schemaHas: { address: /"address"/.test(ldText), telephone: /"telephone"/.test(ldText), hours: /"openingHours(Specification)?"/.test(ldText), geo: /"geo"/.test(ldText), rating: /"aggregateRating"/.test(ldText) },
    microdata: /itemtype=["'][^"']*schema\.org/i.test(html),
    tel: /href=["']tel:/i.test(bodyHtml),
    mapEmbed: /google\.com\/maps\/embed|maps\.google\.com\/maps\?|google\.com\/maps\?q=/i.test(html),
    tags: {
      'Google Analytics': /gtag\(|googletagmanager\.com\/gtag|google-analytics\.com\/(analytics|ga)\.js/i.test(html),
      'Google Tag Manager': /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i.test(html),
      'Meta Pixel': /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(/i.test(html),
    },
  };
}

// --------------------------------------------------------- per business ----
async function siteReport(b, a) {
  const start = a.finalUrl || a.url || b.website;
  const host = hostOf(start);
  const origin = new URL(start).origin;
  const get = (u, o = {}) => fetchUrl(u, { bucket: 'seo', timeout: 25, refresh: fresh, ...o });

  // robots.txt and sitemap
  const robots = await get(`${origin}/robots.txt`, { maxBytes: 300_000 });
  const robotsOk = robots.ok && /user-agent|sitemap|disallow|allow/i.test(robots.body) && !/<html/i.test(robots.body);
  const robotsBlocksAll = robotsOk && /user-agent:\s*\*[\s\S]*?^disallow:\s*\/\s*$/im.test(robots.body);
  const smFromRobots = robotsOk ? [...robots.body.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
  const smCandidates = [...new Set([...smFromRobots, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`])];
  let sitemap = null;
  for (const u of smCandidates) {
    const r = await get(u, { maxBytes: 3_000_000 });
    if (!r.ok || !/<(urlset|sitemapindex)/i.test(r.body)) continue;
    let urls = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
    if (/<sitemapindex/i.test(r.body)) {
      const children = urls.slice(0, 12);
      urls = [];
      for (const c of children) { const cr = await get(c, { maxBytes: 3_000_000 }); urls.push(...[...cr.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]))); }
    }
    sitemap = { url: u, pages: urls.filter((x) => !/\.(jpe?g|png|webp|gif|pdf)$/i.test(x)).length };
    break;
  }

  // Crawl: breadth-first from the home page, same host, up to 15 HTML pages.
  const norm = (u) => { try { const x = new URL(u); x.hash = ''; if (x.pathname !== '/' ) x.pathname = x.pathname.replace(/\/$/, ''); return x.href; } catch { return ''; } };
  const queue = [norm(start)], seen = new Set(queue), pages = [], linkTargets = new Map();
  while (queue.length && pages.length < 15) {
    const u = queue.shift();
    const r = await get(u);
    if (!r.ok || !/html/i.test(r.contentType || 'text/html')) { pages.push({ url: u, status: r.status, error: r.error || `HTTP ${r.status}` }); continue; }
    const p = parsePage(r.body, r.finalUrl);
    p.status = r.status;
    pages.push(p);
    for (const l of p.links) {
      let abs; try { abs = new URL(l, r.finalUrl); } catch { continue; }
      if (!/^https?:$/.test(abs.protocol)) continue;
      const n = norm(abs.href);
      if (hostOf(n) !== host) continue;
      if (!linkTargets.has(n)) linkTargets.set(n, u);
      if (!seen.has(n) && !/\.(jpe?g|png|webp|gif|pdf|docx?|xlsx?|zip|mp4|mp3|svg)$/i.test(abs.pathname) && !/\/(wp-admin|wp-login|cart|checkout|my-account|feed)\b/i.test(abs.pathname)) { seen.add(n); queue.push(n); }
    }
  }
  const home = pages.find((p) => !p.error) || null;
  if (!home) return { error: 'home page could not be read' };

  // Broken internal links: every link target found, up to 60, crawled pages included.
  const crawled = new Map(pages.map((p) => [norm(p.url), p.status || 0]));
  const toCheck = [...linkTargets.keys()].filter((u) => !crawled.has(u)).slice(0, 45);
  const checked = await pool(toCheck, 6, async (u) => { const r = await get(u, { maxBytes: 200_000, timeout: 20 }); return { url: u, status: r.status, error: r.status ? '' : r.error }; });
  const broken = [
    ...pages.filter((p) => p.error).map((p) => ({ url: p.url, status: p.status, from: linkTargets.get(p.url) || '' })),
    ...checked.filter((c) => c.status >= 400 || (!c.status && !/Maximum file size/i.test(c.error))).map((c) => ({ url: c.url, status: c.status || 0, from: linkTargets.get(c.url) || '' })),
  ].filter((x) => x.status !== 403 && x.status !== 429);

  const ok = pages.filter((p) => !p.error);
  const titles = ok.map((p) => p.title.toLowerCase()).filter(Boolean);
  const dupTitles = titles.length - new Set(titles).size;
  const descs = ok.map((p) => p.description.toLowerCase()).filter(Boolean);
  const dupDescs = descs.length - new Set(descs).size;

  // Social profiles linked from anywhere crawled.
  const social = {};
  for (const p of ok) for (const l of p.links) for (const [name, re] of SOCIAL) if (re.test(l) && !social[name]) social[name] = l.split('?')[0];

  return {
    host, https: start.startsWith('https://'), pagesCrawled: ok.length,
    home: {
      url: home.url, title: home.title, description: home.description, canonical: home.canonical, noindex: home.noindex, lang: home.lang,
      viewport: home.viewport, favicon: home.favicon, og: home.og, twitterCard: home.twitterCard, h1: home.h1.slice(0, 3), h1Count: home.h1.length,
      h2: home.h2, h3: home.h3, words: home.words, images: home.images, imagesNoAlt: home.imagesNoAlt,
      schemaTypes: home.schemaTypes, schemaLocal: home.schemaLocal, schemaHas: home.schemaHas, microdata: home.microdata,
      tel: home.tel, mapEmbed: home.mapEmbed, tags: home.tags, firstWords: home.firstWords, text: home.text.slice(0, 20000),
    },
    robots: { found: robotsOk, blocksAll: robotsBlocksAll, sitemaps: smFromRobots.length },
    sitemap,
    crawl: {
      pages: ok.length,
      missingTitle: ok.filter((p) => !p.title).length,
      missingDescription: ok.filter((p) => !p.description).length,
      missingH1: ok.filter((p) => !p.h1.length).length,
      multipleH1: ok.filter((p) => p.h1.length > 1).length,
      thin: ok.filter((p) => p.words < 250).length,
      noindex: ok.filter((p) => p.noindex).length,
      dupTitles, dupDescs,
      imagesNoAlt: ok.reduce((n, p) => n + p.imagesNoAlt, 0), images: ok.reduce((n, p) => n + p.images, 0),
      sample: ok.slice(0, 15).map((p) => ({ url: p.url, title: p.title, description: p.description ? p.description.length : 0, h1: p.h1.length, words: p.words })),
    },
    links: { internalChecked: toCheck.length + pages.length, broken: broken.slice(0, 25), brokenCount: broken.length },
    social,
  };
}

// Directory listings: the same business as each directory shows it.
function citations(b, sitePhones, siteHost) {
  const urls = new Set(b.sourceUrls || []);
  const nk = nameKey(b.name);
  const rows = [];
  for (const [src, list] of Object.entries(sources)) {
    const arr = Array.isArray(list) ? list : Object.values(list);
    const hit = arr.find((e) => (e.detailUrl && urls.has(e.detailUrl)) || (e.page && urls.has(e.page))) || arr.find((e) => nameKey(e.name || '') === nk);
    if (!hit) continue;
    const phone = digits(hit.phone || '');
    const web = hostOf(hit.website || '');
    rows.push({
      source: SOURCE_NAME[src] || src, url: hit.detailUrl || hit.page || '', name: hit.name || '', phone: hit.phone || '', website: hit.website || '', address: hit.address || '',
      phoneMatch: !phone ? null : sitePhones.length ? sitePhones.includes(phone) : null,
      websiteMatch: !siteHost ? null : !web ? false : web === siteHost || web.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${web}`),
    });
  }
  return rows;
}

// Local competitors: other listed businesses in the same directory category.
const included = businesses.filter((x) => x.include);
function competitorsFor(b, d) {
  const cats = new Set((b.categories || []).map((c) => c.toLowerCase()).filter((c) => !/^(do |eat |shop |stay )|downtown aiken|attraction|individual members|associate/.test(c)));
  const scored = included
    .filter((x) => x.slug !== b.slug && x.website && audit[x.slug])
    .map((x) => ({ x, shared: (x.categories || []).filter((c) => cats.has(c.toLowerCase())).length }))
    .filter((s) => s.shared > 0)
    .sort((p, q) => q.shared - p.shared || Number(audit[q.x.slug]?.state === 'ok') - Number(audit[p.x.slug]?.state === 'ok') || p.x.name.localeCompare(q.x.name));
  const picked = scored.slice(0, 5).map(({ x }) => x.slug);
  if (picked.length >= 3) return picked;
  // Fallback: related trades, since directory category labels rarely match
  // exactly (a granite shop competes with flooring and remodeling firms).
  const GROUPS = [
    /granite|marble|countertop|cabinet|\btile|flooring|kitchen|interior design/,
    /dry clean|laundr|\btailors?\b|tailoring|alteration/,
    /fabric|quilt|sewing|yarn|craft supply|art supply/,
    /pet sitt|dog walk|pet groom|kennel|boarding|pet care|doggy/,
    /hvac|heating|air condition|electric|plumb|generator/,
    /\btree|arbor|landscaping|landscaper|landscape design|lawn|hardscap|irrigation/,
    /restaurant|bar-b|bbq|barbecue|grill|cafe|bakery|diner|taqueria|pizza|eatery|seafood|breakfast/,
    /\btour|historic|museum/,
    /salon|\bspa\b|massage|beauty|hair|nail|barber/,
    /natural health|vitamin|supplement|wellness|herbal|nutrition/,
    /photograph/, /jewel/, /candle|gift shop|boutique|antique|home decor/, /insurance/, /attorney|law firm|legal/,
    /construction|builder|contractor|roofing|grading|paving|excavat/, /printing|signs?\b|trophies|engrav/, /auto|mechanic|tire|collision|body shop/,
    /architect/, /accountant|cpa|bookkeep|tax prep/, /real estate/, /fitness|gym|yoga|pilates/, /veterinar/,
  ];
  // Visit Aiken tags ("do lodging restaurant spa") describe a listing page, not the business.
  const cleanCats = (x) => (x.categories || []).filter((c) => !/^(do|eat|shop|stay) |attraction \/ shopping|downtown aiken/i.test(c));
  const text = (x, extraText = '') => `${cleanCats(x).join(' ')} ${x.name} ${extraText}`.toLowerCase();
  const mine = GROUPS.filter((g) => g.test(text(b, d.category)));
  const extra = included
    .filter((x) => x.slug !== b.slug && x.website && audit[x.slug] && !picked.includes(x.slug))
    .map((x) => ({ x, hits: mine.filter((g) => g.test(text(x))).length }))
    .filter((s) => s.hits > 0)
    .sort((p, q) => q.hits - p.hits || Number(audit[q.x.slug]?.state === 'ok') - Number(audit[p.x.slug]?.state === 'ok') || p.x.name.localeCompare(q.x.name));
  return [...picked, ...extra.map(({ x }) => x.slug)].slice(0, 5);
}
function competitorRow(slug) {
  const x = byslug.get(slug), a = audit[slug] || {}, r = prow.get(slug) || {};
  const lh = lighthouse[slug]?.site;
  const f = a.findings || [];
  return {
    slug, name: x.name, website: a.finalUrl || x.website, state: a.state || 'unknown',
    https: a.https ?? null, mobile: a.viewport ?? null,
    description: a.state === 'ok' ? !f.some((y) => /meta description/i.test(y)) : null,
    schema: a.state === 'ok' ? !f.some((y) => /structured data/i.test(y)) : null,
    og: a.state === 'ok' ? !f.some((y) => /Open Graph/i.test(y)) : null,
    performance: lh && !lh.error ? lh.performance : null,
    pageMB: weights[slug]?.site?.bytes ? +(weights[slug].site.bytes / 1048576).toFixed(1) : null,
    a11ySerious: a11y[slug]?.site && !a11y[slug].site.error ? a11y[slug].site.critical + a11y[slug].site.serious : null,
    facebook: !!(a.facebook || r.facebook), instagram: !!(a.instagram || r.instagram),
    domainYears: domains[slug]?.created ? Math.floor((Date.now() - Date.parse(domains[slug].created)) / 3.156e10) : null,
  };
}

// Keyword placement: the main service and the town, where a searcher would look.
function keywordCheck(d, home) {
  const town = (d.town || '').split(',')[0].trim();
  const service = (d.category || '').split(/,|&| and |·/)[0].replace(/\b(the|our)\b/gi, '').trim();
  const terms = [service, town].filter(Boolean);
  const has = (s = '', t) => s.toLowerCase().includes(t.toLowerCase().replace(/s$/, ''));
  return terms.map((t) => ({
    term: t,
    title: has(home.title, t), h1: home.h1.some((h) => has(h, t)), description: has(home.description, t), firstWords: has(home.firstWords, t),
    count: (home.text.toLowerCase().match(new RegExp(t.toLowerCase().replace(/s$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length,
  }));
}

// Scores out of 100, from the checks that matter most for a local business.
function seoScore(s, kw, cites) {
  if (!s || s.error) return null;
  const h = s.home;
  const checks = [
    [8, s.https], [8, h.viewport], [8, !!h.title && h.title.length >= 20 && h.title.length <= 65], [7, !!h.description && h.description.length >= 70 && h.description.length <= 170],
    [6, h.h1Count === 1], [5, !!h.canonical], [6, !h.noindex && !s.robots.blocksAll], [4, s.robots.found], [6, !!s.sitemap],
    [8, h.schemaLocal], [5, !!(h.og.title && h.og.image)], [3, h.favicon], [2, !!h.lang],
    [6, h.images === 0 || h.imagesNoAlt / h.images <= 0.1], [6, s.links.brokenCount === 0], [4, s.crawl.missingDescription === 0], [3, s.crawl.dupTitles === 0],
    [5, kw.every((k) => k.title || k.h1)], [5, cites.every((c) => c.phoneMatch !== false && c.websiteMatch !== false)],
  ];
  const total = checks.reduce((n, [w]) => n + w, 0);
  return Math.round((checks.reduce((n, [w, ok]) => n + (ok ? w : 0), 0) / total) * 100);
}
function socialScore(social, dirSocial, og) {
  const platforms = new Set([...Object.keys(social), ...Object.keys(dirSocial)]);
  let s = 0;
  if (platforms.has('Facebook')) s += 25;
  if (platforms.has('Instagram')) s += 20;
  if (platforms.has('Google Business Profile')) s += 15;
  if ([...platforms].some((p) => /YouTube|TikTok|LinkedIn|Pinterest|X \(/.test(p))) s += 10;
  if ([...platforms].some((p) => /Yelp|Nextdoor|TripAdvisor/.test(p))) s += 5;
  if (Object.keys(social).length) s += 10; // the website points people to the profiles
  if (og && og.title && og.image) s += 15; // links shared on social show a proper preview
  return Math.min(100, s);
}

// ------------------------------------------------------------------ run ----
// --competitors-only: just refresh the competitor rows (after new Lighthouse runs).
const targets = args.includes('--competitors-only') ? [] : demos.filter((d) => !only.length || only.includes(d.slug) || only.includes(d.prospect));
console.log(`seo: profiling ${targets.length} businesses`);
const allCompetitors = new Set();
await pool(targets, 3, async (d) => {
  const key = d.prospect || d.slug;
  const b = byslug.get(key);
  if (!b) return;
  const a = audit[key] || {};
  const row = prow.get(key) || {};
  let site = null;
  if (!d.source.none && a.state === 'ok') {
    try { site = await siteReport(b, a); } catch (e) { site = { error: String(e.message || e).slice(0, 120) }; }
  }
  const sitePhones = [...new Set([...(a.phones || []), d.contact?.phone].filter(Boolean).map(digits))];
  const siteHost = site && !site.error ? site.host : hostOf(a.finalUrl || b.website || '');
  const cites = citations(b, sitePhones, d.source.none ? '' : siteHost);
  const dirSocial = {};
  if (row.facebook || a.facebook || d.contact?.facebook) dirSocial.Facebook = row.facebook || a.facebook || d.contact.facebook;
  if (row.instagram || a.instagram || d.contact?.instagram) dirSocial.Instagram = row.instagram || a.instagram || d.contact.instagram;
  const kw = site && !site.error ? keywordCheck(d, site.home) : [];
  const comps = competitorsFor(b, d);
  comps.forEach((c) => allCompetitors.add(c));
  const dom = domains[key];
  out[key] = {
    slug: d.slug, name: d.name, checked: new Date().toISOString().slice(0, 10),
    hasSite: !!site && !site.error, siteState: row.siteState || (d.source.none ? 'No website' : ''),
    site: site && !site.error ? { ...site, home: { ...site.home, text: undefined, firstWords: undefined } } : site,
    keywords: kw,
    citations: cites,
    social: { onSite: site?.social || {}, listed: dirSocial },
    domain: dom && !dom.error ? { name: dom.domain, created: dom.created, expires: dom.expires, registrar: dom.registrar, years: dom.created ? Math.floor((Date.now() - Date.parse(dom.created)) / 3.156e10) : null } : null,
    performance: lighthouse[key]?.site && !lighthouse[key].site.error ? lighthouse[key].site : null,
    conceptPerformance: lighthouse[key]?.concept && !lighthouse[key].concept.error ? lighthouse[key].concept : null,
    competitorSlugs: comps,
    scores: {
      seo: seoScore(site && !site.error ? site : null, kw, cites),
      social: socialScore(site?.social || {}, dirSocial, site?.home?.og),
      lighthouseSeo: lighthouse[key]?.site?.seo ?? null,
    },
  };
  console.log(`  ${d.slug}: ${site?.error ? `site error: ${site.error}` : site ? `${site.pagesCrawled} pages, ${site.links.brokenCount} broken links, SEO ${out[key].scores.seo}` : 'no site'}, social ${out[key].scores.social}, ${cites.length} listings, ${comps.length} competitors`);
});
// Competitor rows are filled in last so they pick up any new Lighthouse runs.
for (const key of Object.keys(out)) out[key].competitors = (out[key].competitorSlugs || []).map(competitorRow);
await writeFile(path.join(ROOT, 'data', 'seo.json'), JSON.stringify(out, null, 1));
for (const r of Object.values(out)) (r.competitorSlugs || []).forEach((c) => allCompetitors.add(c));
await writeFile(path.join(ROOT, '.cache', 'competitors.txt'), [...allCompetitors].join('\n'));
const rows = Object.values(out).filter((r) => r.scores?.seo != null);
console.log(`seo: ${Object.keys(out).length} profiles; median SEO score ${rows.map((r) => r.scores.seo).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? '-'}; ${allCompetitors.size} competitor sites (list in .cache/competitors.txt)`);
