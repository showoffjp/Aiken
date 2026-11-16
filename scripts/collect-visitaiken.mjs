// Collect Visit Aiken (city tourism office) listings: Eat / Explore / Stay.
// The listing index comes from the site's public WordPress REST API; contact
// details (website, phone, email, address) are on each listing page.
import { writeFile } from 'node:fs/promises';
import { fetchUrl, pool, sleep, decode, stripTags } from './lib/http.mjs';

const BASE = 'https://www.visitaikensc.com';

// Cloudflare "email protection": first byte is the XOR key for the rest.
function cfDecode(hex = '') {
  if (!hex) return '';
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out.toLowerCase();
}

const listings = [];
for (const type of ['eat', 'do', 'stay']) {
  for (let page = 1; page < 10; page++) {
    const res = await fetchUrl(`${BASE}/wp-json/wp/v2/${type}?per_page=100&page=${page}&_fields=id,slug,link,title,excerpt,class_list`, { bucket: 'visitaiken' });
    if (!res.ok) break;
    let rows;
    try { rows = JSON.parse(res.body); } catch { break; }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      listings.push({
        type,
        slug: r.slug,
        name: stripTags(r.title?.rendered),
        blurb: stripTags(r.excerpt?.rendered),
        tags: (r.class_list || []).filter((c) => /^(cuisine|serving|explore|category|stay-type|do-type|accommodation)-/.test(c)),
        detailUrl: r.link,
      });
    }
    if (rows.length < 100) break;
  }
}
console.log(`visitaiken: ${listings.length} listings`);

let done = 0;
const out = await pool(listings, 4, async (it) => {
  const res = await fetchUrl(it.detailUrl, { bucket: 'visitaiken', timeout: 40 });
  if (!res.cached) await sleep(150);
  if (++done % 50 === 0) console.log(`  ${done}/${listings.length}`);
  if (!res.ok) return { ...it, error: res.error || String(res.status) };
  const info = (res.body.match(/<div class="metadata-info">([\s\S]*?)<\/div>\s*<\/div>/) || [])[1] || '';
  const website = decode((info.match(/<a href="([^"]+)"[^>]*>\s*Visit Website/i) || [])[1] || '').trim();
  const phone = stripTags((info.match(/Phone:\s*<\/span>\s*<span class="meta-value">([\s\S]*?)<\/span>/i) || [])[1]);
  const email = cfDecode((info.match(/data-cfemail="([0-9a-f]+)"/i) || [])[1]) ||
    decode((info.match(/href="mailto:([^"?]+)/i) || [])[1] || '').toLowerCase();
  const address = decode((res.body.match(/maps\.google\.com\/maps\?q=([^"&]+)/) || [])[1] || '').replace(/\s+/g, ' ').trim();
  return { ...it, website, phone, email, address };
});

await writeFile(new URL('../data/sources/visitaiken.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`visitaiken: saved ${out.length} (website: ${out.filter((m) => m.website).length}, phone: ${out.filter((m) => m.phone).length}, email: ${out.filter((m) => m.email).length})`);
