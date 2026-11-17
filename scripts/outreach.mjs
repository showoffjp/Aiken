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
const a11y = JSON.parse(await readFile(path.join(ROOT, 'data', 'a11y.json'), 'utf8').catch(() => '{}'));
const weights = JSON.parse(await readFile(path.join(ROOT, 'data', 'weights.json'), 'utf8').catch(() => '{}'));
// Seconds to download a page on the 1.6 Mbps connection Lighthouse uses for phones.
const slowSecs = (key) => { const b = weights[key]?.site?.bytes; return b ? Math.round((b * 8) / 1.6e6) : 0; };
// Plain-English names for the accessibility rules that come up most often.
const PLAIN = {
  'color-contrast': 'text too faint to read easily',
  'image-alt': 'photos with no description for blind visitors',
  'link-name': 'links that screen readers announce with no name',
  'button-name': 'buttons with no label',
  'label': 'form fields with no label',
  'link-in-text-block': 'links you can only spot by color',
  'html-has-lang': 'no page language set',
  'meta-viewport': 'zooming switched off on phones',
};
function a11yNote(key) {
  const r = a11y[key]?.site;
  if (!r || r.error) return '';
  const n = (r.critical || 0) + (r.serious || 0);
  if (n < 5) return '';
  const kinds = (r.top || []).filter((t) => PLAIN[t.id] && ['critical', 'serious'].includes(t.impact)).slice(0, 2).map((t) => PLAIN[t.id]);
  return `An automated accessibility check flags ${n} serious problems on the home page${kinds.length ? `, such as ${kinds.join(' and ')}` : ''}`;
}
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
  const access = broken || d.source.none ? '' : a11yNote(d.prospect || d.slug);
  if (access) findings.push(access);
  const none = !!d.source.none;
  const subject = none ? `A website for ${short}` : broken ? `${short}: your website is not loading for visitors` : `A new website idea for ${short}`;

  const body = `Hi ${first || 'there'},

I'm ${me.name}. I build websites for small businesses around Aiken. ${none
    ? `I went looking for ${short} online and could not find a website, only a listing and a social page. That means the first thing a new customer sees is something you do not control.`
    : `I was looking at ${host} and noticed ${broken ? 'a problem' : findings.length > 2 ? 'a few things' : 'a couple of things'}:\n\n${findings.map((x) => `  - ${x}`).join('\n')}`}

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
  // Many of these businesses answer Facebook messages faster than email.
  const messenger = `Hi! I'm ${me.name}, a web designer here in Aiken. I put together a free concept for a ${none ? 'first ' : 'new '}${short} website, built from what you already have online. Here's a one-page look: ${report} (the concept itself: ${link}). No cost or obligation, just thought you might like to see it.`;
  const voicemail = `Hi${first ? ` ${first}` : ''}, this is ${me.name}. I build websites for small businesses here in the Aiken area. ${none ? `I could not find a website for ${short}` : `I noticed that ${lower(findings[0]).replace(/\.$/, '')}`}, so I put together a free concept of a new site for ${short}. I'd love to send you the link. My number is ${me.phone}. Again, that's ${me.name} at ${me.phone}. Thanks.`;

  // A short second note, a week later, with one new reason to look.
  const secs = none || broken ? 0 : slowSecs(d.prospect || d.slug);
  const nudge = none
    ? `When someone searches for ${short} today, they land on a listing or a social page. A site of your own puts your hours, phone and directions one tap away.`
    : broken
      ? `Visitors who try ${host} right now still hit the problem I mentioned, so every day it stays down is a few customers who may not call.`
      : secs >= 20
        ? `One more detail: on a slow phone connection, ${host} takes about ${secs >= 90 ? `${Math.round(secs / 60)} minutes` : `${secs} seconds`} to download in full. The concept takes under a second.`
        : `One more detail: the concept is built to load in under a second on a phone and to pass the standard accessibility checks.`;
  const followup = `Hi ${first || 'there'},

Just following up on the website concept I sent last week for ${short}:

  ${link}

${nudge}

Happy to change anything in it, or to take it down if you'd rather I didn't keep it online. Either way, a one-line reply helps.

