// Can a customer call from the first screen, and read the page on a phone?
// Loads each home page as an iPhone sees it and records whether a tap-to-call
// link and the phone number itself are visible before any scrolling (a number
// tucked inside a closed menu does not count), whether the page scrolls
// sideways, how much of its text is under 12px and how many links and buttons
// are under 24px. Results merge into data/firstscreen.json:
//   { "<slug>": { "site": { call, number, overflow, tinyText, targets, smallTargets, at }, "concept": {...} } }
//
//   node scripts/firstscreen.mjs --sites [slug ...]      current sites of businesses with a concept
//   node scripts/firstscreen.mjs --concepts [slug ...]   built concepts (serves ./dist locally)
import { createServer } from 'node:http';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'firstscreen.json');

const args = process.argv.slice(2);
const mode = args.includes('--concepts') ? 'concept' : 'site';
const only = args.filter((a) => !a.startsWith('--'));
const results = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));

const demos = [];
for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json'))) demos.push(JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8')));
const digits = (p = '') => p.replace(/\D/g, '').slice(-10);

let targets = [];
let server;
if (mode === 'site') {
  const audit = JSON.parse(await readFile(path.join(ROOT, 'data', 'audit.json'), 'utf8'));
  const bySlug = new Map(Object.values(audit).map((a) => [a.slug, a]));
  for (const d of demos) {
    const key = d.prospect || d.slug;
    const a = bySlug.get(key);
    if (!a || a.state !== 'ok' || d.source.none) continue;
    if (only.length && !only.includes(d.slug) && !only.includes(key)) continue;
    targets.push({ key, url: a.finalUrl || a.url, phone: digits(d.contact.phone) });
  }
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
  for (const d of demos) {
    if (only.length && !only.includes(d.slug)) continue;
    if (!d.contact.phone) continue;
    targets.push({ key: d.prospect || d.slug, url: `${base}/${d.slug}/`, phone: digits(d.contact.phone) });
  }
}
console.log(`firstscreen: checking ${targets.length} ${mode} pages`);

// Runs in the page: what a visitor can see and tap without scrolling.
function firstScreen(phone) {
  const H = innerHeight, W = innerWidth;
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) return false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    }
    // Not hidden under something else (a closed drawer, a cover photo).
    const x = Math.min(Math.max(r.left + r.width / 2, 1), W - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), H - 1);
    const hit = document.elementFromPoint(x, y);
    return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
  };
  const call = [...document.querySelectorAll('a[href^="tel:"]')].some(shown);
  let number = false;
  if (phone.length === 10) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && !number; n = walker.nextNode()) {
      if (n.textContent.replace(/\D/g, '').includes(phone.slice(3)) && n.parentElement && shown(n.parentElement)) number = true;
    }
  }
  return { call, number };
}

// Runs in the page: can the whole page be read and used on a phone? Measures
// sideways scrolling, the share of visible text under 12px (the old Lighthouse
// legibility line) and links/buttons smaller than 24px (WCAG 2.2 target size;
// links inside a sentence don't count).
async function readable() {
  const pause = () => new Promise((r) => setTimeout(r, 1200));
  await pause();
  const W = innerWidth;
  // A page with no mobile viewport is laid out ~980px wide and shrunk to fit
  // the phone, so its text and buttons look smaller than their CSS sizes.
  // A page that declares width=device-width is drawn at phone width (any
  // overflow shows up in the sideways check instead).
  const vp = document.querySelector('meta[name="viewport"]')?.content || '';
  const scale = /width\s*=\s*device-width/i.test(vp) ? 1 : Math.min(1, screen.width / W);
  const doc = document.documentElement;
  // Wider than the screen, and a visitor can actually drag it sideways (a page
  // whose overflow is clipped doesn't count).
  // Checked twice, a moment apart, so a slideshow caught mid-slide doesn't count.
  const sideways = () => {
    if (Math.max(doc.scrollWidth, document.body?.scrollWidth || 0) <= W + 4) return false;
    const y = scrollY;
    scrollTo(60, y);
    const moved = scrollX > 4;
    scrollTo(0, y);
    return moved;
  };
  let overflow = sideways();
  if (overflow) { await pause(); overflow = sideways(); }
  const visible = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  let chars = 0, tiny = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.replace(/\s+/g, '');
    if (!text || !n.parentElement || /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(n.parentElement.tagName)) continue;
    if (!visible(n.parentElement)) continue;
    chars += text.length;
    if (parseFloat(getComputedStyle(n.parentElement).fontSize) * scale < 12) tiny += text.length;
  }
  let targets = 0, small = 0;
  for (const el of document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, [role="button"]')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.right < 0 || r.left > W) continue;
    targets++;
    if (r.width * scale >= 24 && r.height * scale >= 24) continue;
    // A link inside running text is exempt (WCAG's inline exception).
    const block = el.closest('p, li, td, dd, blockquote') || (getComputedStyle(el).display === 'inline' ? el.parentElement : null);
    if (el.tagName === 'A' && block && block.textContent.trim().length > el.textContent.trim().length + 20) continue;
    small++;
  }
  return { overflow, tinyText: chars ? Math.round((tiny / chars) * 100) : 0, targets, smallTargets: small };
}

const browser = await chromium.launch();
const at = new Date().toISOString().slice(0, 10);
let done = 0;
const queue = [...targets];
const work = async () => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.route(/google-analytics|googletagmanager|facebook\.net|doubleclick|hotjar/, (r) => r.abort());
  const page = await ctx.newPage();
  while (queue.length) {
    const t = queue.shift();
    try {
      await page.goto(t.url, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(2500);
      let r = { ...(await page.evaluate(firstScreen, t.phone)), ...(await page.evaluate(readable)) };
      // A page with no links or buttons at all is a bot check or a half-loaded
      // page, not the site: look once more, and skip it if it's still empty.
      if (mode === 'site' && !r.targets) {
        await page.goto(t.url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(4000);
        r = { ...(await page.evaluate(firstScreen, t.phone)), ...(await page.evaluate(readable)) };
        if (!r.targets) { console.log(`  ${++done}/${targets.length} ${t.key}: skipped, the page had no links or buttons (a bot check?)`); continue; }
      }
      (results[t.key] ||= {})[mode] = { ...r, at };
      console.log(`  ${++done}/${targets.length} ${t.key}: call ${r.call ? 'yes' : 'NO'}, number ${r.number ? 'yes' : 'no'}, sideways ${r.overflow ? 'YES' : 'no'}, tiny text ${r.tinyText}%, small targets ${r.smallTargets}/${r.targets}`);
    } catch (e) {
      console.log(`  ${++done}/${targets.length} ${t.key}: error ${e.message.split('\n')[0].slice(0, 80)}`);
    }
  }
  await ctx.close();
};
await Promise.all([work(), work(), work(), work()]);
await browser.close();
server?.close();
const sorted = Object.fromEntries(Object.keys(results).sort().map((k) => [k, results[k]]));
await writeFile(OUT, JSON.stringify(sorted, null, 1) + '\n');
const rows = Object.values(results).map((r) => r[mode]).filter(Boolean);
console.log(`${mode}: ${rows.length} checked; tap-to-call on the first screen: ${rows.filter((r) => r.call).length}, number shown: ${rows.filter((r) => r.number).length}`);
const measured = rows.filter((r) => r.targets != null);
console.log(`  sideways scrolling: ${measured.filter((r) => r.overflow).length}, over 25% tiny text: ${measured.filter((r) => r.tinyText > 25).length}, over 10% small targets: ${measured.filter((r) => r.targets && r.smallTargets / r.targets > 0.1).length} (of ${measured.length})`);
