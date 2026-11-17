// Search positions on Google (web and Maps) and Bing for each concept
// business, from the DataForSEO SERP API (https://dataforseo.com, pay as you
// go, roughly a fifth of a cent per search). Searches run as a phone in
// Aiken, SC. Scraping Google or Bing directly is against their terms, so
// this uses a licensed data provider instead.
//
// Credentials: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in the environment,
// or a network secret for api.dataforseo.com that the session's proxy adds.
//   node scripts/rankings.mjs [slug ...] [--dry-run]
// Output: data/rankings.json  { "<prospect slug>": { checked, location, keywords: [{ keyword, google, maps, bing, top }] } }
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'rankings.json');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const only = args.filter((a) => !a.startsWith('--'));
const results = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));
const seo = JSON.parse(await readFile(path.join(ROOT, 'data', 'seo.json'), 'utf8').catch(() => '{}'));
const LOCATION = 'Aiken,South Carolina,United States';
const API = 'https://api.dataforseo.com/v3';
const auth = process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD
  ? { authorization: `Basic ${Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64')}` }
  : {}; // otherwise the network proxy adds the saved credential

async function serp(endpoint, keyword, depth) {
  const res = await fetch(`${API}/serp/${endpoint}/live/advanced`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify([{ keyword, location_name: LOCATION, language_code: 'en', device: 'mobile', depth }]),
  });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error('DataForSEO rejected the credentials'), { fatal: true });
  const j = await res.json();
  const task = j.tasks?.[0];
  if (!task || task.status_code >= 40000) throw new Error(task?.status_message || j.status_message || `HTTP ${res.status}`);
  return task.result?.[0]?.items || [];
}

const hostOf = (u = '') => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const nameKey = (n = '') => n.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|llc|inc|co)\b/g, ' ').replace(/\s+/g, ' ').trim();

const demos = [];
for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json'))) demos.push(JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8')));
const targets = demos.filter((d) => !only.length || only.includes(d.slug) || only.includes(d.prospect));

// Two searches per business: what a new customer types, and the business name.
// The service phrase comes from the business's directory category; overrides in
// data/keywords.json ({ "<concept slug>": "granite countertops aiken sc" }).
const businesses = JSON.parse(await readFile(path.join(ROOT, 'data', 'businesses.json'), 'utf8'));
const overrides = JSON.parse(await readFile(path.join(ROOT, 'data', 'keywords.json'), 'utf8').catch(() => '{}'));
function keywordsFor(d) {
  if (overrides[d.slug]) return [overrides[d.slug], d.name];
  const b = businesses.find((x) => x.slug === (d.prospect || d.slug));
  const cat = (b?.categories || []).find((c) => !/^(do|eat|shop|stay) |attraction|downtown aiken|individual|associate/i.test(c)) || d.category.split(/,|&/)[0];
  const service = cat.toLowerCase().replace(/\(.*?\)/g, '').replace(/\+/g, ' and ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const town = (d.town || 'Aiken, SC').split(',')[0].trim().toLowerCase();
  return [`${service} ${town} sc`, d.name];
}
const calls = targets.length * 2 * 3;
console.log(`rankings: ${targets.length} businesses, ${calls} searches (Google, Google Maps, Bing)${dry ? ' [dry run]' : ''}`);
if (dry) { for (const d of targets) console.log(`  ${d.slug}: ${keywordsFor(d).join(' | ')}`); process.exit(0); }

for (const d of targets) {
  const key = d.prospect || d.slug;
  const host = seo[key]?.site?.host || hostOf(d.source.none ? '' : d.source.url);
  const nk = nameKey(d.name);
  const rows = [];
  try {
    for (const keyword of keywordsFor(d)) {
      const [g, m, b] = await Promise.all([serp('google/organic', keyword, 100), serp('google/maps', keyword, 20), serp('bing/organic', keyword, 50)]);
      const organic = (items) => items.filter((i) => i.type === 'organic');
      const pos = (items) => { const hit = organic(items).find((i) => host && (hostOf(i.url) === host || hostOf(i.url).endsWith(`.${host}`))); return hit ? hit.rank_group : null; };
      const mapsHit = m.find((i) => (host && hostOf(i.url || '') === host) || nameKey(i.title || '').includes(nk) || nk.includes(nameKey(i.title || '')));
      const top = organic(g)[0];
      rows.push({ keyword, google: pos(g), maps: mapsHit ? mapsHit.rank_group : null, bing: pos(b), top: top ? `${top.title?.slice(0, 60) || ''} (${hostOf(top.url)})` : '' });
    }
    results[key] = { checked: new Date().toISOString().slice(0, 10), location: 'Aiken, SC', keywords: rows };
    console.log(`  ${d.slug}: ${rows.map((r) => `"${r.keyword}" G${r.google ?? '-'} M${r.maps ?? '-'} B${r.bing ?? '-'}`).join('; ')}`);
  } catch (e) {
    console.log(`  ${d.slug}: ${e.message}`);
    if (e.fatal) break;
  }
  await writeFile(OUT, JSON.stringify(results, null, 1));
}
