// Join the master list with the website audit and write the outreach list:
//   data/prospects.json  (everything, machine-readable)
//   data/prospects.csv   (opens in Excel / Google Sheets)
import { readFile, writeFile, readdir } from 'node:fs/promises';

const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const businesses = await read('../data/businesses.json');
const audit = await read('../data/audit.json').catch(() => ({}));
const demoSlugs = new Map();
for (const f of await readdir(new URL('../src/demos/', import.meta.url)).catch(() => [])) {
  if (!f.endsWith('.json')) continue;
  const d = await read(`../src/demos/${f}`);
  demoSlugs.set(d.prospect || d.slug, d.slug);
}

const siteTs = await readFile(new URL('../src/lib/site.ts', import.meta.url), 'utf8');
const liveUrl = ((siteTs.match(/url:\s*'([^']*)'/) || [])[1] || '').replace(/\/$/, '');

const TIERS = {
  rebuild: 'A · Rebuild candidate',
  broken: 'A · Site down or broken',
  dated: 'B · Dated',
  none: 'B · No website (social only)',
  nosite: 'B · No web presence found',
  modern: 'C · Modern site',
  blocked: 'C · Could not audit (bot-protected)',
};

// Plain-English site status for the spreadsheet.
const STATUS = {
  ok: 'Online',
  blocked: 'Online, bot-protected (not audited)',
  'no-dns': 'Domain does not resolve (likely expired) - verify',
  'cert-error': 'Security certificate invalid or expired',
  down: 'No response - verify',
  broken: 'Error page (404 / 500)',
  parked: 'Parked domain',
  placeholder: 'Placeholder or error page',
  empty: 'Empty page',
  'redirects-to-social': 'Redirects to a social page',
};

// Toll-free numbers on a site are usually an ordering platform or head office,
// not the shop's own line, so they are ignored when comparing.
const digitsOf = (p = '') => p.replace(/\D/g, '');
const tollFree = (p) => /^(800|833|844|855|866|877|888)/.test(digitsOf(p));
const localSitePhones = (a) => (a?.state === 'ok' ? (a.phones || []).filter((p) => !tollFree(p)) : []);
function phoneMismatch(b, a) {
  const site = localSitePhones(a);
  return !!(b.phone && site.length && !site.includes(b.phone));
}
// One or two digits apart from a number on the site: very likely a typo in the listing.
function phoneTypo(b, a) {
  if (!phoneMismatch(b, a)) return false;
  const d = digitsOf(b.phone);
  return localSitePhones(a).some((p) => {
    const e = digitsOf(p);
    return e.length === d.length && [...e].filter((c, i) => c !== d[i]).length <= 2;
  });
}

const weights = JSON.parse(await readFile(new URL('../data/weights.json', import.meta.url), 'utf8').catch(() => '{}'));
const a11y = JSON.parse(await readFile(new URL('../data/a11y.json', import.meta.url), 'utf8').catch(() => '{}'));
const domains = JSON.parse(await readFile(new URL('../data/domains.json', import.meta.url), 'utf8').catch(() => '{}'));
const lighthouse = JSON.parse(await readFile(new URL('../data/lighthouse.json', import.meta.url), 'utf8').catch(() => '{}'));
const seoData = JSON.parse(await readFile(new URL('../data/seo.json', import.meta.url), 'utf8').catch(() => '{}'));
const rankData = JSON.parse(await readFile(new URL('../data/rankings.json', import.meta.url), 'utf8').catch(() => '{}'));
const svcRank = (slug) => rankData[slug]?.keywords?.find((k) => k.kind === 'service');
const nameRank = (slug) => rankData[slug]?.keywords?.find((k) => k.kind === 'name');

// What the registry says about the business's web address, in plain words.
function domainState(d) {
  if (!d || d.error) return '';
  if (d.registered === false) return 'Lapsed: the address is no longer registered and anyone can buy it';
  if (d.hold?.length) return `On hold at the registrar (${d.hold.join(', ')}): about to be released`;
  if (d.daysLeft !== null && d.daysLeft < 0) return `Past its expiry date (${d.expires}): renewal pending`;
  if (d.daysLeft !== null && d.daysLeft <= 60) return `Renews or expires ${d.expires}`;
  return '';
}

// How strong a pitch each business is, 0-100: how much the site needs help,
// how reachable the owner is, and whether a concept is already built.
function pitchScore(r) {
  let s = { broken: 40, rebuild: 32, none: 28, dated: 22, nosite: 16, blocked: 4, modern: 0 }[r.tier] || 0;
  if (r.pageMB >= 10) s += 16; else if (r.pageMB >= 5) s += 10; else if (r.pageMB >= 3) s += 5;
  if (r.a11ySerious >= 20) s += 10; else if (r.a11ySerious >= 5) s += 5;
  if (r.lhPerformance !== null && r.lhPerformance < 30) s += 6; else if (r.lhPerformance !== null && r.lhPerformance < 50) s += 3;
  if (/typo/.test(r.phoneNote)) s += 8; else if (r.listedPhone) s += 3;
  if (r.mobileReady === false) s += 8;
  if (r.https === false) s += 6;
  if (r.email) s += 8; else if (r.phone) s += 4;
  if (r.demo) s += 14;
  // A lapsed or held domain is the most time-sensitive call on the list.
  if (/^Lapsed|^On hold/.test(r.domainState)) s += 12;
  else if (/^Renews or expires/.test(r.domainState) && ['broken', 'rebuild'].includes(r.tier)) s += 4;
  return Math.min(100, s);
}

const rows = businesses.filter((b) => b.include).map((b) => {
  const a = audit[b.slug];
  let tier;
  if (!b.website) tier = b.social ? 'none' : 'nosite';
  else if (!a) tier = 'blocked';
  else if (['down', 'no-dns', 'cert-error', 'broken', 'parked', 'placeholder', 'empty', 'redirects-to-social'].includes(a.state)) tier = 'broken';
  else if (a.state === 'blocked') tier = 'blocked';
  else if (a.score >= 30) tier = 'rebuild';
  else if (a.score >= 15) tier = 'dated';
  else tier = 'modern';

  // Put a person's or the office's address ahead of webmaster-style ones.
  const technical = (e) => /^(webmaster|techsupport|support|noreply|no-reply|admin|postmaster|hostmaster)@/i.test(e);
  const emails = [...new Set([b.email, ...(a?.emails || [])].filter(Boolean))].sort((x, y) => Number(technical(x)) - Number(technical(y)));
  return {
    slug: b.slug,
    name: b.name,
    priority: TIERS[tier],
    tier,
    town: b.city || 'Aiken area',
    category: b.categories.filter((c) => c !== 'Downtown Aiken')[0] || b.categories[0] || '',
    // The business's own website is the better source for its phone number.
    // When a directory lists a number the site never shows, keep both and flag it.
    phone: (phoneMismatch(b, a) ? localSitePhones(a)[0] : b.phone) || localSitePhones(a)[0] || '',
    listedPhone: phoneMismatch(b, a) ? b.phone : '',
    phoneNote: phoneTypo(b, a) ? 'Directory listing looks like a typo of the number on the website' : phoneMismatch(b, a) ? 'Directory listing differs from the website: verify' : '',
    email: emails[0] || '',
    otherEmails: emails.slice(1),
    website: b.website,
    siteState: !b.website ? 'No website' : STATUS[a?.state] || 'Not audited',
    score: a?.score ?? null,
    platform: a?.platform || '',
    issues: a?.findings?.slice(0, 5) || (a?.error ? [a.error] : []),
    https: a?.https ?? null,
    mobileReady: a?.viewport ?? null,
    copyrightYear: a?.copyrightYear || null,
    facebook: a?.facebook || b.social || '',
    instagram: a?.instagram || '',
    address: b.address,
    contact: b.contact,
    familyNote: a?.familySignal || '',
    since: a?.since || null,
    blurb: b.blurb,
    sources: b.sources,
    demo: demoSlugs.get(b.slug) || '',
    pageMB: weights[b.slug]?.site?.bytes ? +(weights[b.slug].site.bytes / 1048576).toFixed(1) : null,
    a11yIssues: a11y[b.slug]?.site && !a11y[b.slug].site.error ? a11y[b.slug].site.issues : null,
    a11ySerious: a11y[b.slug]?.site && !a11y[b.slug].site.error ? a11y[b.slug].site.critical + a11y[b.slug].site.serious : null,
    lhPerformance: lighthouse[b.slug]?.site && !lighthouse[b.slug].site.error ? lighthouse[b.slug].site.performance : null,
    lhAccessibility: lighthouse[b.slug]?.site && !lighthouse[b.slug].site.error ? lighthouse[b.slug].site.accessibility : null,
    seoHealth: seoData[b.slug]?.scores?.seo ?? null,
    socialPresence: seoData[b.slug]?.scores?.social ?? null,
    domain: domains[b.slug]?.domain || '',
    domainExpires: domains[b.slug]?.expires || '',
    domainState: domainState(domains[b.slug]),
  };
});

const order = ['rebuild', 'broken', 'dated', 'none', 'nosite', 'blocked', 'modern'];
for (const r of rows) r.pitch = pitchScore(r);
rows.sort((x, y) => y.pitch - x.pitch || order.indexOf(x.tier) - order.indexOf(y.tier) || x.name.localeCompare(y.name));
rows.forEach((r, i) => { r.rank = i + 1; });

await writeFile(new URL('../data/prospects.json', import.meta.url), JSON.stringify(rows, null, 1));

const cols = [
  ['Rank', (r) => r.rank], ['Pitch score', (r) => r.pitch],
  ['Priority', (r) => r.priority], ['Business', (r) => r.name], ['Town', (r) => r.town], ['Category', (r) => r.category],
  ['Phone', (r) => r.phone], ['Directory phone', (r) => r.listedPhone], ['Phone note', (r) => r.phoneNote], ['Email', (r) => r.email], ['Other emails', (r) => r.otherEmails.join('; ')],
  ['Website', (r) => r.website], ['Site status', (r) => r.siteState], ['Datedness score (0-100)', (r) => r.score ?? ''],
  ['Built with', (r) => r.platform], ['Mobile-ready', (r) => (r.mobileReady === null ? '' : r.mobileReady ? 'yes' : 'NO')],
  ['HTTPS', (r) => (r.https === null ? '' : r.https ? 'yes' : 'NO')], ['Footer year', (r) => r.copyrightYear || ''],
  ['Top issues', (r) => r.issues.join(' | ')], ['Facebook', (r) => r.facebook], ['Instagram', (r) => r.instagram],
  ['Address', (r) => r.address], ['Contact person', (r) => r.contact], ['Family / local note (from their site)', (r) => r.familyNote],
  ['In business since', (r) => r.since || ''], ['Listed in', (r) => r.sources.join('; ')], ['Home page size (MB)', (r) => r.pageMB ?? ''], ['Accessibility issues', (r) => r.a11yIssues ?? ''], ['Serious accessibility issues', (r) => r.a11ySerious ?? ''], ['Lighthouse performance (mobile)', (r) => r.lhPerformance ?? ''], ['Lighthouse accessibility', (r) => r.lhAccessibility ?? ''], ['Domain', (r) => r.domain], ['Domain expires', (r) => r.domainExpires], ['Domain note', (r) => r.domainState], ['Concept link', (r) => (r.demo ? `${liveUrl}/${r.demo}/` : '')], ['Checkup link', (r) => (r.demo ? `${liveUrl}/${r.demo}/report/` : '')], ['SEO health', (r) => r.seoHealth ?? ''], ['Main search', (r) => svcRank(r.slug)?.keyword || ''], ['Google position', (r) => (svcRank(r.slug) ? svcRank(r.slug).google ?? 'not in top 20' : '')], ['Google Maps position', (r) => (svcRank(r.slug) ? svcRank(r.slug).maps ?? 'not in top 20' : '')], ['Bing position', (r) => (svcRank(r.slug) ? svcRank(r.slug).bing ?? 'not in top 20' : '')], ['Google business panel', (r) => (nameRank(r.slug) ? (nameRank(r.slug).panel ? 'yes' : 'no') : '')], ['Social presence', (r) => r.socialPresence ?? ''], ['SEO & social report', (r) => (r.demo ? `${liveUrl}/${r.demo}/seo/` : '')],

  // Left blank for you to fill in as you work the list.
  ['Status', () => ''], ['Last contact', () => ''], ['Next step', () => ''], ['Notes', () => ''],
];
const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = [cols.map(([h]) => h).join(','), ...rows.map((r) => cols.map(([, f]) => cell(f(r))).join(','))].join('\n');
await writeFile(new URL('../data/prospects.csv', import.meta.url), `﻿${csv}\n`);

const n = (t) => rows.filter((r) => r.tier === t).length;
console.log(`prospects: ${rows.length} local businesses`);
for (const t of order) console.log(`  ${TIERS[t]}: ${n(t)}`);
console.log(`  directory phone differs from the business's own website: ${rows.filter((r) => r.listedPhone).length} (likely typos: ${rows.filter((r) => /typo/.test(r.phoneNote)).length})`);
console.log(`  domains lapsed: ${rows.filter((r) => /^Lapsed/.test(r.domainState)).length}, on hold: ${rows.filter((r) => /^On hold/.test(r.domainState)).length}`);
console.log(`  with phone: ${rows.filter((r) => r.phone).length}, with email: ${rows.filter((r) => r.email).length}, with website: ${rows.filter((r) => r.website).length}, demos built: ${rows.filter((r) => r.demo).length}`);
