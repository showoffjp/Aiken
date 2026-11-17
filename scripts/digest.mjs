// Prepare everything needed to redesign one business's website:
//   1. crawl a handful of its pages and boil them down to plain text
//   2. download its images and build a numbered contact sheet
//   3. take a "before" screenshot of the live home page
// Usage: node scripts/digest.mjs <slug> [<slug> ...]
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { fetchUrl, pool, decode, CACHE_DIR } from './lib/http.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(CACHE_DIR, '..');
const audit = JSON.parse(await readFile(path.join(ROOT, 'data', 'audit.json'), 'utf8'));
const businesses = JSON.parse(await readFile(path.join(ROOT, 'data', 'businesses.json'), 'utf8'));
const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const noShot = process.argv.includes('--no-shot');
const MAX_PAGES = 12;
const PRIORITY = /about|service|menu|contact|hour|product|galler|photo|histor|staff|team|faq|pric|rate|special|room|suite|portfolio|project|testimon|review|location|catering|party|league|bowl|policy/i;
const SKIP_LINK = /\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|mp4|mov|webp|svg)(\?|$)|mailto:|tel:|javascript:|#|\/(wp-admin|wp-login|cart|checkout|my-account|feed|tag|category|author)\b|\?(replytocom|share|add-to-cart)/i;

function blocks(html) {
  // Old hand-edited pages often have content outside <body>, so drop the
  // <head> instead of trusting the body tags.
  const body = html.replace(/<head\b[\s\S]*?<\/head>/i, ' ')
    .replace(/<(script|style|noscript|svg|iframe|select|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const marked = body
    .replace(/<h([1-4])\b[^>]*>/gi, '\n\n#$1 ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/tr|\/h[1-6]|\/li|\/td|\/th|\/section|\/article|\/table|\/ul|\/ol|\/dd|\/dt|\/blockquote|\/address|\/figcaption)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(marked).split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter((l) => l.length > 1);
}

function imagesIn(html, base) {
  const out = [];
  const push = (src, alt = '') => {
    if (!src || /^data:/i.test(src)) return;
    try {
      const u = new URL(decode(src.trim()), base);
      if (!/^https?:$/.test(u.protocol)) return;
      if (/spacer|pixel|blank|clear\.gif|bullet|arrow|icon|sprite|loader|loading|button|btn|facebook|twitter|instagram|youtube|linkedin|pinterest|yelp|tripadvisor|google|badge|bbb|visa|mastercard|paypal|gravatar|emoji|captcha|counter|\.svg(\?|$)|1x1/i.test(u.pathname)) return;
      out.push({ url: fullSize(u.href), alt: decode(alt).trim().slice(0, 80) });
    } catch {}
  };
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = (tag.match(/\s(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/i) || [])[1];
    const srcset = (tag.match(/\ssrcset=["']([^"']+)["']/i) || [])[1];
    const biggest = srcset ? srcset.split(',').map((s) => s.trim().split(/\s+/)).sort((a, b) => parseInt(b[1] || 0) - parseInt(a[1] || 0))[0]?.[0] : '';
    push(biggest || src, (tag.match(/\salt=["']([^"']*)["']/i) || [])[1]);
  }
  for (const m of html.matchAll(/background(?:-image)?\s*[:=]\s*["']?\s*url\(\s*["']?([^"')]+)/gi)) push(m[1], 'background');
  for (const m of html.matchAll(/<(?:td|table|body|div)\b[^>]*\sbackground=["']([^"']+)["']/gi)) push(m[1], 'background');
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+\.(?:jpe?g|png|webp))["']/gi)) push(m[1], 'linked full-size');
  return out;
}

// Site builders serve resized thumbnails; ask for the original instead.
function fullSize(url) {
  const wix = url.match(/^(https?:\/\/static\.wixstatic\.com\/media\/[^/]+)\/v1\//);
  if (wix) return wix[1];
  const sq = url.match(/^(https?:\/\/images\.squarespace-cdn\.com\/[^?]+)\?/);
  if (sq) return `${sq[1]}?format=2500w`;
  const ems = url.match(/^(https?:\/\/[^?]*editmysite\.com\/[^?]+)\?/);
  if (ems) return `${ems[1]}?width=2400`;
  return url;
}

function download(url, file) {
  return new Promise((resolve) => {
    execFile('curl', ['-sS', '-L', '-m', '30', '--max-filesize', '12000000', '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', '-o', file, url], { timeout: 40000 }, (err) => resolve(!err));
  });
}

async function renderCrawl(start, host, max = 7) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const out = { pages: [], images: [] };
  const queue = [{ url: start, label: 'Home (rendered)' }];
  const seen = new Set([start.replace(/\/$/, '')]);
  while (queue.length && out.pages.length < max) {
    const { url, label } = queue.shift();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 35000 });
      await page.waitForTimeout(2500);
      // Scroll through the page so lazy images and sections load.
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
      await page.waitForTimeout(800);
      const data = await page.evaluate(() => {
        const text = document.body.innerText || '';
        const imgs = [];
        for (const i of document.images) {
          const src = i.currentSrc || i.src;
          if (src && i.naturalWidth >= 140) imgs.push({ url: src, alt: (i.alt || '').slice(0, 80) });
        }
        for (const el of document.querySelectorAll('[style*="background"], section, div[class*="bg"], div[class*="background"]')) {
          const m = getComputedStyle(el).backgroundImage.match(/url\(["']?([^"')]+)/);
          if (m && !m[1].startsWith('data:')) imgs.push({ url: m[1], alt: 'background' });
        }
        const links = [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.href, text: (a.innerText || '').trim().slice(0, 40) }));
        return { text, imgs, links, title: document.title };
      });
      out.pages.push({ url: page.url(), label, title: data.title, lines: data.text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 1) });
      for (const i of data.imgs) out.images.push({ ...i, url: fullSize(i.url), page: label });
      for (const l of data.links) {
        try {
          const u = new URL(l.href); u.hash = '';
          const k = u.href.replace(/\/$/, '');
          if (u.hostname.replace(/^www\./, '') !== host || seen.has(k) || SKIP_LINK.test(u.href)) continue;
          seen.add(k);
          queue.push({ url: u.href, label: `${l.text || u.pathname} (rendered)` });
        } catch {}
      }
    } catch {}
  }
  await browser.close();
  return out;
}

