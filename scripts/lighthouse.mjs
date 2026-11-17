// Google Lighthouse scores (mobile, simulated slow 4G) for the current website
// of every business with a concept, and for every concept. These are the same
// numbers anyone gets from PageSpeed Insights, which makes them easy for an
// owner to check for themselves.
//   node scripts/lighthouse.mjs --sites [slug ...]     current sites (concept businesses only)
//   node scripts/lighthouse.mjs --sites --all          every audited site (slow: ~20 s each)
//   node scripts/lighthouse.mjs --concepts [slug ...]  concepts, served from ./dist with gzip
//   add --missing to skip pages that already have a score
// Output merges into data/lighthouse.json: { "<prospect slug>": { site, concept } }
import { createServer } from 'node:http';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { default: lighthouse } = await import(require.resolve('lighthouse'));
const chromeLauncher = await import(require.resolve('chrome-launcher'));
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'lighthouse.json');
const args = process.argv.slice(2);
const mode = args.includes('--concepts') ? 'concept' : 'site';
const only = args.filter((a) => !a.startsWith('--'));
const results = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));

const demos = [];
for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json'))) demos.push(JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8')));

let targets = [];
let server;
if (mode === 'site') {
  const audit = JSON.parse(await readFile(path.join(ROOT, 'data', 'audit.json'), 'utf8'));
  const keys = args.includes('--all') ? Object.keys(audit) : demos.filter((d) => !d.source.none).map((d) => d.prospect || d.slug);
  targets = keys.filter((k) => audit[k]?.state === 'ok' && (!only.length || only.includes(k))).map((k) => ({ key: k, url: audit[k].finalUrl || audit[k].url }));
} else {
  // Serve the build the way Vercel does: gzip, so byte counts are realistic.
  const DIST = path.join(ROOT, 'dist');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
  server = createServer(async (req, res) => {
    try {
      let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if ((await stat(p).catch(() => null))?.isDirectory()) p = path.join(p, 'index.html');
      let body = await readFile(p);
      const type = TYPES[path.extname(p)] || 'application/octet-stream';
      const headers = { 'content-type': type, 'cache-control': 'public, max-age=3600' };
      if (/text|javascript|svg|json/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) { body = gzipSync(body); headers['content-encoding'] = 'gzip'; }
      res.writeHead(200, headers);
      res.end(body);
    } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  targets = demos.filter((d) => !only.length || only.includes(d.slug)).map((d) => ({ key: d.prospect || d.slug, url: `${base}/${d.slug}/`, slug: d.slug }));
}
if (args.includes('--missing')) targets = targets.filter((t) => !results[t.key]?.[mode] || results[t.key][mode].error);
console.log(`lighthouse: ${targets.length} ${mode} pages`);

const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });
const pct = (c) => (c && typeof c.score === 'number' ? Math.round(c.score * 100) : null);
let done = 0;
for (const t of targets) {
  let entry;
  try {
    const run = lighthouse(t.url, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], maxWaitForLoad: 45000 });
    const r = await Promise.race([run, new Promise((_, no) => setTimeout(() => no(new Error('timed out after 120s')), 120000))]);
    const { categories: c, audits: a, runtimeError } = r.lhr;
    if (runtimeError) throw new Error(runtimeError.code);
    const ms = (k) => (typeof a[k]?.numericValue === 'number' ? Math.round(a[k].numericValue) : null);
    entry = {
      performance: pct(c.performance), accessibility: pct(c.accessibility), bestPractices: pct(c['best-practices']), seo: pct(c.seo),
      fcp: ms('first-contentful-paint'), lcp: ms('largest-contentful-paint'), tbt: ms('total-blocking-time'), si: ms('speed-index'),
      cls: typeof a['cumulative-layout-shift']?.numericValue === 'number' ? +a['cumulative-layout-shift'].numericValue.toFixed(3) : null,
      at: new Date().toISOString().slice(0, 10),
    };
  } catch (e) {
    entry = { error: String(e.message || e).split('\n')[0].slice(0, 120), at: new Date().toISOString().slice(0, 10) };
  }
  results[t.key] = { ...(results[t.key] || {}), [mode]: entry };
  await writeFile(OUT, JSON.stringify(results, null, 1));
  done++;
  console.log(`  ${done}/${targets.length} ${t.slug || t.key}: ${entry.error ? `error ${entry.error}` : `performance ${entry.performance}, accessibility ${entry.accessibility}, LCP ${(entry.lcp / 1000).toFixed(1)} s`}`);
}
await chrome.kill();
server?.close();

const rows = Object.values(results).map((x) => x[mode]).filter((x) => x && !x.error);
rows.sort((a, b) => a.performance - b.performance);
console.log(`${mode}: ${rows.length} scored; median performance ${rows[Math.floor(rows.length / 2)]?.performance ?? '-'}; ${rows.filter((r) => r.performance < 50).length} below 50`);
