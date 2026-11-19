// What a phone visitor actually sees while each page loads: today's site and
// its concept are opened on the same simulated mid-range phone and slow 4G
// connection Google's Lighthouse uses when it applies throttling (4x slower
// processor, 1.47 Mbps down, 562 ms latency), and the screen is recorded
// from the moment the address is entered. Frames at fixed moments go into one
// image per page for the checkup's "Watch both pages load" section.
//   node scripts/filmstrip.mjs [slug ...]       concept slugs (default: every concept with a site)
//   node scripts/filmstrip.mjs --missing         only pages without frames yet
// Writes public/filmstrips/<slug>-site.webp and -concept.webp, and
// data/filmstrip.json: { "<prospect slug>": { site: { first, frames }, concept: { ... } } }
import { createServer } from 'node:http';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'filmstrip.json');
const IMG = path.join(ROOT, 'public', 'filmstrips');
await mkdir(IMG, { recursive: true });

export const TIMES = [1000, 2000, 3000, 5000, 8000, 12000];
const W = 390, H = 844, FW = 200, FH = Math.round((H * FW) / W);
// Lighthouse's "applied" mobile throttling (lighthouse-core/config/constants.js).
const NET = { offline: false, latency: 562.5, downloadThroughput: (1474.56 * 1024) / 8, uploadThroughput: (675 * 1024) / 8, connectionType: 'cellular4g' };
const CPU = 4;
const UA = 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const results = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));
const audit = JSON.parse(await readFile(path.join(ROOT, 'data', 'audit.json'), 'utf8'));
const demos = [];
for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json'))) demos.push(JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8')));
let targets = demos.filter((d) => !d.source.none && audit[d.prospect || d.slug]?.state === 'ok' && (!only.length || only.includes(d.slug)));
if (args.includes('--missing')) targets = targets.filter((d) => !results[d.prospect || d.slug]?.site || !results[d.prospect || d.slug]?.concept);

// The concept is served the way Vercel serves it: gzip on text files.
// FILMSTRIP_DIST: serve a copy of the build, so a rebuild during a long run can't break it.
const DIST = process.env.FILMSTRIP_DIST || path.join(ROOT, 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
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

const browser = await chromium.launch();
const white = await sharp({ create: { width: FW, height: FH, channels: 3, background: '#ffffff' } }).png().toBuffer();

/** Record the screen from the moment the address is entered until the last checkpoint. */
async function record(url) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA, locale: 'en-US' });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', NET);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ at: f.metadata.timestamp * 1000, data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const t0 = Date.now();
  let error = null;
  page.goto(url, { waitUntil: 'commit', timeout: 30000 }).catch((e) => { error = String(e.message || e).split('\n')[0]; });
  const end = TIMES[TIMES.length - 1] + 400;
  while (Date.now() - t0 < end) await new Promise((r) => setTimeout(r, 200));
  await cdp.send('Page.stopScreencast').catch(() => {});
  await ctx.close();
  return { frames: frames.map((f) => ({ t: f.at - t0, data: f.data })).sort((a, b) => a.t - b.t), error };
}

/** Nothing worth calling content: one flat colour (blank, or just a background). */
async function isBlank(buf) {
  const { channels } = await sharp(buf).resize(60).stats();
  return channels.slice(0, 3).every((c) => c.stdev < 5);
}

async function strip(slug, side, rec) {
  const shots = [];
  for (const T of TIMES) {
    const f = rec.frames.filter((x) => x.t <= T).pop();
    const img = f ? await sharp(Buffer.from(f.data, 'base64')).resize(FW, FH, { fit: 'cover', position: 'top' }).png().toBuffer() : white;
    shots.push({ T, img, blank: f ? await isBlank(img) : true });
  }
  // First moment anything shows (to the frame), from every recorded frame.
  let first = null;
  for (const f of rec.frames) {
    if (f.t < 0) continue;
    if (!(await isBlank(await sharp(Buffer.from(f.data, 'base64')).resize(FW).png().toBuffer()))) { first = Math.round(f.t); break; }
  }
  await sharp({ create: { width: FW * TIMES.length, height: FH, channels: 3, background: '#ffffff' } })
    .composite(shots.map((s, i) => ({ input: s.img, left: i * FW, top: 0 })))
    .webp({ quality: 60 })
    .toFile(path.join(IMG, `${slug}-${side}.webp`));
  return { first, frames: shots.map((s) => ({ t: s.T, blank: s.blank })), at: new Date().toISOString().slice(0, 10) };
}

console.log(`filmstrip: ${targets.length} businesses`);
let n = 0;
for (const d of targets) {
  const key = d.prospect || d.slug;
  const out = { ...(results[key] || {}) };
  for (const [side, url] of [['site', audit[key].finalUrl || audit[key].url], ['concept', `${base}/${d.slug}/`]]) {
    const rec = await record(url);
    if (rec.error && !rec.frames.length) { out[side] = { error: rec.error.slice(0, 120), at: new Date().toISOString().slice(0, 10) }; continue; }
    out[side] = await strip(d.slug, side, rec);
  }
  results[key] = out;
  await writeFile(OUT, JSON.stringify(results, null, 1));
  const say = (s) => (s?.error ? `error ${s.error}` : s?.first == null ? 'nothing by 12 s' : `${(s.first / 1000).toFixed(1)} s`);
  console.log(`  ${++n}/${targets.length} ${d.slug}: today ${say(out.site)}, concept ${say(out.concept)}`);
}
await browser.close();
server.close();
