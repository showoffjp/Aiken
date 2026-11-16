// Collect the Greater Aiken Chamber of Commerce member directory.
// The public directory at aikenchamber.net/directory embeds a Members Thrive
// listing; every member has a detail page with category, phone, email, website.
import { writeFile } from 'node:fs/promises';
import { fetchUrl, pool, sleep, decode, stripTags } from './lib/http.mjs';

const HOST = 'https://aiken.membersthrive.com';
const LIST =
  `${HOST}/index.php?id=204&httpReferer=https%3A%2F%2Fwww.aikenchamber.net%2Fdirectory%2F&chamberpid=175&loadcycle=60`;

// TYPO3 "spamProtectEmailAddresses" decoder (offset 3, wraps within 3 ranges).
function unCryptMailto(s, offset = 3) {
  const shift = (n, start, end) => {
    n += offset;
    if (n > end) n = start + (n - end - 1);
    return String.fromCharCode(n);
  };
  return [...s].map((ch) => {
    const n = ch.charCodeAt(0);
    if (n >= 0x2b && n <= 0x3a) return shift(n, 0x2b, 0x3a);
    if (n >= 0x40 && n <= 0x5a) return shift(n, 0x40, 0x5a);
    if (n >= 0x61 && n <= 0x7a) return shift(n, 0x61, 0x7a);
    return ch;
  }).join('');
}

const list = await fetchUrl(LIST, { bucket: 'chamber', timeout: 90 });
if (!list.ok) throw new Error(`chamber list failed: ${list.status} ${list.error}`);

const items = [...list.body.matchAll(/<li class="enhanced-member-item">([\s\S]*?)<\/li>/g)].map((m) => {
  const block = m[1];
  const href = decode((block.match(/<a href="([^"]+)"/) || [])[1] || '');
  return {
    memberId: (href.match(/%5Bmember%5D=(\d+)/) || [])[1],
    name: stripTags((block.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1]),
    address: stripTags((block.match(/<h4>([\s\S]*?)<\/h4>/) || [])[1]),
    phone: stripTags((block.match(/<span class="phone">([\s\S]*?)<\/span>/) || [])[1]),
    detailUrl: HOST + href,
  };
});
console.log(`chamber: ${items.length} members listed`);

let done = 0;
const members = await pool(items, 4, async (it) => {
  const res = await fetchUrl(it.detailUrl, { bucket: 'chamber', timeout: 40 });
  if (!res.cached) await sleep(150);
  if (++done % 100 === 0) console.log(`  ${done}/${items.length}`);
  if (!res.ok) return { ...it, error: res.error || String(res.status) };
  const b = res.body;
  const cats = [...((b.match(/nkchambermembers-details-categories">([\s\S]*?)<\/h3>/) || [])[1] || '').matchAll(/<span>([\s\S]*?)<\/span>/g)]
    .map((c) => stripTags(c[1])).filter(Boolean);
  const contactBlock = (b.match(/<h3>Contact:<\/h3>([\s\S]*?)nkchambermembers-details-right/) || [])[1] || '';
  const contact = stripTags((contactBlock.match(/<span>([\s\S]*?)<\/span>/) || [])[1]);
  // Emails are published behind TYPO3's standard spam-protection shift cipher.
  const crypted = (contactBlock.match(/linkTo_UnCryptMailto\('([^']+)'\)/) || [])[1] || '';
  const email = unCryptMailto(crypted).replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
  const website = decode((b.match(/class="member-fe-external-url" href="([^"]+)"/) || [])[1] || '').trim();
  const since = stripTags((b.match(/Member since ([^<]+)</) || [])[1]);
  return { ...it, categories: cats, contact, email, website, memberSince: since };
});

await writeFile(new URL('../data/sources/chamber.json', import.meta.url), JSON.stringify(members, null, 1));
const withSite = members.filter((m) => m.website).length;
const withEmail = members.filter((m) => m.email).length;
console.log(`chamber: saved ${members.length} (website: ${withSite}, email: ${withEmail})`);
