// A contact card for each business (/<slug>/contact.vcf). "Save to contacts"
// on a phone opens it straight into the address book: name, phone, email,
// address, hours and the web address, so customers can find them again.
import type { APIRoute } from 'astro';
import { demos, type Demo } from '../../lib/demos';
import { site } from '../../lib/site';

export function getStaticPaths() {
  return demos.map((demo) => ({ params: { slug: demo.slug }, props: { demo } }));
}

// vCard text values escape backslashes, commas, semicolons and newlines.
const esc = (s = '') => s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
// Lines longer than 75 octets are folded with CRLF + space.
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
};

/** "109 Laurens Street NW" + "Aiken, SC 29801" -> street, town, state, zip. */
function postal(demo: Demo) {
  const lines = demo.contact.address || [];
  const town = demo.town.replace(/,?\s*SC$/i, '');
  const last = lines[lines.length - 1] || '';
  const m = last.match(/^(?:(.*?),\s*)?([A-Za-z .'-]+),\s*(SC|South Carolina|GA|Georgia)\s*(\d{5})?$/i);
  if (m) return { street: [...lines.slice(0, -1), m[1]].filter(Boolean).join(', '), town: m[2].trim(), state: /^(SC|South Carolina)$/i.test(m[3]) ? 'SC' : 'GA', zip: m[4] || '' };
  return { street: lines.join(', '), town, state: 'SC', zip: '' };
}

export const GET: APIRoute = ({ props }) => {
  const demo = (props as { demo: Demo }).demo;
  const { contact } = demo;
  const a = postal(demo);
  const hours = contact.hours?.map(([d, h]) => `${d}: ${h}`).join('\n');
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(demo.name)}`,
    `N:;;;;`,
    'X-ABShowAs:COMPANY',
    `ORG:${esc(demo.name)}`,
    ...(contact.phone ? [`TEL;TYPE=WORK,VOICE:${contact.phone}`] : []),
    ...(contact.phone2 ? [`TEL;TYPE=WORK,VOICE:${contact.phone2}`] : []),
    ...(contact.email ? [`EMAIL;TYPE=INTERNET,WORK:${contact.email}`] : []),
    ...(contact.address ? [`ADR;TYPE=WORK:;;${esc(a.street)};${esc(a.town)};${a.state};${a.zip};USA`] : []),
    ...(site.url ? [`URL:${site.url}/${demo.slug}/`] : []),
    ...(contact.facebook ? [`X-SOCIALPROFILE;TYPE=facebook:${contact.facebook}`] : []),
    ...(contact.instagram ? [`X-SOCIALPROFILE;TYPE=instagram:${contact.instagram}`] : []),
    ...(hours ? [`NOTE:${esc(`Hours\n${hours}`)}`] : []),
    `CATEGORIES:${esc(demo.category)}`,
    'END:VCARD',
  ];
  return new Response(`${lines.map(fold).join('\r\n')}\r\n`, { headers: { 'content-type': 'text/vcard; charset=utf-8' } });
};
