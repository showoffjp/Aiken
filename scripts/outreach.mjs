// Write a first-contact kit for every concept: an email draft, a short text
// message and a voicemail script, each using that business's own findings.
// Output goes to ./outreach (not committed). Nothing is sent.
//   node scripts/outreach.mjs
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteTs = await readFile(path.join(ROOT, 'src', 'lib', 'site.ts'), 'utf8');
const pick = (k) => (siteTs.match(new RegExp(`${k}:\\s*'([^']*)'`)) || [])[1] || '';
const studio = pick('name');
const base = pick('url').replace(/\/$/, '');
const me = { name: '[YOUR NAME]', phone: pick('contactPhone') || '[YOUR PHONE]', email: pick('contactEmail') || '[YOUR EMAIL]', address: '[YOUR MAILING ADDRESS]' };

const rows = JSON.parse(await readFile(path.join(ROOT, 'data', 'prospects.json'), 'utf8'));
const out = path.join(ROOT, 'outreach');
await mkdir(out, { recursive: true });

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const csv = [['Business', 'Town', 'Email', 'Phone', 'Subject', 'Concept link', 'Checkup link', 'Draft file']];
const index = [];

for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json')).sort()) {
  const d = JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8'));
  const row = rows.find((r) => r.slug === (d.prospect || d.slug)) || {};
  const short = d.short || d.name;
  const host = new URL(d.source.url).hostname.replace(/^www\./, '');
  const link = `${base}/${d.slug}/`;
  const report = `${base}/${d.slug}/report/`;
  const email = d.contact.email || row.email || '';
  const phone = d.contact.phone || row.phone || '';
  // Only greet by name when the listed contact plausibly reads this inbox.
  const contactFirst = (row.contact || '').split(/\s+/)[0];
  const local = email.split('@')[0].toLowerCase();
  const shared = /^(info|contact|office|sales|admin|hello|mail|service|support|fun|insurance)\d*$/.test(local);
  const first = contactFirst && (!email || shared || local.includes(contactFirst.toLowerCase())) ? contactFirst : '';
  const broken = row.tier === 'broken';
  const findings = d.source.before.slice(0, broken ? 1 : 2);
  const none = !!d.source.none;
  const subject = none ? `A website for ${short}` : broken ? `${short}: your website is not loading for visitors` : `A new website idea for ${short}`;

  const body = `Hi ${first || 'there'},

I'm ${me.name}. I build websites for small businesses around Aiken. ${none
    ? `I went looking for ${short} online and could not find a website, only a listing and a social page. That means the first thing a new customer sees is something you do not control.`
    : `I was looking at ${host} and noticed ${broken ? 'a problem' : 'a couple of things'}:\n\n${findings.map((x) => `  - ${x}`).join('\n')}`}

So I went ahead and built a working concept of what a ${none ? 'first' : 'new'} site could look like for ${d.name.replace(/,? (LLC|Inc\.?|P\.?C\.?)$/i, '')}, using the words${d.hero.image || d.logo ? ' and photos' : ''} you already have online:

  ${link}

It is free to look at and there is no obligation. If you like it, I can have it live on your own web address within a few days. If not, no hard feelings.

A one-page ${none ? 'summary' : 'checkup of the current site'} is here: ${report}

${me.name}
${studio}
${me.phone} · ${me.email}
${me.address}

Not interested? Reply "no thanks" and I will not contact you again.${row.listedPhone ? `

P.S. While checking, I noticed a local business directory lists your number as ${row.listedPhone}, while your website says ${row.phone}. ${/typo/.test(row.phoneNote || '') ? 'It looks like a typo, worth' : 'Worth'} a quick fix so callers reach you.` : ''}`;

  const text = `Hi${first ? ` ${first}` : ''}, this is ${me.name} with ${studio} in Aiken. I built a free concept for a new ${short} website: ${link} No obligation. Happy to walk you through it. Reply STOP and I won't text again.`;
  const voicemail = `Hi${first ? ` ${first}` : ''}, this is ${me.name}. I build websites for small businesses here in the Aiken area. ${none ? `I could not find a website for ${short}` : `I noticed that ${lower(findings[0]).replace(/\.$/, '')}`}, so I put together a free concept of a new site for ${short}. I'd love to send you the link. My number is ${me.phone}. Again, that's ${me.name} at ${me.phone}. Thanks.`;

  const file = `${d.slug}.md`;
  await writeFile(path.join(out, file), `# ${d.name}

| | |
| --- | --- |
| Town | ${d.town} |
| Email | ${email || 'none on file: call or visit'} |
| Phone | ${phone || 'none on file'} |
| Contact | ${row.contact || 'unknown'} |
| Current site | ${none ? 'none (listing: ' + d.source.url + ')' : `${d.source.url} (${row.siteState || 'not audited'})`} |
| Concept | ${link} |
| Checkup | ${report} |

## Email

**Subject:** ${subject}

\`\`\`text
${body}
\`\`\`

## Text message

\`\`\`text
${text}
\`\`\`

## Voicemail

\`\`\`text
${voicemail}
\`\`\`

## Before you send

- Open the concept and the checkup yourself first, on a phone.
- Check the findings still hold: sites change.${/verify/.test(row.siteState || '') ? '\n- This site was unreachable from our checker. Confirm in your own browser that it is really down.' : ''}
- Replace every [BRACKETED] placeholder.
`);
  csv.push([d.name, d.town, email, phone, subject, link, report, file]);
  index.push(`| [${d.name}](${file}) | ${d.town} | ${email || '-'} | ${phone || '-'} |`);
}

const cell = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
await writeFile(path.join(out, 'outreach.csv'), `﻿${csv.map((r) => r.map(cell).join(',')).join('\n')}\n`);
await writeFile(path.join(out, 'README.md'), `# Outreach kit

One draft per concept: an email, a text message and a voicemail script. Nothing here has been sent.

Fill in the [BRACKETED] placeholders (your name, phone, email and mailing address) before using any of it. US law (CAN-SPAM) requires a real postal address and a working way to opt out in commercial email; both are in the template.

| Business | Town | Email | Phone |
| --- | --- | --- | --- |
${index.join('\n')}
`);
console.log(`outreach: ${index.length} drafts written to ./outreach (${csv.filter((r, i) => i && r[2]).length} with an email address)`);
