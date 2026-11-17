// Print every checkup page to a Letter-size PDF for in-person visits.
// The printed page carries a QR code that opens the concept on a phone.
//   node scripts/leave-behind.mjs [slug ...]   -> outreach/print/<slug>.pdf
//                                                outreach/print/seo/<slug>-seo-report.pdf
// Requires `npm run build` first.
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'outreach', 'print');
await mkdir(path.join(OUT, 'seo'), { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
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

const wanted = process.argv.slice(2);
const slugs = (await readdir(path.join(ROOT, 'src', 'demos'))).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).filter((s) => !wanted.length || wanted.includes(s));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const slug of slugs) {
  await page.goto(`${base}/${slug}/report/`, { waitUntil: 'load' });
  await page.evaluate(async () => { await Promise.all([...document.images].map((i) => (i.loading = 'eager', i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))); });
  await page.waitForTimeout(300);
  await page.pdf({ path: path.join(OUT, `${slug}.pdf`), format: 'Letter', printBackground: true, scale: 0.6, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  // The full SEO & social report, every section open.
  const seo = await page.goto(`${base}/${slug}/seo/`, { waitUntil: 'load' });
  if (seo?.ok()) {
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    await page.waitForTimeout(300);
    await page.pdf({ path: path.join(OUT, 'seo', `${slug}-seo-report.pdf`), format: 'Letter', printBackground: true, scale: 0.7, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  }
}
await browser.close();
server.close();
console.log(`leave-behind: ${slugs.length} PDFs in outreach/print`);
