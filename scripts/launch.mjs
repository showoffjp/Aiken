// Launch mode, run after `astro build` (part of `npm run build`).
// With CLIENT=<concept slug> set, it turns dist/ into that business's own site:
//   1. moves the concept's page, app icons, manifest, offline worker and
//      contact card from dist/<slug>/ to the root of dist/;
//   2. drops everything that belongs to the portfolio (other concepts' photos,
//      screenshots, share cards, the work page, unused fonts);
//   3. checks every file the page asks for is there.
// Without CLIENT it does nothing, so the normal portfolio build is unchanged.
// See docs/LAUNCH.md.
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = (process.env.CLIENT || '').trim();
if (!slug) process.exit(0);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const own = path.join(DIST, slug);
if (!existsSync(path.join(own, 'index.html'))) {
  console.error(`launch: dist/${slug}/index.html is missing. Did the build run with CLIENT=${slug}?`);
  process.exit(1);
}

// 1. The business's page and its files move to the root (replacing the portfolio home page).
for (const f of readdirSync(own)) {
  const to = path.join(DIST, f);
  rmSync(to, { recursive: true, force: true });
  renameSync(path.join(own, f), to);
}
rmSync(own, { recursive: true, force: true });

// 2. Keep only what the business's pages use.
const read = (f) => readFileSync(path.join(DIST, f), 'utf8');
const pages = ['index.html', '404.html'].filter((f) => existsSync(path.join(DIST, f))).map(read).join('\n');
const css = existsSync(path.join(DIST, '_astro'))
  ? readdirSync(path.join(DIST, '_astro')).filter((f) => f.endsWith('.css')).map((f) => read(`_astro/${f}`)).join('\n')
  : '';
const used = `${pages}\n${css}`;
const keepRoot = new Set(['index.html', '404.html', 'robots.txt', 'sitemap.xml', 'sw.js', 'manifest.webmanifest', '_astro', 'fonts', 'demo-assets', 'shots']);
let removed = 0;
const drop = (p) => { rmSync(p, { recursive: true, force: true }); removed++; };
for (const f of readdirSync(DIST)) {
  // App icons and the contact card came from the concept folder; anything else
  // at the root is the portfolio's unless the page links to it.
  if (keepRoot.has(f) || /^icon-.*\.png$/.test(f) || f.endsWith('.vcf') || used.includes(`/${f}`)) continue;
  drop(path.join(DIST, f));
}
const prune = (dir, keep) => {
  const full = path.join(DIST, dir);
  if (!existsSync(full)) return;
  for (const f of readdirSync(full)) if (!keep(f)) drop(path.join(full, f));
};
prune('demo-assets', (f) => f === slug || used.includes(`/demo-assets/${f}/`));
prune('shots', (f) => f === `${slug}-after.jpg`); // the link preview image
prune('fonts', (f) => used.includes(`/fonts/${f}`));

// 3. Every file the page asks for must exist (Vercel serves its own analytics script).
const asked = new Set();
for (const m of pages.matchAll(/(?:src|href)="(\/[^"#?]*)"/g)) asked.add(m[1]);
for (const m of pages.matchAll(/srcset="([^"]+)"/g)) for (const part of m[1].split(',')) asked.add(part.trim().split(/\s+/)[0]);
const missing = [...asked].filter((u) => u.startsWith('/') && !u.startsWith('/_vercel/') && u !== '/' && !existsSync(path.join(DIST, decodeURIComponent(u))));
if (missing.length) {
  console.error(`launch: ${missing.length} files the page links to are missing:\n  ${missing.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
const size = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((t, f) => t + size(path.join(p, f)), 0) : statSync(p).size);
console.log(`launch: ${slug} is now the site at dist/ (${(size(DIST) / 1e6).toFixed(1)} MB, ${removed} portfolio files and folders removed, ${asked.size} links checked)`);
