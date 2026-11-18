// Small WebP copies of the concept thumbnails for the home page's showcase wall.
//   node scripts/thumbs.mjs   (run after scripts/shots.mjs)
// public/shots/<slug>-after.jpg -> public/shots/thumbs/<slug>.webp (440px wide)
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'public', 'shots');
const OUT = path.join(SHOTS, 'thumbs');
await mkdir(OUT, { recursive: true });
const files = (await readdir(SHOTS)).filter((f) => f.endsWith('-after.jpg'));
let bytes = 0;
for (const f of files) {
  const info = await sharp(path.join(SHOTS, f)).resize(440).webp({ quality: 68 }).toFile(path.join(OUT, f.replace('-after.jpg', '.webp')));
  bytes += info.size;
}
console.log(`thumbs: ${files.length} written, average ${Math.round(bytes / files.length / 1024)} KB`);
