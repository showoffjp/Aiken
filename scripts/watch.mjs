// Site watch: before a week of outreach, re-check every concept business's own
// website and report what changed since the last audit, so no one gets a pitch
// about a site that has been fixed, or a call after they have closed.
//   node scripts/watch.mjs   -> outreach/watch.md (not committed); also refreshes data/audit.json
// It re-runs scripts/audit.mjs --fresh for those businesses, then reads each
// fetched home page for language that says the business has closed for good.
// Holiday notices ("closed Thanksgiving Day") are not flagged; a match is a lead
// for a human to confirm, not a verdict.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const demos = readdirSync(path.join(ROOT, 'src/demos')).filter((f) => f.endsWith('.json')).map((f) => read(`src/demos/${f}`));
const status = existsSync(path.join(ROOT, 'data/status.json')) ? read('data/status.json') : {};
const watched = demos.filter((d) => !d.source.none).map((d) => ({ demo: d, key: d.prospect || d.slug }));
const before = read('data/audit.json');
const was = Object.fromEntries(watched.map(({ key }) => [key, before[key] ? { state: before[key].state, finalUrl: before[key].finalUrl } : null]));

console.log(`watch: re-checking ${watched.length} websites`);
execFileSync('node', [path.join(ROOT, 'scripts/audit.mjs'), ...watched.map((w) => w.key), '--fresh'], { stdio: 'inherit', cwd: ROOT });
const after = read('data/audit.json');

// A site that stopped answering may only have hiccuped, or turned the checker away:
// some hosts (GoDaddy's site builder among them) refuse automated visits now and then,
// and a bot wall ("blocked") is an answer too. Before calling a site down, try it again
// over about two minutes; one answer of any kind means it is up, and its previous audit
// entry is kept. The report lists these sites so a person can open them before calling.
const UNREAD = new Set(['down', 'no-dns', 'cert-error', 'blocked']);
const answers = (url) => {
  for (const wait of [0, 10, 30, 60]) {
    if (wait) execFileSync('sleep', [String(wait)]);
    try {
      const code = execFileSync('curl', ['-s', '-L', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '20', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', url], { encoding: 'utf8' });
      if (code !== '000') return true;
    } catch {}
  }
  return false;
};
const blips = [];
for (const { demo, key } of watched) {
  const a = after[key], b = before[key];
  if (a && b && UNREAD.has(a.state) && !UNREAD.has(b.state) && answers(a.url || b.url)) {
    blips.push(`| ${demo.name} | ${a.state} | ${b.finalUrl || b.url || ''} |`);
    after[key] = b;
  }
}
if (blips.length) writeFileSync(path.join(ROOT, 'data/audit.json'), JSON.stringify(after, null, 1)); // same layout as audit.mjs

// Words that say a business has shut for good. Ordinary hours and holiday closures are not matched.
const CLOSED = /\b(permanently closed|closed permanently|(?:have|has) (?:officially )?closed (?:our|its|the) doors|clos(?:ed|ing) (?:our|its|the) doors (?:for good|permanently)|(?:have|has) (?:decided|made the (?:difficult|hard|tough) decision) to close|closed for good|officially closed|no longer in business|ceased operations|out of business|(?:final|last) day of business|thank you for \d+ (?:wonderful |amazing |great )?years)\b/i;
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const bodyOf = (a) => {
  for (const u of [a?.url, a?.finalUrl]) {
    const f = u && path.join(ROOT, '.cache/sites', `${sha1(u)}.body`);
    if (f && existsSync(f)) return readFileSync(f, 'utf8');
  }
  return '';
};
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');

const BROKEN = new Set(['down', 'no-dns', 'cert-error', 'broken', 'parked', 'placeholder', 'empty', 'hijacked', 'redirects-away', 'redirects-to-social']);
const rows = { fixed: [], broke: [], changed: [], closing: [] };
for (const { demo, key } of watched) {
  const a = after[key], b = was[key];
  const name = demo.name, link = `${demo.slug}/`;
  if (status[key]) continue; // already marked closed, moved or skipped
  if (b && a && b.state !== a.state) {
    const row = `| ${name} | ${b.state} → ${a.state} | ${a.finalUrl || a.url || ''} |`;
    if (BROKEN.has(b.state) && !BROKEN.has(a.state)) rows.fixed.push(row);
    else if (!BROKEN.has(b.state) && BROKEN.has(a.state)) rows.broke.push(row);
    else rows.changed.push(row);
  }
  const m = text(bodyOf(a)).match(CLOSED);
  if (m) {
    const t = text(bodyOf(a)), i = Math.max(0, m.index - 70);
    rows.closing.push(`| ${name} | “…${t.slice(i, m.index + m[0].length + 70).trim()}…” | ${a.finalUrl || a.url || ''} |`);
  }
  void link;
}

const table = (title, note, head, list) => (list.length ? `## ${title} (${list.length})\n\n${note}\n\n${head}\n${list.join('\n')}\n` : `## ${title}\n\nNone.\n`);
const md = `# Site watch, ${new Date().toISOString().slice(0, 10)}

Re-checked ${watched.length} concept businesses' own websites${Object.keys(status).length ? ` (skipping ${Object.keys(status).length} already marked closed, moved or skipped in data/status.json)` : ''}.

${table('May have closed', 'Their own home page uses words that usually mean closed for good. Confirm before contacting; if they have closed, add them to data/status.json.', '| Business | What the page says | Address |\n| --- | --- | --- |', rows.closing)}
${table('Fixed since the last check', 'Their site works again. Drop the "your site is down" opener; the concept may still be worth showing as an upgrade.', '| Business | Change | Address |\n| --- | --- | --- |', rows.fixed)}
${table('Newly broken', 'Their site broke since the last check (one that stopped answering was tried again over two minutes first). Open it on your phone before calling: if it is broken for you too, it is worth an urgent call.', '| Business | Change | Address |\n| --- | --- | --- |', rows.broke)}
${table('Answered only on a retry', 'The fresh check could not load these, but each answered when tried again, so its earlier results are kept and the drafts are unchanged. Most often this is the host turning away an automated visit. Open each one on your phone before you call: if it fails for you too, it is an urgent call.', '| Business | First check | Address |\n| --- | --- | --- |', blips)}
${table('Other changes', 'The site still works but behaves differently.', '| Business | Change | Address |\n| --- | --- | --- |', rows.changed)}`;
mkdirSync(path.join(ROOT, 'outreach'), { recursive: true });
writeFileSync(path.join(ROOT, 'outreach', 'watch.md'), md);
console.log(`watch: ${blips.length} answered on a retry; ${rows.closing.length} may have closed, ${rows.fixed.length} fixed, ${rows.broke.length} newly broken, ${rows.changed.length} other changes -> outreach/watch.md`);
