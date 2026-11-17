// Look up every business website's domain in the public registry (RDAP) to
// find domains that have lapsed, are about to expire, or are stuck in a
// registrar hold. A business whose address is days from expiring, or already
// gone, is the most urgent call on the list.
//   node scripts/domains.mjs            (cached for 7 days in .cache/rdap)
//   node scripts/domains.mjs --fresh    ignore the cache
// Output: data/domains.json  { "<slug>": { domain, registered, expires, ... } }
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolve as dnsResolve } from 'node:dns/promises';
import { pool } from './lib/http.mjs';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'rdap');
const fresh = process.argv.includes('--fresh');
await mkdir(CACHE, { recursive: true });

// Hosts that belong to a website builder or social network, not the business.
const PLATFORM = /(^|\.)(wixsite|weebly|square|squarespace|godaddysites|business\.site|facebook|instagram|google|blogspot|wordpress|yolasite|webs|jimdosite|myshopify|carrd|linktr|vagaro|booksy|toasttab|clover|site123|mystrikingly|ueniweb|business\.site)\.[a-z]+$/i;
const TWO_LEVEL = /\.(co|com|org|net)\.[a-z]{2}$/i;

const businesses = JSON.parse(await readFile(path.join(ROOT, 'data', 'businesses.json'), 'utf8'));
const byDomain = new Map();
for (const b of businesses.filter((x) => x.include && x.website)) {
  let host;
  try { host = new URL(b.website).hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
  if (PLATFORM.test(host)) continue;
  const parts = host.split('.');
  const domain = parts.slice(TWO_LEVEL.test(host) ? -3 : -2).join('.');
  if (!byDomain.has(domain)) byDomain.set(domain, []);
  byDomain.get(domain).push(b.slug);
}
console.log(`domains: looking up ${byDomain.size} domains`);

const day = 86400000;
async function lookup(domain) {
  const file = path.join(CACHE, `${domain}.json`);
  const age = await stat(file).then((s) => Date.now() - s.mtimeMs).catch(() => Infinity);
  if (!fresh && age < 7 * day) return JSON.parse(await readFile(file, 'utf8'));
  let out;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { stdout } = await run('curl', ['-sL', '--max-time', '25', '-H', 'Accept: application/rdap+json', '-w', '\n%{http_code}', `https://rdap.org/domain/${domain}`], { maxBuffer: 4e6 });
      const i = stdout.lastIndexOf('\n');
      const code = Number(stdout.slice(i + 1));
      const body = stdout.slice(0, i);
      if (code === 404) { out = { domain, registered: false }; break; }
      if (code === 429 || code >= 500) { await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); continue; }
      if (code !== 200) { out = { domain, error: `HTTP ${code}` }; break; }
      const j = JSON.parse(body);
      const ev = (name) => (j.events || []).find((e) => e.eventAction === name)?.eventDate?.slice(0, 10) || null;
      const registrar = (j.entities || []).find((e) => (e.roles || []).includes('registrar'));
      const regName = registrar?.vcardArray?.[1]?.find((v) => v[0] === 'fn')?.[3] || null;
      out = { domain, registered: true, created: ev('registration'), expires: ev('expiration'), status: j.status || [], registrar: regName };
      break;
    } catch (e) {
      out = { domain, error: String(e.message || e).split('\n')[0].slice(0, 100) };
    }
  }
  out ||= { domain, error: 'rate limited' };
  out.checked = new Date().toISOString().slice(0, 10);
  if (!out.error) await writeFile(file, JSON.stringify(out));
  return out;
}

const results = {};
let done = 0;
await pool([...byDomain.keys()], 3, async (domain) => {
  const r = { ...(await lookup(domain)) };
  // rdap.org answers 404 both for unregistered names and for endings it has no
  // registry data for (.us, .io ...). A name that still resolves is registered.
  if (r.registered === false && (await dnsResolve(domain).then(() => true, () => false))) { r.registered = null; r.note = 'no registry data for this ending'; }
  const daysLeft = r.expires ? Math.round((Date.parse(r.expires) - Date.now()) / day) : null;
  const hold = (r.status || []).filter((s) => /redemption|pending delete|client hold|server hold|inactive/i.test(s));
  for (const slug of byDomain.get(domain)) results[slug] = { ...r, daysLeft, hold };
  if (++done % 50 === 0) console.log(`  ${done}/${byDomain.size}`);
});
await writeFile(path.join(ROOT, 'data', 'domains.json'), JSON.stringify(results, null, 1));

const rows = Object.values(results);
const n = (f) => new Set(rows.filter(f).map((r) => r.domain)).size;
console.log(`domains: ${n((r) => r.registered === false)} not registered (lapsed), ${n((r) => r.hold?.length)} in a registrar hold, ${n((r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 60)} expire within 60 days, ${n((r) => r.daysLeft !== null && r.daysLeft < 0)} past their expiry date, ${n((r) => r.error)} lookups failed`);
