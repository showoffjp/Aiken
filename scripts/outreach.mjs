// Write a first-contact kit for every concept: an email draft, a short text
// message and a voicemail script, each using that business's own findings.
// Output goes to ./outreach (not committed). Nothing is sent.
//   node scripts/outreach.mjs
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteTs = await readFile(path.join(ROOT, 'src', 'lib', 'site.ts'), 'utf8');
// A setting's value in single or double quotes (an address may hold an apostrophe: "Goin' Postal").
const pick = (k) => { const m = siteTs.match(new RegExp(`${k}:\\s*(?:'([^']*)'|"([^"]*)")`)); return (m && (m[1] ?? m[2])) || ''; };
const studio = pick('name');
const base = pick('url').replace(/\/$/, '');
const me = { name: pick('contactName') || '[YOUR NAME]', phone: pick('contactPhone') || '[YOUR PHONE]', email: pick('contactEmail') || '[YOUR EMAIL]', address: pick('mailingAddress') || '[YOUR MAILING ADDRESS]' };

const rows = JSON.parse(await readFile(path.join(ROOT, 'data', 'prospects.json'), 'utf8'));
// Addresses `npm run contacts` found on the business's own pages or listings, for concepts whose research
// data has none (written to outreach/contacts.json; run contacts first).
const found = JSON.parse(await readFile(path.join(ROOT, 'outreach', 'contacts.json'), 'utf8').catch(() => '{}'));
const a11y = JSON.parse(await readFile(path.join(ROOT, 'data', 'a11y.json'), 'utf8').catch(() => '{}'));
const weights = JSON.parse(await readFile(path.join(ROOT, 'data', 'weights.json'), 'utf8').catch(() => '{}'));
const lighthouse = JSON.parse(await readFile(path.join(ROOT, 'data', 'lighthouse.json'), 'utf8').catch(() => '{}'));
const filmstrip = JSON.parse(await readFile(path.join(ROOT, 'data', 'filmstrip.json'), 'utf8').catch(() => '{}'));
const rankings = JSON.parse(await readFile(path.join(ROOT, 'data', 'rankings.json'), 'utf8').catch(() => '{}'));
const typos = JSON.parse(await readFile(path.join(ROOT, 'data', 'typos.json'), 'utf8').catch(() => '{}'));
const firstScreen = JSON.parse(await readFile(path.join(ROOT, 'data', 'firstscreen.json'), 'utf8').catch(() => '{}'));
// A phone visitor who sees no phone number at all before scrolling (no call link, no number).
const readNote = (key) => {
  const f = firstScreen[key]?.site;
  if (!f || f.targets == null) return '';
  if (f.overflow) return 'On a phone the page is wider than the screen, so it slides sideways as people try to scroll';
  if (f.tinyText > 25) return `On a phone, ${f.tinyText}% of the text is smaller than 12 px, too small to read without zooming in`;
  return '';
};
const callNote = (key) => (firstScreen[key]?.site && !firstScreen[key].site.call && !firstScreen[key].site.number ? 'On a phone, the first screen shows no phone number or call button, so a customer has to scroll or open the menu to find it' : '');
// Not showing up for the obvious local search is the point owners feel most.
function rankNote(key) {
  const k = rankings[key]?.keywords?.find((r) => r.kind === 'service');
  if (!k || k.google) return '';
  return `When I searched "${k.keyword}" on a phone in Aiken, your site was not in Google's top ${k.googleDepth || 20}${k.maps ? '' : ' or the top 20 on Google Maps'}`;
}
// "Google's own test" is the most recognizable proof point, when the gap is real.
function lhNote(key) {
  const s = lighthouse[key]?.site, c = lighthouse[key]?.concept;
  if (!s || s.error || !c || c.error || typeof s.performance !== 'number' || typeof c.performance !== 'number' || s.performance >= 50 || c.performance < 90) return '';
  return `Google's own Lighthouse test scores the home page ${s.performance} out of 100 for performance on a phone (the concept scores ${c.performance})`;
}
// What a phone shows while the page loads (scripts/filmstrip.mjs): worth a line
// when today's page stays blank for 5 seconds or more and the concept is up in 2.
function blankNote(key) {
  const s = filmstrip[key]?.site, c = filmstrip[key]?.concept;
  if (!s || s.error || !c || c.error || c.first == null || c.first > 2000) return '';
  if (s.first == null) return `On a phone, the home page is still a blank screen ${s.frames.at(-1).t / 1000} seconds after it starts loading (the concept appears in under 2 seconds)`;
  if (s.first < 5000) return '';
  return `On a phone, the home page shows a blank screen for about ${Math.round(s.first / 1000)} seconds while it loads (the concept appears in under 2 seconds)`;
}
// Seconds to download a page on the 1.6 Mbps connection Lighthouse uses for phones.
const slowSecs = (key, which = 'site') => { const b = weights[key]?.[which]?.bytes; return b ? (b * 8) / 1.6e6 : 0; };
const saySecs = (t) => (t < 1 ? 'under a second' : t < 90 ? `about ${Math.round(t)} seconds` : `about ${Math.round(t / 60)} minutes`);
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
// The first typo on the current site (scripts/typos.mjs) that the concept's
// own findings don't already mention.
function typoNote(key, before) {
  const said = before.join(' ').toLowerCase();
  const t = (typos[key]?.found || []).find((x) => (x.kind === 'sample' ? !/lorem|sample text|placeholder|filler|template/.test(said) : !said.includes(x.word.toLowerCase())));
  if (!t) return '';
  const where = /^home$/i.test(t.label) ? 'the home page' : `the “${t.label}” page`;
  if (t.kind === 'sample') return `${where.charAt(0).toUpperCase() + where.slice(1)} still shows the website template’s sample text (“${t.context.split(/[.,]/)[0].slice(0, 40)}…”)`;
  if (t.kind === 'double') return `A doubled word on ${where}: “${t.word}”`;
  return `A typo on ${where}: “${t.word}” for “${t.fix}”`;
}

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