${me.name}
${studio}
${me.phone} · ${me.email}
${me.address}

Not interested? Reply "no thanks" and I will not contact you again.`;

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

## Follow-up email (about a week later, if no reply)

**Subject:** Re: ${subject}

\`\`\`text
${followup}
\`\`\`

## Text message

\`\`\`text
${text}
\`\`\`

## Facebook or Instagram message

Attach \`cards/${d.slug}.jpg\` (the before/after picture) with it.

\`\`\`text
${messenger}
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

// Before/after cards to attach to messages.
await mkdir(path.join(out, 'cards'), { recursive: true });
for (const f of await readdir(path.join(ROOT, 'public', 'cards')).catch(() => [])) {
  await writeFile(path.join(out, 'cards', f), await readFile(path.join(ROOT, 'public', 'cards', f)));
}

// Urgent calls: businesses whose site is down or whose web address has lapsed.
// No concept needed to call; the news itself is the reason.
const urgent = rows.filter((r) => r.phone && (/^Lapsed|^On hold/.test(r.domainState || '') || ['Parked domain'].includes(r.siteState) || (r.tier === 'broken' && !/verify/.test(r.siteState))));
const poss = (n) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);
const script = (r) => /^Lapsed/.test(r.domainState || '')
  ? `Hi, this is ${me.name}, a web designer here in Aiken. I was checking local business websites and noticed ${r.domain} is no longer registered, so the address listed for ${r.name} in local directories leads nowhere, and anyone could buy it. I can help you get it back or set up a new one. Do you have a minute?`
  : /^On hold/.test(r.domainState || '')
    ? `Hi, this is ${me.name}, a web designer here in Aiken. I noticed ${r.domain} has expired and is in its grace period at the registrar, so ${poss(r.name)} website address is about to be released. If you want to keep it, it needs renewing soon. Happy to help.`
    : r.siteState === 'Parked domain'
      ? `Hi, this is ${me.name}, a web designer here in Aiken. The web address local directories list for ${r.name} (${r.domain || r.website}) now shows someone else's page, not yours. I can help you get a working site back up. Do you have a minute?`
      : `Hi, this is ${me.name}, a web designer here in Aiken. I tried ${poss(r.name)} website (${r.website}) and it isn't loading for visitors right now (${(r.siteState || '').toLowerCase()}). I can help get it back up. Do you have a minute?`;
await writeFile(path.join(out, 'urgent-calls.md'), `# Urgent calls

Businesses whose website is down, whose address now shows someone else's page, or whose domain has lapsed. Highest pitch score first. Call; these are time-sensitive, and the news is useful to the owner whether or not they hire you.

Check each one yourself in a browser first. Sites come back, and a domain can be renewed at any time.

${urgent.map((r) => `## ${r.name}

| | |
| --- | --- |
| Phone | ${r.phone} |
| Town | ${r.town || ''} |
| Website | ${r.website || '-'} |
| Status | ${r.siteState}${r.domainState ? ` · ${r.domainState}` : ''} |
| Concept | ${r.demo ? `${base}/${r.demo}/` : 'none yet'} |

\`\`\`text
${script(r)}
\`\`\`
`).join('\n')}`);

const cell = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
await writeFile(path.join(out, 'outreach.csv'), `﻿${csv.map((r) => r.map(cell).join(',')).join('\n')}\n`);
await writeFile(path.join(out, 'README.md'), `# Outreach kit

One draft per concept: an email, a follow-up email for a week later, a text message, a Facebook/Instagram message and a voicemail script. Nothing here has been sent.

\`urgent-calls.md\` lists businesses whose website is down or whose web address has lapsed, with a short call script for each.

Fill in the [BRACKETED] placeholders (your name, phone, email and mailing address) before using any of it. US law (CAN-SPAM) requires a real postal address and a working way to opt out in commercial email; both are in the template.

| Business | Town | Email | Phone |
| --- | --- | --- | --- |
${index.join('\n')}
`);
console.log(`outreach: ${index.length} drafts written to ./outreach (${csv.filter((r, i) => i && r[2]).length} with an email address); ${urgent.length} urgent calls`);
