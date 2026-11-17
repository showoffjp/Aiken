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
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'rankings.json');
const RAW = path.join(ROOT, '.cache', 'serp');
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

// curl, not fetch: Node's fetch skips the session's HTTPS proxy, which is what
// adds a saved network secret to the request.
async function serp(endpoint, keyword, depth, attempt = 0) {
  try { return await serpOnce(endpoint, keyword, depth); } catch (e) {
    if (e.fatal || attempt >= 1) throw e;
    await new Promise((r) => setTimeout(r, 4000));
    return serp(endpoint, keyword, depth, attempt + 1);
  }
}
async function serpOnce(endpoint, keyword, depth) {
  const headers = Object.entries({ 'content-type': 'application/json', ...auth }).flatMap(([k, v]) => ['-H', `${k}: ${v}`]);
  const body = JSON.stringify([{ keyword, location_name: LOCATION, language_code: 'en', device: 'mobile', depth }]);
  const { stdout } = await run('curl', ['-s', '--max-time', '90', '-X', 'POST', ...headers, '--data-binary', body, '-w', '\n%{http_code}', `${API}/serp/${endpoint}/live/advanced`], { maxBuffer: 3e7 });
  const i = stdout.lastIndexOf('\n');
  const status = Number(stdout.slice(i + 1));
  if (status === 401 || status === 403) throw Object.assign(new Error('DataForSEO rejected the credentials'), { fatal: true });
  const j = JSON.parse(stdout.slice(0, i) || '{}');
  const task = j.tasks?.[0];
  if (!task || task.status_code >= 40000) throw Object.assign(new Error(task?.status_message || j.status_message || `HTTP ${status}`), { fatal: /balance|payment|money/i.test(task?.status_message || j.status_message || '') });
  const items = task.result?.[0]?.items || [];
  // Keep a compact copy so matching can be improved later without paying again.
  await mkdir(RAW, { recursive: true });
  await writeFile(path.join(RAW, `${endpoint.replace('/', '-')}--${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}.json`), JSON.stringify(items.map((i) => ({ type: i.type, rank_group: i.rank_group, title: i.title, url: i.url, breadcrumb: i.breadcrumb, website_name: i.website_name, domain: i.domain }))));
  return items;
}

const hostOf = (u = '') => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const nameKey = (n = '') => n.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|llc|inc|co)\b/g, ' ').replace(/\s+/g, ' ').trim();

const demos = [];
for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json'))) demos.push(JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8')));
// --missing: only businesses without results yet. --name-only: redo just the business-name search.
const nameOnly = args.includes('--name-only');
const targets = demos.filter((d) => (!only.length || only.includes(d.slug) || only.includes(d.prospect)) && (!args.includes('--missing') || !results[d.prospect || d.slug]));

// Per business: what a new customer types (Google, Maps, Bing) and the business name (Google).
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
const calls = targets.length * (nameOnly ? 1 : 4);
console.log(`rankings: ${targets.length} businesses, ${calls} searches (Google, Google Maps, Bing)${dry ? ' [dry run]' : ''}`);
if (dry) { for (const d of targets) console.log(`  ${d.slug}: ${keywordsFor(d).join(' | ')}`); process.exit(0); }

for (const d of targets) {
  const key = d.prospect || d.slug;
  const host = seo[key]?.site?.host || hostOf(d.source.none ? '' : d.source.url);
  const nk = nameKey(d.name);
  // Google wraps result links (google.com/goto?...); the breadcrumb holds the real site.
  const siteOf = (i) => hostOf(i.breadcrumb || '') || hostOf(i.url || '');
  const isMine = (i) => !!host && (siteOf(i) === host || siteOf(i).endsWith(`.${host}`));
  const organic = (items) => items.filter((i) => i.type === 'organic');
  const pos = (items) => organic(items).find(isMine)?.rank_group ?? null;
  const top = (items) => { const t = organic(items)[0]; return t ? `${(t.title || '').slice(0, 60)} (${t.website_name || siteOf(t)})` : ''; };
  const [service, brand] = keywordsFor(d);
  // Same business by name: its own site, or a title that contains the whole name.
  const sameName = (t = '') => { const k = nameKey(t); return k.length >= 4 && (k === nk || k.includes(nk) || (nk.includes(k) && k.split(' ').length >= 2)); };
  try {
    // The business's own name on Google: whether Google shows its business panel (on phones the
    // website link sits in that panel) and where its site ranks among the plain results.
    const gb = await serp('google/organic', brand, 10);
    const kg = gb.filter((i) => i.type === 'knowledge_graph');
    const panel = kg.some((i) => isMine(i) || sameName(i.title));
    const panelSite = kg.some((i) => isMine(i));
    const nameRow = { keyword: brand, kind: 'name', google: pos(gb), googleDepth: 10, panel, panelSite, top: top(gb) };
    let rows;
    if (nameOnly && results[key]) {
      rows = [...results[key].keywords.filter((r) => r.kind !== 'name'), nameRow];
    } else {
      // The search a new customer types: Google, Google Maps and Bing, top 20 each.
      const [g, m, b] = await Promise.all([serp('google/organic', service, 20), serp('google/maps', service, 20), serp('bing/organic', service, 20)]);
      const mapsHit = m.find((i) => isMine(i) || sameName(i.title));
      rows = [{ keyword: service, kind: 'service', google: pos(g), googleDepth: 20, maps: mapsHit ? mapsHit.rank_group : null, mapsDepth: 20, bing: pos(b), bingDepth: 20, top: top(g) }, nameRow];
    }
    results[key] = { checked: new Date().toISOString().slice(0, 10), location: 'Aiken, SC', device: 'phone', keywords: rows };
    const sv = rows.find((r) => r.kind === 'service') || {};
    console.log(`  ${d.slug}: "${sv.keyword}" G${sv.google ?? '-'} M${sv.maps ?? '-'} B${sv.bing ?? '-'}; name G${nameRow.google ?? '-'}${panel ? (panelSite ? ' +panel(site)' : ' +panel') : ''}`);
  } catch (e) {
    console.log(`  ${d.slug}: ${e.message}`);
    if (e.fatal) break;
  }
  await writeFile(OUT, JSON.stringify(results, null, 1));
}