const lower = (s) => (/^(Google|Lighthouse|An automated|When I)/.test(s) ? s.replace(/^An /, 'an ').replace(/^When I searched/, 'when I searched') : s.charAt(0).toLowerCase() + s.slice(1));
const csv = [['Business', 'Town', 'Email', 'Phone', 'Subject', 'Concept link', 'Checkup link', 'Draft file']];
const index = [];

for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json')).sort()) {
  const d = JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8'));
  const row = rows.find((r) => r.slug === (d.prospect || d.slug)) || {};
  const short = d.short || d.name;
  const host = new URL(d.source.url).hostname.replace(/^www\./, '');
  const link = `${base}/${d.slug}/`;
  const report = `${base}/${d.slug}/report/`;
  const email = d.contact.email || row.email || found[d.slug]?.email || '';
  const phone = d.contact.phone || row.phone || '';
  // Only greet by name when the listed contact plausibly reads this inbox.
  // The export says whom to greet (a listed contact's first name, or an owner's chosen greeting).
  const contactFirst = row.greet ?? (row.contact || '').split(/\s+/)[0];
  const local = email.split('@')[0].toLowerCase();
  // A shared inbox, or a store inbox named after its town (aiken@…), is read by the owner.
  const shared = /^(info|contact|office|sales|admin|hello|mail|service|support|fun|insurance|aiken|northaugusta|augusta|graniteville)\d*$/.test(local);
  // A personal inbox counts as the contact's when it holds their first name or their surname (cwallace@ for Coleen Wallace).
  // (Drop the first name before filtering, so a short one does not leave the surname looking first: "JD Jury".)
  const surname = (row.contact || '').split(',')[0].trim().split(/\s+/).slice(1).filter((w) => /^[A-Za-z'-]{4,}$/.test(w)).pop()?.toLowerCase().replace(/[^a-z]/g, '') || '';
  const listed = contactFirst && (!email || shared || local.includes(contactFirst.toLowerCase()) || (surname && local.includes(surname))) ? contactFirst : '';
  // A listing that names several people ("Brian Brittingham and George Claussen") greets no one, but a
  // personal inbox named after one of them (brian@…) is that person's.
  const people = (row.contact || '').split(/,|;|&|\band\b/).map((x) => x.trim().split(/\s+/)[0]).filter((w) => /^[A-Z][a-z'-]{2,}$/.test(w || ''));
  const first = listed || (email && !shared ? people.find((w) => local.startsWith(w.toLowerCase().replace(/[^a-z]/g, ''))) : '') || '';
  const broken = row.tier === 'broken';
  const lhLine = broken || d.source.none ? '' : lhNote(d.prospect || d.slug);
  const rankLine = broken || d.source.none ? '' : rankNote(d.prospect || d.slug);
  const callLine = broken || d.source.none ? '' : callNote(d.prospect || d.slug);
  const readLine = broken || d.source.none ? '' : readNote(d.prospect || d.slug);
  const blankLine = broken || d.source.none ? '' : blankNote(d.prospect || d.slug);
  // The blank-screen line says the speed problem more plainly than the score, so it replaces it.
  const lead = [rankLine, callLine, blankLine, readLine, blankLine ? '' : lhLine].filter(Boolean);
  // The concept's own first finding that says something no lead line says
  // (no second speed point, no tiny text twice).
  const topic = (x) => (/Lighthouse|blank screen|stays blank|seconds to appear/i.test(x) ? 'speed' : /\b12 (px|pixels)\b/.test(x) ? 'tiny' : /call button|tap to call/i.test(x) ? 'call' : x);
  const said = new Set(lead.map(topic));
  const extra = d.source.before.find((b) => !said.has(topic(b)));
  // One measured point and the concept's own first finding (usually the most
  // specific: a placeholder phone number, another company's name), then a
  // second measured point if there is no own finding to use.
  const findings = lead.length ? [lead[0], extra, lead[1]].filter(Boolean).slice(0, 2) : d.source.before.slice(0, broken ? 1 : 2);
  // A typo is concrete and quick to check, so it takes the third spot when there is one.
  const typo = broken || d.source.none ? '' : typoNote(d.prospect || d.slug, d.source.before);
  const access = broken || d.source.none ? '' : a11yNote(d.prospect || d.slug);
  if (typo || access) findings.push(typo || access);
  const none = !!d.source.none;
  const subject = none ? `A website for ${short}` : broken ? `${short}: your website is not loading for visitors` : `A new website idea for ${short}`;

  const body = `Hi ${first || 'there'},

I'm ${me.name}. I build websites for small businesses around Aiken. ${none
    ? `I went looking for ${short} online and could not find a website, only a listing and a social page. That means the first thing a new customer sees is something you do not control.`
    : `I was looking at ${host} and noticed ${broken ? 'a problem' : findings.length > 2 ? 'a few things' : 'a couple of things'}:\n\n${findings.map((x) => `  - ${x}`).join('\n')}`}

So I went ahead and built a working concept of what a ${none ? 'first' : 'new'} site could look like for ${d.name.replace(/,? (LLC|Inc\.?|P\.?C\.?)$/i, '')}, using the words${d.hero.image || d.logo ? ' and photos' : ''} you already have online:

  ${link}

For a one-minute guided tour of what it does for your customers, open ${link}?tour

It is free to look at and there is no obligation. If you like it, I can have it live on your own web address within a few days. If not, no hard feelings.

A one-page ${none ? 'summary' : 'checkup of the current site'} is here: ${report}
And a full search and social media report, with how you compare to local competitors: ${base}/${d.slug}/seo/

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
        ? `One more detail: on a slow phone connection, ${host} takes ${saySecs(secs)} to download in full. The concept takes ${saySecs(slowSecs(d.prospect || d.slug, 'concept'))}.`
        : `One more detail: the concept is built to be light on a phone and to pass the standard automated accessibility checks.`;
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
${row.holdNote ? `\n> **Hold before sending:** ${row.holdNote}\n` : ''}
| | |
| --- | --- |
| Town | ${d.town} |
| Email | ${email || 'none on file: call or visit'} |
| Phone | ${phone || 'none on file'} |
| Contact | ${row.contact || 'unknown'} |
| Current site | ${none ? 'none (listing: ' + d.source.url + ')' : `${d.source.url} (${row.siteState || 'not audited'})`} |
| Concept | ${link} |
| Checkup | ${report} |
| One-page summary | ${base}/${d.slug}/card/ (PDF to print and leave behind: print/one-page/${d.slug}.pdf) |
| Guided tour | ${base}/${d.slug}/?tour (a one-minute walk through what the concept does for customers) |
| SEO & social report | ${base}/${d.slug}/seo/ (PDF: print/seo/${d.slug}-seo-report.pdf) |

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
${me.address.startsWith('[') ? '- Replace every [BRACKETED] placeholder.\n' : ''}`);
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
const urgent = rows.filter((r) => r.phone && (/^Lapsed|^On hold/.test(r.domainState || '') || ['Parked domain', 'Forwards to another website'].includes(r.siteState) || (r.tier === 'broken' && !/verify/.test(r.siteState))));
const poss = (n) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);
const script = (r) => /^Lapsed/.test(r.domainState || '')
  ? `Hi, this is ${me.name}, a web designer here in Aiken. I was checking local business websites and noticed ${r.domain} is no longer registered, so the address listed for ${r.name} in local directories leads nowhere, and anyone could buy it. I can help you get it back or set up a new one. Do you have a minute?`
  : /^On hold/.test(r.domainState || '')
    ? `Hi, this is ${me.name}, a web designer here in Aiken. I noticed ${r.domain} has expired and is in its grace period at the registrar, so ${poss(r.name)} website address is about to be released. If you want to keep it, it needs renewing soon. Happy to help.`
    : /^Hacked/.test(r.siteState)
      ? `Hi, this is ${me.name}, a web designer here in Aiken. I was checking local business websites and noticed that ${r.domain || r.website}, the address listed for ${r.name}, now shows an online-gambling spam page instead of your business. That usually means the site was hacked or the address was taken over, and it can hurt how Google and customers see you. I can help you get it back. Do you have a minute?`
      : r.siteState === 'Parked domain' || r.siteState === 'Forwards to another website'
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

${me.address.startsWith('[') ? 'Fill in the [BRACKETED] placeholders (your name, phone, email and mailing address) before using any of it. ' : `Every draft is signed with your details and mailing address from src/lib/site.ts. `}US law (CAN-SPAM) requires a real postal address and a working way to opt out in commercial email; both are in the template.

| Business | Town | Email | Phone |
| --- | --- | --- | --- |
${index.join('\n')}
`);
console.log(`outreach: ${index.length} drafts written to ./outreach (${csv.filter((r, i) => i && r[2]).length} with an email address); ${urgent.length} urgent calls`);
