// Measure how heavy a page is: total bytes transferred, number of requests and
// time to the load event, as a phone would fetch it. Results merge into
// data/weights.json, keyed by business slug:
//   { "<slug>": { "site": {...}, "concept": {...} } }
//
//   node scripts/weigh.mjs --sites [slug ...]     current websites (from data/audit.json)
//   node scripts/weigh.mjs --concepts [slug ...]  built concepts (serves ./dist locally)
//
// Byte counts and request counts are stable from run to run. Load times are
// measured from this machine through a proxy and are only a rough guide.
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './lib/http.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'weights.json');

const args = process.argv.slice(2);
const mode = args.includes('--concepts') ? 'concept' : 'site';
const only = args.filter((a) => !a.startsWith('--'));
const weights = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));

let targets = [];
let server;
if (mode === 'site') {
  const audit = JSON.parse(await readFile(path.join(ROOT, 'data', 'audit.json'), 'utf8'));
  targets = Object.values(audit)
    .filter((a) => a.state === 'ok' && (!only.length || only.includes(a.slug)))
    .map((a) => ({ key: a.slug, url: a.finalUrl || a.url }));
} else {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const DIST = path.join(ROOT, 'dist');
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
  const demoDir = path.join(ROOT, 'src', 'demos');
  const files = (await (await import('node:fs/promises')).readdir(demoDir)).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const d = JSON.parse(await readFile(path.join(demoDir, f), 'utf8'));
    if (only.length && !only.includes(d.slug)) continue;
    targets.push({ key: d.prospect || d.slug, url: `${base}/${d.slug}/` });
  }
}
console.log(`weighing ${targets.length} ${mode} pages`);

const browser = await chromium.launch();
let done = 0;
await pool(targets, 4, async (t) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  // Third-party map embeds load lazily below the fold on concepts; skip them
  // everywhere so both sides are measured the same way.
  await ctx.route(/google\.com\/maps|maps\.googleapis\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  let bytes = 0, requests = 0;
  cdp.on('Network.requestWillBeSent', () => { requests++; });
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
  const started = Date.now();
  let loadMs = null, error = '';
  try {
    await page.goto(t.url, { waitUntil: 'load', timeout: 45000 });
    loadMs = Date.now() - started;
    await page.waitForTimeout(2500); // let late scripts and images settle
  } catch (e) { error = String(e).split('\n')[0].slice(0, 120); }
  await ctx.close();
  const entry = { bytes, requests, loadMs, url: t.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, ''), at: new Date().toISOString().slice(0, 10), ...(error && { error }) };
  weights[t.key] = { ...(weights[t.key] || {}), [mode]: entry };
  if (++done % 20 === 0) {
    console.log(`  ${done}/${targets.length}`);
    await writeFile(OUT, JSON.stringify(weights, null, 1));
  }
});
await browser.close();
server?.close();
await writeFile(OUT, JSON.stringify(weights, null, 1));

const rows = Object.values(weights).map((w) => w[mode]).filter((x) => x && !x.error && x.bytes);
const mb = (b) => (b / 1048576).toFixed(2);
rows.sort((a, b) => a.bytes - b.bytes);
const median = rows[Math.floor(rows.length / 2)];
console.log(`${mode}: ${rows.length} measured; median ${median ? mb(median.bytes) : '-'} MB / ${median?.requests ?? '-'} requests; heaviest ${rows.length ? mb(rows.at(-1).bytes) : '-'} MB`);
