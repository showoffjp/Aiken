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
  };
});

const order = ['rebuild', 'broken', 'dated', 'none', 'nosite', 'blocked', 'modern'];
rows.sort((x, y) => order.indexOf(x.tier) - order.indexOf(y.tier) || (y.score ?? -1) - (x.score ?? -1) || x.name.localeCompare(y.name));

await writeFile(new URL('../data/prospects.json', import.meta.url), JSON.stringify(rows, null, 1));

const cols = [
  ['Priority', (r) => r.priority], ['Business', (r) => r.name], ['Town', (r) => r.town], ['Category', (r) => r.category],
  ['Phone', (r) => r.phone], ['Directory phone', (r) => r.listedPhone], ['Phone note', (r) => r.phoneNote], ['Email', (r) => r.email], ['Other emails', (r) => r.otherEmails.join('; ')],
  ['Website', (r) => r.website], ['Site status', (r) => r.siteState], ['Datedness score (0-100)', (r) => r.score ?? ''],
  ['Built with', (r) => r.platform], ['Mobile-ready', (r) => (r.mobileReady === null ? '' : r.mobileReady ? 'yes' : 'NO')],
  ['HTTPS', (r) => (r.https === null ? '' : r.https ? 'yes' : 'NO')], ['Footer year', (r) => r.copyrightYear || ''],
  ['Top issues', (r) => r.issues.join(' | ')], ['Facebook', (r) => r.facebook], ['Instagram', (r) => r.instagram],
  ['Address', (r) => r.address], ['Contact person', (r) => r.contact], ['Family / local note (from their site)', (r) => r.familyNote],
  ['In business since', (r) => r.since || ''], ['Listed in', (r) => r.sources.join('; ')], ['Concept link', (r) => (r.demo ? `${liveUrl}/${r.demo}/` : '')], ['Checkup link', (r) => (r.demo ? `${liveUrl}/${r.demo}/report/` : '')],

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
console.log(`  with phone: ${rows.filter((r) => r.phone).length}, with email: ${rows.filter((r) => r.email).length}, with website: ${rows.filter((r) => r.website).length}, demos built: ${rows.filter((r) => r.demo).length}`);
