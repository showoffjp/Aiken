// Pick images from a site's digest (by contact-sheet number) and publish
// optimised copies for its concept page.
// Usage: node scripts/assets.mjs <prospect-slug> <demo-slug> 1=forest 5=truck ...
//   Append ":w" to cap the width, e.g. 34=owner:600
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { CACHE_DIR } from './lib/http.mjs';

const ROOT = path.resolve(CACHE_DIR, '..');
const [prospect, demo, ...picks] = process.argv.slice(2);
if (!prospect || !demo || !picks.length) { console.error('usage: assets.mjs <prospect-slug> <demo-slug> <n>=<name>[:maxWidth] ...'); process.exit(1); }

const images = JSON.parse(await readFile(path.join(CACHE_DIR, 'digests', prospect, 'images.json'), 'utf8'));
const outDir = path.join(ROOT, 'public', 'demo-assets', demo);
await mkdir(outDir, { recursive: true });
const sizesFile = path.join(ROOT, 'src', 'lib', 'image-sizes.json');
const sizes = JSON.parse(await readFile(sizesFile, 'utf8').catch(() => '{}'));

for (const pick of picks) {
  const [n, rest] = pick.split('=');
  // name[:maxWidth][:trim] -- "trim" crops a solid border baked into the photo
  const [name, ...flags] = rest.split(':');
  const max = flags.find((f) => /^\d+$/.test(f));
  const trim = flags.includes('trim');
  const img = images.find((i) => i.n === Number(n));
  if (!img) { console.log(`  #${n}: not found`); continue; }
  let source = path.join(ROOT, img.file);
  if (trim) source = await sharp(source).rotate().trim({ threshold: 60 }).toBuffer();
  const input = sharp(source, { animated: false }).rotate();
  const meta = await input.metadata();
  const keepPng = meta.hasAlpha; // logos with transparency stay lossless-ish
  const width = Math.min(meta.width, Number(max) || 1600);
  const file = `${name}.${keepPng ? 'png' : 'webp'}`;
  const pipeline = input.resize({ width, withoutEnlargement: true });
  const info = await (keepPng ? pipeline.png({ compressionLevel: 9, palette: true }) : pipeline.webp({ quality: 80 })).toFile(path.join(outDir, file));
  sizes[`/demo-assets/${demo}/${file}`] = [info.width, info.height];
  console.log(`  /demo-assets/${demo}/${file}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)}kB`);
}
await writeFile(sizesFile, JSON.stringify(sizes, null, 1));