async function digest(slug) {
  const a = audit[slug];
  const biz = businesses.find((b) => b.slug === slug);
  if (!a || !biz) { console.log(`${slug}: not in audit`); return; }
  const start = a.finalUrl || a.url;
  const host = new URL(start).hostname.replace(/^www\./, '');
  const outDir = path.join(CACHE_DIR, 'digests', slug);
  await mkdir(path.join(outDir, 'img'), { recursive: true });

  // ---- crawl
  const queue = [{ url: start, label: 'Home', pri: 99 }];
  const seenUrl = new Set([start.replace(/\/$/, '')]);
  const seenLine = new Set();
  const pages = [];
  const images = new Map();
  while (queue.length && pages.length < MAX_PAGES) {
    queue.sort((x, y) => y.pri - x.pri);
    const { url, label } = queue.shift();
    const res = await fetchUrl(url, { bucket: 'crawl', timeout: 25 });
    if (!res.ok || !/html/i.test(res.contentType || 'html')) continue;
    let html = res.body;
    // Frames-era sites: pull the framed documents in as extra pages.
    for (const f of html.matchAll(/<i?frame\b[^>]*\ssrc=["']([^"']+)["']/gi)) {
      try { const fu = new URL(decode(f[1]), res.finalUrl); const k = fu.href.replace(/\/$/, ''); if (fu.hostname.replace(/^www\./, '') === host && !seenUrl.has(k)) { seenUrl.add(k); queue.push({ url: fu.href, label: 'frame', pri: 90 }); } } catch {}
    }
    const lines = blocks(html).filter((l) => { const k = l.toLowerCase(); if (seenLine.has(k)) return false; seenLine.add(k); return true; });
    pages.push({ url: res.finalUrl, label, title: decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim(), lines });
    for (const img of imagesIn(html, res.finalUrl)) if (!images.has(img.url)) images.set(img.url, { ...img, page: label });
    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (SKIP_LINK.test(m[1])) continue;
      try {
        const u = new URL(decode(m[1]), res.finalUrl);
        u.hash = '';
        const k = u.href.replace(/\/$/, '');
        if (u.hostname.replace(/^www\./, '') !== host || seenUrl.has(k)) continue;
        seenUrl.add(k);
        const text = decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 40);
        queue.push({ url: u.href, label: text || u.pathname, pri: PRIORITY.test(u.pathname + ' ' + text) ? 50 : 10 - u.pathname.split('/').length });
      } catch {}
    }
  }

  // ---- sites built in the browser (Wix, Square Online, ...) show almost no
  // text to a plain fetch: render them in Chromium and read the result.
  const textChars = pages.reduce((n, p) => n + p.lines.join('\n').length, 0);
  if (textChars < 1500 || process.argv.includes('--render')) {
    const rendered = await renderCrawl(start, host);
    for (const p of rendered.pages) {
      const lines = p.lines.filter((l) => { const k = l.toLowerCase(); if (seenLine.has(k)) return false; seenLine.add(k); return true; });
      pages.push({ ...p, lines });
    }
    for (const img of rendered.images) if (!images.has(img.url)) images.set(img.url, img);
  }

  // ---- images: download, measure, keep the ones worth using
  const kept = [];
  await pool([...images.values()].slice(0, 70), 6, async (img, i) => {
    // Name by URL so a re-run reuses images that were already downloaded.
    const tmp = path.join(outDir, 'img', createHash('sha1').update(img.url).digest('hex').slice(0, 16));
    if (!existsSync(tmp) && !(await download(img.url, tmp))) return;
    try {
      const meta = await sharp(tmp).metadata();
      if (!meta.width || meta.width < 140 || meta.height < 90 || meta.format === 'heif') return;
      await sharp(tmp).resize(32).toBuffer(); // make sure it actually decodes
      kept.push({ ...img, i, w: meta.width, h: meta.height, format: meta.format, file: tmp });
    } catch {}
  });
  kept.sort((x, y) => y.w * y.h - x.w * x.h);
  const top = kept.slice(0, 36).map((k, n) => ({ ...k, n: n + 1 }));

  // ---- contact sheet (numbered thumbnails) so the images can be reviewed at a glance
  if (top.length) {
    const cell = 220, pad = 8, cols = 6, rows = Math.ceil(top.length / cols);
    const composites = [];
    for (const [idx, t] of top.entries()) {
      const thumb = await sharp(t.file).resize(cell, cell, { fit: 'contain', background: '#e9e9e9' }).flatten({ background: '#e9e9e9' }).jpeg({ quality: 70 }).toBuffer();
      const left = pad + (idx % cols) * (cell + pad), topPx = pad + Math.floor(idx / cols) * (cell + pad);
      composites.push({ input: thumb, left, top: topPx });
      const label = Buffer.from(`<svg width="${cell}" height="26" xmlns="http://www.w3.org/2000/svg"><rect width="${cell}" height="26" fill="#111" opacity=".78"/><text x="6" y="18" font-family="sans-serif" font-size="14" font-weight="700" fill="#fff">${t.n} · ${t.w}×${t.h}</text></svg>`);
      composites.push({ input: label, left, top: topPx });
    }
    await sharp({ create: { width: pad + cols * (cell + pad), height: pad + rows * (cell + pad), channels: 3, background: '#ffffff' } })
      .composite(composites).jpeg({ quality: 72 }).toFile(path.join(outDir, 'sheet.jpg'));
  }

  // ---- text digest
  let text = `# ${biz.name}\nsite: ${start}\nlisted: ${biz.address} | ${biz.phone} | ${biz.email || '-'} | categories: ${biz.categories.join(', ')}\naudit: score ${a.score}; ${a.findings.slice(0, 6).join('; ')}\nemails on site: ${(a.emails || []).join(', ') || '-'} | phones: ${(a.phones || []).join(', ') || '-'} | fb: ${a.facebook || biz.social || '-'}\n`;
  for (const p of pages) {
    const body = p.lines.join('\n');
    if (body.length < 30) continue;
    text += `\n\n=== ${p.label} — ${p.url}\n[title] ${p.title}\n${body.slice(0, 2600)}`;
  }
  text += `\n\n=== IMAGES (${top.length} kept of ${images.size} found)\n` + top.map((t) => `${t.n}. ${t.w}x${t.h} ${t.format} [${t.page}] ${t.alt ? `"${t.alt}" ` : ''}${t.url}`).join('\n');
  await writeFile(path.join(outDir, 'digest.txt'), text);
  await writeFile(path.join(outDir, 'images.json'), JSON.stringify(top.map(({ file, ...rest }) => ({ ...rest, file: path.relative(ROOT, file) })), null, 1));

  // ---- "before" screenshot
  let shot = 'skipped';
  if (!noShot) {
    try {
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      await page.goto(start, { timeout: 35000, waitUntil: 'load' }).catch(() => {});
      await page.waitForTimeout(1800);
      const png = await page.screenshot({ type: 'png' });
      await browser.close();
      await mkdir(path.join(ROOT, 'public', 'shots'), { recursive: true });
      await sharp(png).resize(1120).jpeg({ quality: 72, mozjpeg: true }).toFile(path.join(ROOT, 'public', 'shots', `${slug}-before.jpg`));
      shot = 'ok';
    } catch (e) { shot = `failed: ${String(e).split('\n')[0].slice(0, 80)}`; }
  }
  console.log(`${slug}: ${pages.length} pages, ${text.length} chars, ${top.length} images, screenshot ${shot}`);
}

for (const slug of slugs) await digest(slug);
