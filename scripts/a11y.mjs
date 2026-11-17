// Automated accessibility check (axe-core, WCAG 2.1 A/AA rules) of the home
// page as a phone sees it. Results merge into data/a11y.json:
//   { "<slug>": { "site": {...}, "concept": {...} } }
//
//   node scripts/a11y.mjs --sites [slug ...]
//   node scripts/a11y.mjs --concepts [slug ...]   (serves ./dist locally)
//   node scripts/a11y.mjs --concepts --details    print every violation
//   node scripts/a11y.mjs --sites --missing       resume: only sites not yet checked
//
// Automated tools catch roughly a third of real accessibility problems, so a
// clean result is a floor, not a certificate.
import { createServer } from 'node:http';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './lib/http.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'a11y.json');
const AXE = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');

const args = process.argv.slice(2);
const mode = args.includes('--concepts') ? 'concept' : 'site';
const details = args.includes('--details');
const only = args.filter((a) => !a.startsWith('--'));
const results = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));

let targets = [];
let server;
if (mode === 'site') {
  const audit = JSON.parse(await readFile(path.join(ROOT, 'data', 'audit.json'), 'utf8'));
  targets = Object.values(audit).filter((a) => a.state === 'ok' && (!only.length || only.includes(a.slug))).map((a) => ({ key: a.slug, url: a.finalUrl || a.url }));
  // --missing: only sites without a result yet (resume an interrupted run)
  if (args.includes('--missing')) targets = targets.filter((t) => !results[t.key]?.site);
} else {
  const DIST = path.join(ROOT, 'dist');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  server = createServer(async (req, res) => {
    try {
      let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if ((await stat(p).catch(() => null))?.isDirectory()) p = path.join(p, 'index.html');
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json'))) {
    const d = JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8'));
    if (only.length && !only.includes(d.slug)) continue;
    targets.push({ key: d.prospect || d.slug, url: `${base}/${d.slug}/`, slug: d.slug });
  }
}
console.log(`a11y: checking ${targets.length} ${mode} pages`);

const browser = await chromium.launch();
let done = 0;
await pool(targets, 4, async (t) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  await ctx.route(/google\.com\/maps|maps\.googleapis\.com|_vercel\/insights/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {})); // an alert() would block axe forever
  let entry;
  try {
    await page.goto(t.url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1500);
    await page.addScriptTag({ content: AXE });
    // Some pages never settle; give axe 60 seconds, then move on.
    const r = await Promise.race([new Promise((_, no) => setTimeout(() => no(new Error('axe timed out after 60s')), 60000)), page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
      return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(' ')) }));
    })]);
    const count = (lvl) => r.filter((v) => v.impact === lvl).reduce((n, v) => n + v.nodes, 0);
    entry = {
      rules: r.length,
      issues: r.reduce((n, v) => n + v.nodes, 0),
      critical: count('critical'), serious: count('serious'), moderate: count('moderate'), minor: count('minor'),
      top: r.sort((a, b) => b.nodes - a.nodes).slice(0, 6).map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes })),
      at: new Date().toISOString().slice(0, 10),
    };
    if (details && r.length) console.log(`\n${t.slug || t.key}:\n` + r.map((v) => `  [${v.impact}] ${v.id} x${v.nodes}: ${v.help}\n      ${v.sample.join(' | ')}`).join('\n'));
  } catch (e) {
    entry = { error: String(e).split('\n')[0].slice(0, 120), at: new Date().toISOString().slice(0, 10) };
  }
  await ctx.close().catch(() => {});
  results[t.key] = { ...(results[t.key] || {}), [mode]: entry };
  if (++done % 25 === 0) { console.log(`  ${done}/${targets.length}`); await writeFile(OUT, JSON.stringify(results, null, 1)); }
});
await browser.close();
server?.close();
await writeFile(OUT, JSON.stringify(results, null, 1));

const rows = Object.values(results).map((x) => x[mode]).filter((x) => x && !x.error);
const clean = rows.filter((x) => x.issues === 0).length;
const serious = rows.filter((x) => x.critical + x.serious > 0).length;
rows.sort((a, b) => a.issues - b.issues);
console.log(`${mode}: ${rows.length} checked; ${clean} with no automated findings; ${serious} with critical or serious issues; median ${rows[Math.floor(rows.length / 2)]?.issues ?? '-'} issues`);
