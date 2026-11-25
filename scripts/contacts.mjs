// Contact sheet for every business with a concept: phones, emails, contact
// person, address, current site and the links to its concept, checkup and SEO
// report. Emails are gathered from the research data and, where that has none,
// from every page already fetched for the business (its own site's pages and
// its directory listings in .cache), so nothing new is requested.
//   node scripts/contacts.mjs   -> outreach/contacts.csv, contacts.md and contacts.json (not committed)
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const prospects = read('data/prospects.json');
const seo = existsSync(path.join(ROOT, 'data/seo.json')) ? read('data/seo.json') : {};
const siteTs = readFileSync(path.join(ROOT, 'src/lib/site.ts'), 'utf8');
const base = ((siteTs.match(/url:\s*'([^']*)'/) || [])[1] || '').replace(/\/$/, '');
const demos = readdirSync(path.join(ROOT, 'src/demos')).filter((f) => f.endsWith('.json')).map((f) => read(`src/demos/${f}`)).sort((a, b) => a.name.localeCompare(b.name));

// ---- every cached page, by URL
const CACHE = path.join(ROOT, '.cache');
const pages = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.json') && existsSync(p.replace(/\.json$/, '.body'))) {
      try { const m = JSON.parse(readFileSync(p, 'utf8')); if (m.url) pages.push({ url: m.finalUrl || m.url, asked: m.url, body: p.replace(/\.json$/, '.body') }); } catch {}
    }
  }
};
walk(CACHE);
const hostOf = (u = '') => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

