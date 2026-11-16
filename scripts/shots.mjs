// Screenshot built concept pages.
//   node scripts/shots.mjs                 -> "after" thumbnails for every demo (public/shots/<slug>-after.jpg)
//   node scripts/shots.mjs --review <slug> -> full-page desktop + mobile captures into .cache/review/
// Requires `npm run build` first (serves ./dist on a local port).
import { createServer } from 'node:http';
import { readFile, mkdir, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };

const server = createServer(async (req, res) => {
  try {
    let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if ((await stat(p).catch(() => null))?.isDirectory()) p = path.join(p, 'index.html');
    const data = await readFile(p);
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const args = process.argv.slice(2);
const review = args.includes('--review');
const wanted = args.filter((a) => !a.startsWith('--'));
const slugs = wanted.length ? wanted : (await readdir(path.join(ROOT, 'src', 'demos'))).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

const browser = await chromium.launch();
// Block the map embeds: they are slow and irrelevant to a layout capture.
const prep = async (ctx) => ctx.route(/google\.com\/maps/, (r) => r.abort());

// Force lazy images to load and wait until every image has decoded.
const settle = async (page) => {
  await page.evaluate(async () => {
    const imgs = [...document.images];
    imgs.forEach((i) => { i.loading = 'eager'; });
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
    await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
  });
  await page.waitForTimeout(400);
};

if (args.includes('--present')) {
  // Shareable full-page captures (desktop + phone) in ./previews
  const out = path.join(ROOT, 'previews');
  await mkdir(out, { recursive: true });
  for (const slug of slugs) {
    const url = slug === 'index' ? `${base}/` : `${base}/${slug}/`;
    for (const [label, opts] of [['desktop', { viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1.5 }], ['phone', { viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
      const ctx = await browser.newContext(opts);
      await prep(ctx);
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.addStyleTag({ content: '.callbar{display:none!important}' });
      await settle(page);
      const png = await page.screenshot({ fullPage: true, type: 'png' });
      await sharp(png).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(out, `${slug}-${label}.jpg`));
      await ctx.close();
    }
    console.log(`${slug}: previews saved`);
  }
} else if (review) {
  const out = path.join(ROOT, '.cache', 'review');
  await mkdir(out, { recursive: true });
  for (const slug of slugs) {
    const url = slug === 'index' ? `${base}/` : `${base}/${slug}/`;
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    await prep(desktop);
    let page = await desktop.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await settle(page);
    await page.screenshot({ path: path.join(out, `${slug}-desktop.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await prep(mobile);
    page = await mobile.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await settle(page);
    await page.screenshot({ path: path.join(out, `${slug}-mobile.png`), fullPage: true });
    const mOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await mobile.close();
    console.log(`${slug}: review captures saved (horizontal overflow desktop ${overflow}px, mobile ${mOverflow}px)`);
  }
} else {
  await mkdir(path.join(ROOT, 'public', 'shots'), { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  await prep(ctx);
  for (const slug of slugs) {
    const page = await ctx.newPage();
    await page.goto(`${base}/${slug}/`, { waitUntil: 'load' });
    // Hide the preview bar so the thumbnail shows the design itself.
    await page.addStyleTag({ content: '.concept{display:none!important}' });
    await settle(page);
    const png = await page.screenshot({ type: 'png' });
    await sharp(png).resize(1120).jpeg({ quality: 74, mozjpeg: true }).toFile(path.join(ROOT, 'public', 'shots', `${slug}-after.jpg`));
    await page.close();
    console.log(`${slug}: after thumbnail saved`);
  }
}
await browser.close();
server.close();
