// Before sending anything: refetch the current website of every business that
// has a concept and report what changed since the last audit. A site that has
// come back up, been redesigned or changed platform makes the pitch stale.
//   node scripts/recheck.mjs
// Writes outreach/recheck.md (not committed) and updates data/audit.json.
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditFile = path.join(ROOT, 'data', 'audit.json');

const demos = [];
for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8'));
  demos.push(d);
}
const before = JSON.parse(await readFile(auditFile, 'utf8'));
const slugs = demos.filter((d) => !d.source.none && before[d.prospect || d.slug]).map((d) => d.prospect || d.slug);
console.log(`recheck: refetching ${slugs.length} current websites`);
await run('node', [path.join(ROOT, 'scripts', 'audit.mjs'), '--fresh', ...slugs], { cwd: ROOT, maxBuffer: 1e7 });
let after = JSON.parse(await readFile(auditFile, 'utf8'));
// A single dropped connection should not read as "site down": try those again.
const flaky = slugs.filter((s) => before[s].state === 'ok' && after[s]?.state !== 'ok');
if (flaky.length) {
  await new Promise((r) => setTimeout(r, 8000));
  await run('node', [path.join(ROOT, 'scripts', 'audit.mjs'), '--fresh', ...flaky], { cwd: ROOT, maxBuffer: 1e7 });
  after = JSON.parse(await readFile(auditFile, 'utf8'));
}

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const rows = [];
for (const d of demos) {
  const key = d.prospect || d.slug;
  const a = before[key], b = after[key];
  if (d.source.none || !a || !b) continue;
  const notes = [];
  if (a.state !== b.state) notes.push(`site state ${a.state} → ${b.state}`);
  if ((a.platform || '') !== (b.platform || '')) notes.push(`platform ${a.platform || 'unknown'} → ${b.platform || 'unknown'}`);
  if (host(a.finalUrl) !== host(b.finalUrl)) notes.push(`now redirects to ${host(b.finalUrl) || 'nothing'}`);
  if (a.score !== null && b.score !== null && Math.abs(a.score - b.score) >= 10) notes.push(`datedness score ${a.score} → ${b.score}`);
  if ((a.copyrightYear || 0) !== (b.copyrightYear || 0) && b.copyrightYear) notes.push(`footer year ${a.copyrightYear || 'none'} → ${b.copyrightYear}`);
  const level = /→ ok|platform|redirects/.test(notes.join(' ')) ? 'Check before sending' : notes.length ? 'Minor change' : 'Unchanged';
  rows.push({ name: d.name, slug: d.slug, url: d.source.url, level, notes });
}
const order = ['Check before sending', 'Minor change', 'Unchanged'];
rows.sort((x, y) => order.indexOf(x.level) - order.indexOf(y.level) || x.name.localeCompare(y.name));

await mkdir(path.join(ROOT, 'outreach'), { recursive: true });
await writeFile(path.join(ROOT, 'outreach', 'recheck.md'), `# Recheck, ${new Date().toISOString().slice(0, 10)}

Every concept's current website, fetched again and compared with the last audit. Anything under "Check before sending" may have been fixed or redesigned since the concept was made: open it yourself and update the concept's "before" notes if needed.

| Business | Result | What changed |
| --- | --- | --- |
${rows.map((r) => `| [${r.name}](${r.url}) | ${r.level} | ${r.notes.join('; ') || '-'} |`).join('\n')}
`);
const n = (l) => rows.filter((r) => r.level === l).length;
console.log(`recheck: ${n('Check before sending')} to check before sending, ${n('Minor change')} minor changes, ${n('Unchanged')} unchanged (outreach/recheck.md)`);
for (const r of rows.filter((x) => x.level !== 'Unchanged')) console.log(`  ${r.level}: ${r.name}: ${r.notes.join('; ')}`);
