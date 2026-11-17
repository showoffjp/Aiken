// Make 640px and 960px-wide copies of every large concept photo so galleries
// and phones download a file sized for the screen instead of the full-size one.
// (A typical phone needs about 700 device pixels for a full-width photo, so
// 960 fills the gap between 640 and the original.) Safe to re-run.
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
    if (!/\.webp$/.test(f) || /-(640|960)\.webp$/.test(f)) continue;
    const src = path.join(base, dir, f);
    const meta = await sharp(src).metadata();
    for (const w of [640, 960]) {
      if (meta.width <= w + 120) continue;
      const name = f.replace(/\.webp$/, `-${w}.webp`);
      const out = path.join(base, dir, name);
      if (await stat(out).catch(() => null)) continue;
      const info = await sharp(src).resize({ width: w }).webp({ quality: w === 640 ? 74 : 76 }).toFile(out);
      sizes[`/demo-assets/${dir}/${name}`] = [info.width, info.height];
      saved += (await stat(src)).size - info.size;
      made++;
    }
  }
}
await writeFile(sizesFile, JSON.stringify(sizes, null, 1));
console.log(`variants: ${made} made, ${(saved / 1048576).toFixed(1)} MB smaller in total`);
