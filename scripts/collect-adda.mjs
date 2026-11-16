// Collect Aiken Downtown Development Association listings.
// The members page is a set of tables (one business per cell, linked to its
// website when it has one); other pages use grids of buttons.
import { writeFile } from 'node:fs/promises';
import { fetchUrl, decode, stripTags } from './lib/http.mjs';

const PAGES = ['meet-our-members', 'shop-local', 'find-a-business', 'where-to-stay'];
const SKIP = /aikendda\.us|jotform|downtownaiken\.com|masc\.sc|bluesalamander/i;
const seen = new Map();

function add(name, website, page) {
  name = name.replace(/\s+/g, ' ').trim();
  if (!name || name.length < 3 || name.length > 80) return;
  const k = name.toLowerCase();
  const prev = seen.get(k);
  if (!prev) seen.set(k, { name, website, page });
  else if (!prev.website && website) prev.website = website;
}

for (const p of PAGES) {
  const res = await fetchUrl(`https://aikendda.us/${p}/`, { bucket: 'adda' });
  if (!res.ok) { console.log(`adda: ${p} failed (${res.status})`); continue; }

  // Table cells (members page). A cell may hold several <p> entries.
  for (const cell of res.body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)) {
    const parts = cell[1].split(/<\/p>|<br\s*\/?>/i);
    for (const part of parts) {
      const link = part.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (link) {
        const website = decode(link[1]).trim();
        if (!SKIP.test(website)) add(stripTags(link[2]), /^https?:/i.test(website) ? website : '', p);
      } else {
        add(stripTags(part), '', p);
      }
    }
  }

  // Button grids.
  for (const m of res.body.matchAll(/<a\b(?=[^>]*class="[^"]*elementor-button)[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const website = decode(m[1]).trim();
    if (!/^https?:/i.test(website) || SKIP.test(website)) continue;
    add(stripTags(m[2]), website, p);
  }
}

const out = [...seen.values()];
await writeFile(new URL('../data/sources/adda.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`adda: saved ${out.length} (website: ${out.filter((m) => m.website).length})`);