// ---- email extraction
const JUNK = /^(jane|john)[._-]?(smith|doe)@|^[0-9-]{10,}@|(example|domain|yourname|youremail|email|name)@|@(example|domain|sentry|wixpress|sentry-next|godaddy|squarespace|wix|yourdomain|email)\.|@[a-z0-9-]*(your[a-z]*site|wpsite|themes?|demo)[a-z0-9-]*\.|\.(png|jpe?g|gif|webp|svg|css|js)$|^[0-9a-f]{12,}@|@[0-9]+x\./i;
const COMMON = /@(gmail|yahoo|aol|hotmail|outlook|icloud|me|live|msn|bellsouth|comcast|att|sc\.rr|charter|earthlink|verizon)\./i;
function emailsIn(text) {
  const t = text.replace(/%20/g, ' ').replace(/&#0*64;|&#x0*40;|%40/gi, '@').replace(/&#0*46;|&#x0*2e;/gi, '.').replace(/\s*\[\s*at\s*\]\s*/gi, '@').replace(/\s*\[\s*dot\s*\]\s*/gi, '.');
  return [...new Set((t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((e) => e.replace(/^mailto:/i, '').replace(/[.,;:]+$/, '').toLowerCase()))].filter((e) => !JUNK.test(e) && e.length < 60);
}
const digits = (s = '') => s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const fmt = (s = '') => { const d = digits(s); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s; };

const rows = demos.map((d) => {
  const key = d.prospect || d.slug;
  const r = prospects.find((x) => x.slug === key) || {};
  const s = seo[key] || {};
  const siteHost = s.site?.host || (d.source.none ? '' : hostOf(r.website || d.source.url));
  // Phones: the concept's, then any other numbers the directories list.
  const phones = [...new Map([d.contact.phone, d.contact.phone2, r.phone, r.listedPhone, ...(s.citations || []).map((c) => c.phone)].filter(Boolean).map((p) => [digits(p), fmt(p)])).values()].filter((p) => digits(p).length === 10);
  // Emails already in the research, then any found on cached pages of this business.
  const known = [r.email, ...(r.otherEmails || []), d.contact.email].filter(Boolean).map((e) => e.toLowerCase()).filter((e) => !JUNK.test(e));
  const urls = new Set([d.source.url, r.website, ...(s.citations || []).map((c) => c.url)].filter(Boolean));
  const found = [];
  for (const pg of pages) {
    const mine = (siteHost && (hostOf(pg.url) === siteHost || hostOf(pg.asked) === siteHost)) || urls.has(pg.url) || urls.has(pg.asked);
    if (!mine) continue;
    try { if (statSync(pg.body).size > 4_000_000) continue; found.push(...emailsIn(readFileSync(pg.body, 'utf8'))); } catch {}
  }
  // Keep found addresses that plausibly belong to the business: its own domain or a personal mailbox.
  // (A designer's or platform's address on the same page is left out.)
  const nameTokens = `${d.name} ${d.slug}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^(aiken|south|carolina|the|and|restaurant|company|center|shop|services?|llc|inc)$/.test(w));
  const plausible = found.filter((e) => {
    const dom = e.split('@')[1] || '';
    const own = (siteHost && (dom === siteHost || dom.endsWith(siteHost.split('.').slice(-2).join('.')))) || nameTokens.some((w) => dom.replace(/[^a-z0-9]/g, '').includes(w));
    // A free mailbox (gmail, icloud…) found on a page counts only when it is named after the business:
    // pages also carry a font designer's, a band's or a vendor's personal address.
    const local = e.split('@')[0].replace(/[^a-z0-9]/g, '');
    return own || (COMMON.test(e) && nameTokens.some((w) => local.includes(w)));
  });
  // The business's own-domain addresses first.
  const ownDomain = (e) => Boolean(siteHost) && (e.split('@')[1] || '').endsWith(siteHost.split('.').slice(-2).join('.'));
  plausible.sort((a, b) => Number(ownDomain(b)) - Number(ownDomain(a)));
  const all = [...new Set([...known, ...plausible])];
  // Extra addresses: drop free mailboxes that are not named after the business or its contact (a designer's,
  // a partner's), and on a franchise site that lists every location keep only this area's and the general ones.
  const people = `${r.contact || ''}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
  const named = (e) => { const l = e.split('@')[0].replace(/[^a-z0-9]/g, ''); return nameTokens.some((w) => l.includes(w)) || people.some((w) => l.includes(w)); };
  const LOCAL = /aiken|augusta|graniteville|beechisland|^(info|contact|office|sales|hello|service)\d*$/;
  const sameDomain = (e) => all.filter((x) => x.split('@')[1] === e.split('@')[1]).length;
  const franchise = all.some((e) => sameDomain(e) > 10);
  // "20kim@…" is "%20kim@…" (an encoded space) read wrongly: the same address as kim@….
  const echo = (e) => /^(%20|20)/.test(e) && all.includes(e.replace(/^(%20|20)/, ''));
  const extras = all.slice(1).filter((e) => !echo(e) && (!COMMON.test(e) || named(e)) && (!franchise || LOCAL.test(e.split('@')[0])));
  const emails = all.length ? [all[0], ...extras.slice(0, 6)] : [];
  return {
    slug: d.slug,
    business: d.name, category: d.category, town: d.town.replace(/,?\s*SC$/i, ''),
    phone: phones[0] || '', otherPhones: phones.slice(1).join('; '),
    email: emails[0] || '', otherEmails: emails.slice(1).join('; '), emailSource: !emails.length ? '' : known.includes(emails[0]) ? 'directory or website' : 'found on a cached page',
    contact: [r.contact, r.contactRole].filter(Boolean).join(', '), contactSource: r.contactSource || '', address: (d.contact.address || []).join(', ') || r.address || '',
    currentSite: d.source.none ? '(none)' : (r.website || d.source.url), siteStatus: d.source.none ? 'No website' : (r.siteState || ''),
    facebook: d.contact.facebook || r.facebook || '', instagram: d.contact.instagram || r.instagram || '',
    concept: `${base}/${d.slug}/`, checkup: `${base}/${d.slug}/report/`, seoReport: `${base}/${d.slug}/seo/`,
    phoneNote: r.phoneNote || '', priority: r.priority || '',
  };
});

const cols = [['Business', 'business'], ['Category', 'category'], ['Town', 'town'], ['Phone', 'phone'], ['Other phones', 'otherPhones'], ['Email', 'email'], ['Other emails', 'otherEmails'], ['Email found in', 'emailSource'], ['Contact person', 'contact'], ['Contact found in', 'contactSource'],['Address', 'address'], ['Current website', 'currentSite'], ['Website status', 'siteStatus'], ['Facebook', 'facebook'], ['Instagram', 'instagram'], ['Concept', 'concept'], ['Checkup', 'checkup'], ['SEO report', 'seoReport'], ['Phone note', 'phoneNote'], ['Priority', 'priority']];
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const out = path.join(ROOT, 'outreach');
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'contacts.csv'), `﻿${[cols.map(([h]) => h).join(','), ...rows.map((r) => cols.map(([, k]) => csvCell(r[k])).join(','))].join('\r\n')}\r\n`);
const md = ['| Business | Phone | Email | Contact | Website |', '|---|---|---|---|---|', ...rows.map((r) => `| ${r.business} | ${[r.phone, r.otherPhones].filter(Boolean).join(', ') || '–'} | ${[r.email, r.otherEmails].filter(Boolean).join(', ') || '–'} | ${r.contact || '–'} | ${r.currentSite === '(none)' ? 'none' : r.siteStatus === 'Online' ? 'online' : (r.siteStatus || '').split(/[(-]/)[0].trim().toLowerCase()} |`)];
writeFileSync(path.join(out, 'contacts.md'), `${md.join('\n')}\n`);
// The best address per concept, for the outreach drafts (npm run outreach reads it).
writeFileSync(path.join(out, 'contacts.json'), `${JSON.stringify(Object.fromEntries(rows.filter((r) => r.email).map((r) => [r.slug, { email: r.email, source: r.emailSource }])), null, 1)}\n`);
const withEmail = rows.filter((r) => r.email).length, newly = rows.filter((r) => r.emailSource === 'found on a cached page').length;
console.log(`contacts: ${rows.length} businesses; ${rows.filter((r) => r.phone).length} with a phone, ${withEmail} with an email (${newly} found on cached pages); ${pages.length} cached pages searched`);
