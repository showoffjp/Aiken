// A 1200x630 before/after card per concept: the image people see when the
// checkup link is shared by text, email or Facebook Messenger. Also handy to
// attach to a message on its own.  -> public/cards/<slug>.jpg
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'public', 'shots');
const OUT = path.join(ROOT, 'public', 'cards');
await mkdir(OUT, { recursive: true });
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wanted = process.argv.slice(2);
// What a visitor meets at a broken address, in the card's words (from the prospect export).
const prospects = JSON.parse(await readFile(path.join(ROOT, 'data', 'prospects.json'), 'utf8').catch(() => '[]'));
const stateOf = new Map(prospects.map((r) => [r.slug, r]));
const brokenWords = (d) => {
  if (d.source.none) return ['No website yet', 'only a listing or a social page'];
  const r = stateOf.get(d.prospect || d.slug) || {};
  if (/^Hacked/.test(r.siteState || '')) return ['Site taken over', 'visitors see spam instead'];
  if (r.siteState === 'Parked domain') return ['Address parked', 'visitors see an ad page'];
  if (/^Lapsed/.test(r.domainState || '')) return ['Address expired', 'the site no longer loads'];
  return ['Site not loading', 'visitors see an error'];
};

const W = 1200, H = 630, PAD = 44, GAP = 24;
const tw = (W - PAD * 2 - GAP) / 2, th = Math.round(tw * 753 / 1120);
const top = 150;
let made = 0;
for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8'));
  if (wanted.length && !wanted.includes(d.slug)) continue;
  const before = path.join(SHOTS, `${d.prospect || d.slug}-before.jpg`);
  const after = path.join(SHOTS, `${d.slug}-after.jpg`);
  if (!existsSync(after)) continue;
  const round = Buffer.from(`<svg width="${tw}" height="${th}"><rect width="${tw}" height="${th}" rx="12" ry="12"/></svg>`);
  const tile = async (file) => sharp(file).resize(tw, th, { fit: 'cover', position: 'top' }).composite([{ input: round, blend: 'dest-in' }]).png().toBuffer();
  const leftTile = existsSync(before) && !d.source.none
    ? await tile(before)
    : await sharp(Buffer.from(`<svg width="${tw}" height="${th}" xmlns="http://www.w3.org/2000/svg"><rect width="${tw}" height="${th}" rx="12" fill="#2a2f33"/><text x="${tw / 2}" y="${th / 2 - 10}" text-anchor="middle" font-family="DejaVu Sans, Arial" font-size="30" font-weight="700" fill="#f3e9c9">${brokenWords(d)[0]}</text><text x="${tw / 2}" y="${th / 2 + 32}" text-anchor="middle" font-family="DejaVu Sans, Arial" font-size="20" fill="#c9cfd3">${brokenWords(d)[1]}</text></svg>`)).png().toBuffer();
  const name = esc(d.name.length > 44 ? (d.short || d.name) : d.name);
  const overlay = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#143d2f"/>
    <text x="${PAD}" y="66" font-family="DejaVu Sans, Arial" font-size="20" font-weight="700" letter-spacing="2" fill="#9fd1bb">${esc(d.town.toUpperCase())} · ${d.source.none ? 'A FIRST WEBSITE' : 'A WEBSITE REDESIGN'}</text>
    <text x="${PAD}" y="114" font-family="DejaVu Sans, Arial" font-size="40" font-weight="700" fill="#ffffff">${name}</text>
    <rect x="${PAD}" y="${top + th + 18}" width="104" height="34" rx="17" fill="#b4541a"/>
    <text x="${PAD + 52}" y="${top + th + 41}" text-anchor="middle" font-family="DejaVu Sans, Arial" font-size="17" font-weight="700" fill="#fff">TODAY</text>
    <rect x="${PAD + tw + GAP}" y="${top + th + 18}" width="150" height="34" rx="17" fill="#1f6a50"/>
    <text x="${PAD + tw + GAP + 75}" y="${top + th + 41}" text-anchor="middle" font-family="DejaVu Sans, Arial" font-size="17" font-weight="700" fill="#fff">THE CONCEPT</text>
    <text x="${W - PAD}" y="${H - 30}" text-anchor="end" font-family="DejaVu Sans, Arial" font-size="18" fill="#c8ddd2">Tap to see it working</text>
  </svg>`);
  await sharp(overlay).composite([
    { input: leftTile, left: PAD, top },
    { input: await tile(after), left: PAD + tw + GAP, top },
  ]).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(OUT, `${d.slug}.jpg`));
  made++;
}
console.log(`cards: ${made} written to public/cards`);
