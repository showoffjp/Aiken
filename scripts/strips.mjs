// Cut review captures (from shots.mjs --review) into strips that are easy to
// look over: N desktop slices and one sheet with the mobile page in columns.
// Usage: node scripts/strips.mjs <slug> [desktopParts]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'review');
const [slug, partsArg] = process.argv.slice(2);
const parts = Number(partsArg) || 3;

const desktop = path.join(dir, `${slug}-desktop.png`);
const dm = await sharp(desktop).metadata();
const slice = Math.ceil(dm.height / parts);
for (let i = 0; i < parts; i++) {
  const height = Math.min(slice, dm.height - i * slice);
  if (height <= 0) break;
  await sharp(desktop).extract({ left: 0, top: i * slice, width: dm.width, height }).resize(900).jpeg({ quality: 62 }).toFile(path.join(dir, `${slug}-d${i + 1}.jpg`));
}

const mobile = path.join(dir, `${slug}-mobile.png`);
const mm = await sharp(mobile).metadata();
const cols = 5, gap = 16, colH = Math.ceil(mm.height / cols);
const pieces = [];
for (let i = 0; i < cols; i++) {
  const height = Math.min(colH, mm.height - i * colH);
  if (height <= 0) break;
  pieces.push({ input: await sharp(mobile).extract({ left: 0, top: i * colH, width: mm.width, height }).png().toBuffer(), left: i * (mm.width + gap), top: 0 });
}
const sheet = await sharp({ create: { width: cols * (mm.width + gap) - gap, height: colH, channels: 3, background: '#777777' } }).composite(pieces).png().toBuffer();
await sharp(sheet).resize({ height: Math.min(colH, 2300) }).jpeg({ quality: 60 }).toFile(path.join(dir, `${slug}-m.jpg`));
console.log(`${slug}: desktop ${dm.width}x${dm.height} in ${parts} strips, mobile ${mm.width}x${mm.height}`);
