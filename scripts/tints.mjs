// Average colour of every concept photo (src/lib/image-tints.json), shown as
// the photo's background while it loads, so a slow phone sees a tinted box
// in the photo's own colours instead of an empty one. Run after adding photos
// (scripts/assets.mjs): node scripts/tints.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sizes = JSON.parse(await readFile(path.join(ROOT, 'src/lib/image-sizes.json'), 'utf8'));
const out = {};
for (const src of Object.keys(sizes).filter((k) => !/-(640|960)\.webp$/.test(k)).sort()) {
  const file = path.join(ROOT, 'public', src);
  if (!existsSync(file)) continue; // listed in image-sizes.json but no longer published
  const img = sharp(file);
  const { isOpaque } = await img.stats();
  if (!isOpaque) continue; // cut-outs and logos keep a clear background
  const { data } = await img.resize(1, 1, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  out[src] = `#${[...data.subarray(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
await writeFile(path.join(ROOT, 'src/lib/image-tints.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`tints: ${Object.keys(out).length} photos`);
