// Collect the North Augusta Chamber of Commerce directory (ChamberMaster).
// Covers North Augusta plus a lot of Graniteville / Belvedere / Clearwater /
// Beech Island businesses that sit between Aiken and the Savannah River.
import { writeFile } from 'node:fs/promises';
import { fetchUrl, pool, sleep, decode, stripTags } from './lib/http.mjs';

const BASE = 'https://northaugustachamber.chambermaster.com/list';
const LETTERS = ['0-9', ...'abcdefghijklmnopqrstuvwxyz'];

const cards = new Map();
for (const letter of LETTERS) {
  const res = await fetchUrl(`${BASE}/searchalpha/${letter}`, { bucket: 'northaugusta', timeout: 45 });
  if (!res.ok) { console.log(`  ${letter}: failed ${res.status}`); continue; }
  for (const m of res.body.matchAll(/<div class="card gz-results-card[^"]*"[^>]*data-memid="(\d+)"[\s\S]*?(?=<div class="gz-list-card-wrapper|<\/main>|$)/g)) {
    const block = m[0];
    const title = block.match(/gz-card-title"[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!title) continue;
    const street = stripTags((block.match(/gz-street-address"[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
    const csz = stripTags((block.match(/itemprop="citystatezip">([\s\S]*?)<\/div>/) || [])[1]);
    cards.set(m[1], {
      memberId: m[1],
      name: stripTags(title[2]),
      address: [street, csz].filter(Boolean).join(', '),
      phone: stripTags((block.match(/gz-card-phone">[\s\S]*?<span>([\s\S]*?)<\/span>/) || [])[1]),
      detailUrl: decode(title[1]),
    });
  }
  await sleep(200);
}
const items = [...cards.values()];
console.log(`northaugusta: ${items.length} members listed`);

let done = 0;
const out = await pool(items, 4, async (it) => {
  const res = await fetchUrl(it.detailUrl, { bucket: 'northaugusta', timeout: 40 });
  if (!res.cached) await sleep(150);
  if (++done % 100 === 0) console.log(`  ${done}/${items.length}`);
  if (!res.ok) return { ...it, error: res.error || String(res.status) };
  const b = res.body;
  const website = decode((b.match(/gz-card-website[^"]*">\s*<a href="([^"]+)"/) || [])[1] || '').trim();
  const categories = [...b.matchAll(/<span class="gz-cat[^"]*"[^>]*>([^<]+)</g)].map((c) => stripTags(c[1])).filter(Boolean);
  const facebook = decode((b.match(/class="gz-social-facebook"[^>]*href="([^"]+)"/) || [])[1] || '');
  const about = stripTags((b.match(/gz-details-about[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/) || [])[1]).slice(0, 400);
  return { ...it, categories: [...new Set(categories)], website, facebook, about };
});

await writeFile(new URL('../data/sources/northaugusta.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`northaugusta: saved ${out.length} (website: ${out.filter((m) => m.website).length})`);
