// Spelling check of each business's current website: every word on the pages
// the digest crawled (scripts/digest.mjs) is compared with a list of about
// 4,300 common English misspellings (scripts/lib/misspellings.txt). Also
// flags a word typed twice ("the the") and sample text a website template
// left behind ("Lorem ipsum ..."). Names and specialist words are never
// guessed at, so everything reported is a known misspelling.
//
// Usage: node scripts/typos.mjs [<slug> ...] [--fresh]
//   With no slugs it checks every concept that has a website today.
//   --fresh fetches the pages again instead of reusing the last copy.
// Writes data/typos.json: { <prospect slug>: { at, pages, found: [...] } }
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fetchUrl, pool, decode, CACHE_DIR } from './lib/http.mjs';
import { blocks } from './lib/text.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(CACHE_DIR, '..');
const OUT = path.join(ROOT, 'data', 'typos.json');
const fresh = process.argv.includes('--fresh');
const asked = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// wrong -> right. A few entries offer more than one fix ("achive->achieve, archive").
const LIST = new Map();
// misspellings-local.txt adds slips found on local sites that the main list lacks.
const lists = await Promise.all(['misspellings.txt', 'misspellings-local.txt'].map((f) => readFile(path.join(ROOT, 'scripts', 'lib', f), 'utf8').catch(() => '')));
for (const line of lists.join('\n').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [wrong, right] = line.split('->');
  if (wrong && right) LIST.set(wrong.trim().toLowerCase(), right.split(',').map((s) => s.trim()).filter(Boolean));
}
// Words on the list that are also real names or trade terms in this area.
const ALLOW = new Set((await readFile(path.join(ROOT, 'scripts', 'lib', 'typo-allow.txt'), 'utf8').catch(() => ''))
  .split('\n').map((l) => l.replace(/#.*/, '').trim().toLowerCase()).filter(Boolean));

const SAMPLE = /lorem ipsum|dolor sit amet|consectetur adipisicing|Definitely promote it here|What's something exciting your business offers|This is your About section|Add a description (here|of your)|Click (here )?to edit (this )?text|Write a short (description|intro) here|It all begins with an idea\. Maybe you want to launch a business/i;
const DOUBLE = /\b(the|a|an|and|to|of|in|for|is|on|with|our|your|we|you|at|be|are|or|it|this|that)\s+\1\b/i;
// Customers' own words (reviews, testimonials) are theirs, not the business's
// to correct: skip first-person and quoted lines, and review pages.
const VOICE = /(^|[\s(])(I|I'm|I've|I'd|I'll|my|me|mine)([\s.,!?;:)]|$)/;
const QUOTED = /^["“'‘]|["”'’]\W{0,2}$/;
const REVIEWS = /review|testimonial|what (our )?(clients|customers|people) say/i;
const strip = (l) => l.replace(/\S+@\S+|https?:\/\/\S+|www\.\S+/g, ' ');

// Concepts and the site each one replaces.
const demos = [];
for (const f of await readdir(path.join(ROOT, 'src', 'demos'))) {
  if (!f.endsWith('.json')) continue;
  const d = JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8'));
  if (d.source?.none || !d.source?.url) continue;
  demos.push({ key: d.prospect || d.slug, name: d.name });
}
const targets = asked.length ? demos.filter((d) => asked.includes(d.key) || asked.includes(d.name)) : demos;
for (const a of asked) if (!targets.some((d) => d.key === a)) targets.push({ key: a, name: a });

// The pages the digest read: "=== <label> — <url>" headings.
async function pagesOf(key) {
  const file = path.join(CACHE_DIR, 'digests', key, 'digest.txt');
  if (!existsSync(file)) return [];
  const out = [];
  for (const m of (await readFile(file, 'utf8')).matchAll(/^=== (.+?) — (\S+)$/gm)) {
    if (!/^https?:/.test(m[2])) continue;
    out.push({ label: m[1].replace(/ \(rendered\)$/, ''), url: m[2], rendered: / \(rendered\)$/.test(m[1]) });
  }
  return out;
}

// One browser for every worker: launched on first use, shared after that.
let launching = null;
const getBrowser = () => (launching ||= require('playwright').chromium.launch());
async function rendered(url) {
  const page = await (await getBrowser()).newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 35000 });
    await page.waitForTimeout(2000);
    return { ok: true, html: await page.content(), finalUrl: page.url() };
  } catch { return { ok: false }; } finally { await page.close(); }
}

function check(lines, page, found) {
  const reviewPage = REVIEWS.test(`${page.label} ${page.url}`);
  for (const raw of lines) {
    const line = strip(raw.replace(/^#\d |^- /, ''));
    const theirs = reviewPage || VOICE.test(line) || QUOTED.test(line.trim());
    if (SAMPLE.test(line)) {
      const k = 'sample';
      add(found, k, { kind: 'sample', word: (line.match(SAMPLE) || [''])[0], fix: '' }, page, line.slice(0, 120));
    }
    if (theirs) continue;
    const dbl = line.match(DOUBLE);
    if (dbl) {
      const k = `double:${dbl[0].toLowerCase()}`;
      add(found, k, { kind: 'double', word: dbl[0], fix: dbl[1] }, page, around(line, dbl.index, dbl[0].length));
    }
    for (const m of line.matchAll(/[A-Za-z][A-Za-z']*[A-Za-z]/g)) {
      const w = m[0].replace(/'s$/i, '');
      const lw = w.toLowerCase();
      if (lw.length < 4 || !LIST.has(lw) || ALLOW.has(lw)) continue;
      const k = `spelling:${lw}`;
      add(found, k, { kind: 'spelling', word: w, fix: LIST.get(lw).map((f) => matchCase(w, f)).join(' or ') }, page, around(line, m.index, m[0].length));
    }
  }
}
// "Claims - LEGIS Equine" -> "Claims"; falls back to the link text the crawl followed.
function pageName(html, label, url, biz = '') {
  const t = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
  let name = (t.split(/\s[|\u2013\u2014-]\s/)[0] || '').trim();
  if (!name || name.length > 40 || /^(home|welcome)\b/i.test(name)) name = /^home\b/i.test(label) || !name ? (/^home\b/i.test(label) ? 'Home' : label) : name;
  // A title that is just the business's name says nothing about the page.
  const flat = (x) => x.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  if (biz && name && (flat(biz).startsWith(flat(name)) || flat(name).startsWith(flat(biz)))) name = name.split(' ').concat(Array(6).fill('x')).join(' ');
  if (name.split(' ').length > 5) {
    const seg = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean).pop() || '';
    name = seg ? seg.replace(/\.[a-z]+$/, '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Home';
  }
  if (/^\/?$/.test(new URL(url).pathname)) name = 'Home';
  if (name === name.toUpperCase()) name = name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Faq|Faqs)\b/g, (w) => w.toUpperCase());
  return name.slice(0, 40);
}
function add(found, k, item, page, context) {
  if (!found.has(k)) found.set(k, { ...item, count: 0, where: [] });
  const f = found.get(k);
  f.count++;
  if (f.where.length < 6 && !f.where.some((w) => w.page === page.url)) f.where.push({ page: page.url, label: page.label, context });
}
const matchCase = (w, f) => (w === w.toUpperCase() ? f.toUpperCase() : /^[A-Z]/.test(w) ? f.charAt(0).toUpperCase() + f.slice(1) : f);
function around(line, at, len) {
  const a = Math.max(0, line.lastIndexOf(' ', Math.max(0, at - 50)) + 1);
  let b = line.indexOf(' ', Math.min(line.length, at + len + 50));
  if (b < 0) b = line.length;
  return `${a > 0 ? '…' : ''}${line.slice(a, b).trim()}${b < line.length ? '…' : ''}`;
}

async function visible(items) {
  if (!items.length) return [];
  const browser = await getBrowser();
  const state = new Map(); // item -> { where, shown }
  for (const url of new Set(items.flatMap((i) => i.where.map((w) => w.page)))) {
    const here = items.filter((i) => !state.has(i) && i.where.some((w) => w.page === url));
    if (!here.length) continue;
    const page = await browser.newPage();
    let seen = null;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 40000 });
      await page.waitForTimeout(1500);
      seen = await page.evaluate((words) => {
        const nodes = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n; (n = walk.nextNode());) nodes.push(n);
        const shown = (el) => (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : !!el.getClientRects().length);
        const oneTap = (el) => !!el.closest('details, [class*="accordion" i], [class*="toggle" i], [class*="tab-content" i], [class*="tabs" i], [class*="faq" i], [class*="collapse" i], [role="tabpanel"]') && !el.closest('[class*="modal" i], [class*="popup" i], [class*="offcanvas" i], template');
        const flat = document.body.innerText.replace(/\s+/g, ' ');
        return words.map(({ word, kind }) => {
          const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
          const re = new RegExp(kind === 'sample' ? esc : `\\b${esc}\\b`, kind === 'sample' ? 'i' : '');
          let state = 'missing';
          for (const n of nodes) {
            if (!re.test(n.nodeValue)) continue;
            const el = n.parentElement;
            if (!el) continue;
            if (shown(el)) return 'visible';
            if (oneTap(el)) state = 'click';
            else if (state === 'missing') state = 'hidden';
          }
          if (state === 'missing' && re.test(flat)) return 'visible';
          return state;
        });
      }, here.map(({ word, kind }) => ({ word, kind })));
    } catch {} finally { await page.close(); }
    here.forEach((item, i) => {
      const s = seen ? seen[i] : 'unchecked';
      if (s === 'visible' || s === 'click') state.set(item, { ...item.where.find((w) => w.page === url), shown: s === 'click' ? 'after a click' : 'on screen' });
    });
  }
  return items.filter((i) => state.has(i)).map((item) => { const { where, ...rest } = item; return { ...rest, ...state.get(item), pages: where.length }; });
}

