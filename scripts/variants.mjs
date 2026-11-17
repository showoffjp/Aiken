// Make a 640px-wide copy of every large concept photo so galleries and phones
// download a small file instead of the full-size one. Safe to re-run.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(ROOT, 'public', 'demo-assets');
const sizesFile = path.join(ROOT, 'src', 'lib', 'image-sizes.json');
const sizes = JSON.parse(await readFile(sizesFile, 'utf8'));
let made = 0, saved = 0;
for (const dir of await readdir(base)) {
  for (const f of await readdir(path.join(base, dir))) {
    if (!/\.webp$/.test(f) || /-640\.webp$/.test(f)) continue;
    const src = path.join(base, dir, f);
    const meta = await sharp(src).metadata();
    if (meta.width <= 760) continue;
    const out = src.replace(/\.webp$/, '-640.webp');
    const exists = await stat(out).catch(() => null);
    if (!exists) {
      const info = await sharp(src).resize({ width: 640 }).webp({ quality: 74 }).toFile(out);
      sizes[`/demo-assets/${dir}/${f.replace(/\.webp$/, '-640.webp')}`] = [info.width, info.height];
      saved += (await stat(src)).size - info.size;
      made++;
    }
  }
}
await writeFile(sizesFile, JSON.stringify(sizes, null, 1));
console.log(`variants: ${made} made, ${(saved / 1048576).toFixed(1)} MB smaller in total`);
