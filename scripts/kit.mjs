// Package the outreach kit as files small enough to download one at a time
// (the Claude app refuses large downloads; a single 300 MB zip is useless).
//
//   node scripts/kit.mjs   (after `npm run outreach` and `npm run print`)
//
// Writes previews/kit/ (gitignored):
//   1-outreach-drafts-and-contacts.zip  every draft, the contact lists and the prospect spreadsheet
//   2..n-leave-behinds-A-to-F.zip       the printable one-page leave-behinds, split A–Z
// Leave-behinds are recompressed with Ghostscript (150 dpi, still sharp on paper) when it is
// installed; otherwise they are packed as they are, in more parts. Every part stays under
// PART_MB. The full checkup and SEO PDFs are not packed: each live report page prints itself.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTREACH = path.join(ROOT, 'outreach');
const ONE_PAGE = path.join(OUTREACH, 'print', 'one-page');
const OUT = path.join(ROOT, 'previews', 'kit');
const PART_MB = 8;

if (!existsSync(OUTREACH)) throw new Error('No outreach/ folder: run `npm run outreach` and `npm run print` first.');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const zip = (name, cwd, files) => execFileSync('zip', ['-q9', path.join(OUT, name), ...files], { cwd });
const mb = (f) => statSync(f).size / 1e6;

// 1. Drafts and contact lists (text, well under a megabyte zipped).
copyFileSync(path.join(ROOT, 'data', 'prospects.csv'), path.join(OUTREACH, 'prospects.csv'));
try {
  zip('1-outreach-drafts-and-contacts.zip', OUTREACH, readdirSync(OUTREACH).filter((f) => /\.(md|csv)$/.test(f)));
} finally { rmSync(path.join(OUTREACH, 'prospects.csv'), { force: true }); }

// 2. One-page leave-behinds, recompressed when Ghostscript is available.
let src = ONE_PAGE, squeezed = false;
const pdfs = existsSync(ONE_PAGE) ? readdirSync(ONE_PAGE).filter((f) => f.endsWith('.pdf')).sort() : [];
let gs = null;
try { execFileSync('gs', ['--version'], { stdio: 'ignore' }); gs = 'gs'; } catch {}
if (gs && pdfs.length) {
  src = path.join(OUT, '.one-page');
  mkdirSync(src);
  for (const f of pdfs) {
    execFileSync(gs, ['-q', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dPDFSETTINGS=/ebook', '-dColorImageResolution=150', '-dNOPAUSE', '-dBATCH', `-sOutputFile=${path.join(src, f)}`, path.join(ONE_PAGE, f)]);
  }
  squeezed = true;
}
// Even parts in name order, so each covers a letter range and none is a tiny leftover.
const total = pdfs.reduce((t, f) => t + mb(path.join(src, f)), 0);
const n = Math.max(1, Math.ceil(total / PART_MB)), per = Math.ceil(pdfs.length / n);
const groups = [];
for (let i = 0; i < pdfs.length; i += per) groups.push(pdfs.slice(i, i + per));
groups.forEach((g, i) => {
  const a = g[0][0].toUpperCase(), b = g[g.length - 1][0].toUpperCase();
  zip(`${i + 2}-leave-behinds-${a === b ? a : `${a}-to-${b}`}.zip`, src, g);
});
if (squeezed) rmSync(src, { recursive: true, force: true });

const parts = readdirSync(OUT).filter((f) => f.endsWith('.zip')).sort((x, y) => parseInt(x) - parseInt(y));
console.log(`kit: ${parts.length} parts in previews/kit${squeezed ? '' : ' (Ghostscript not installed: leave-behinds not recompressed)'}`);
for (const p of parts) console.log(`  ${p}  ${mb(path.join(OUT, p)).toFixed(1)} MB`);
const big = parts.filter((p) => mb(path.join(OUT, p)) > 9);
if (big.length) { console.error(`kit: over 9 MB, may not download: ${big.join(', ')}`); process.exitCode = 1; }