const data = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));
let done = 0;
await pool(targets, 6, async (t) => {
  const pages = await pagesOf(t.key);
  if (!pages.length) { console.log(`${t.key}: no digest (run scripts/digest.mjs first)`); return; }
  const found = new Map();
  const seen = new Set();
  let read = 0;
  for (const p of pages) {
    let html = '', finalUrl = p.url;
    if (p.rendered) {
      const r = await rendered(p.url);
      if (!r.ok) continue;
      html = r.html; finalUrl = r.finalUrl;
    } else {
      const r = await fetchUrl(p.url, { bucket: 'typos', timeout: 25, refresh: fresh });
      if (!r.ok || !/html/i.test(r.contentType || 'html')) continue;
      html = r.body; finalUrl = r.finalUrl || p.url;
    }
    const k = finalUrl.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (seen.has(k)) continue;
    seen.add(k);
    read++;
    check(blocks(html), { url: finalUrl, label: pageName(html, p.label, finalUrl, t.name) }, found);
  }
  // Only report what a visitor can see: open each page in a browser and keep a
  // word that is on screen or one tap away (an accordion, a tab, a details
  // box). Text in hidden templates and closed pop-ups is dropped.
  const list = await visible([...found.values()]);
  // Sample text first, then misspellings, then doubled words.
  const order = { sample: 0, spelling: 1, double: 2 };
  data[t.key] = { at: new Date().toISOString(), pages: read, found: list.sort((a, b) => order[a.kind] - order[b.kind] || b.count - a.count) };
  done++;
  const f = data[t.key].found;
  console.log(`${t.key}: ${read} pages, ${f.length ? f.map((x) => x.kind === 'sample' ? 'sample text' : `${x.word}→${x.fix || '(once)'}`).join(', ') : 'nothing found'}`);
});
if (launching) await (await launching).close();
await writeFile(OUT, JSON.stringify(data, null, 1));
console.log(`typos: checked ${done} site${done === 1 ? '' : 's'}; ${Object.values(data).filter((d) => d.found.length).length} of ${Object.keys(data).length} on file have something to fix`);
