// Build the link-preview image for the portfolio index (public/og.jpg).
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(ROOT, 'public', 'shots');
const want = ['howell-printing', 'beech-island-timber', 'inn-at-houndslake'];
const have = (await readdir(shots)).filter((f) => f.endsWith('-after.jpg'));
const picks = want.map((w) => `${w}-after.jpg`).filter((f) => have.includes(f)).concat(have).slice(0, 3);

const W = 1200, H = 630, tw = 352, th = 237;
const rounded = Buffer.from(`<svg width="${tw}" height="${th}"><rect width="${tw}" height="${th}" rx="14" ry="14"/></svg>`);
const tiles = await Promise.all(picks.map(async (f, i) => ({
  input: await sharp(path.join(shots, f)).resize(tw, th, { fit: 'cover', position: 'top' }).composite([{ input: rounded, blend: 'dest-in' }]).png().toBuffer(),
  left: 56 + i * (tw + 16), top: H - th - 56,
})));
const text = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#143d2f"/>
  <text x="56" y="118" font-family="DejaVu Sans, Arial, sans-serif" font-size="25" font-weight="700" letter-spacing="3" fill="#9fd1bb">WEBSITE CONCEPTS · AIKEN, SOUTH CAROLINA</text>
  <text x="56" y="204" font-family="DejaVu Sans, Arial, sans-serif" font-size="66" font-weight="700" fill="#f3e9c9">Your business is better</text>
  <text x="56" y="282" font-family="DejaVu Sans, Arial, sans-serif" font-size="66" font-weight="700" fill="#ffffff">than its website.</text>
</svg>`);
await sharp(text).composite(tiles).jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(ROOT, 'public', 'og.jpg'));
console.log(`og.jpg written with ${picks.length} thumbnails`);
