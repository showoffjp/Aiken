// Audit every included business website: is it reachable, is it secure, is it
// mobile-ready, and how old is the code underneath? Each site gets a
// "datedness" score (0-100, higher = older) built only from things that can
// be observed in the HTML and HTTP headers, plus the contact details the
// site itself publishes (emails, phones, social links).
import { readFile, writeFile } from 'node:fs/promises';
import { fetchUrl, pool, decode, stripTags } from './lib/http.mjs';

const all = JSON.parse(await readFile(new URL('../data/businesses.json', import.meta.url), 'utf8'));
const only = process.argv[2];
const targets = all.filter((b) => b.include && b.website && (!only || b.slug === only));
console.log(`auditing ${targets.length} sites`);

// ------------------------------------------------------------ helpers ----
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(sentry|wixpress|example|domain|email|yourdomain|mysite|company|website|sentry-next|2x|3x)\b|^(user|name|email|you|your|example|test|username|someone|firstname)@|@[\d.]+$|godaddy|wix\.com|squarespace|placeholder|u003e/i;

function cfDecode(hex = '') {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

function emailsIn(html) {
  const found = new Set();
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) found.add(cfDecode(m[1]).toLowerCase());
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) found.add(decodeURIComponent(decode(m[1])).toLowerCase());
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  for (const m of text.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  return [...found].map((e) => e.replace(/^[.\-]+|[.\-]+$/g, '')).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !BAD_EMAIL.test(e) && e.length < 60);
}

function phonesIn(html) {
  const found = new Set();
  for (const m of html.matchAll(/href=["']tel:([^"']+)/gi)) {
    const d = decodeURIComponent(m[1]).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (d.length === 10) found.add(`(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`);
  }
  if (!found.size) {
    const text = stripTags(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
    for (const m of text.matchAll(/\(?\b(803|706|762|839)\)?[\s.\-]{0,2}(\d{3})[\s.\-](\d{4})\b/g)) found.add(`(${m[1]}) ${m[2]}-${m[3]}`);
  }
  return [...found].slice(0, 3);
}

const PLATFORMS = [
  ['Wix', /static\.wixstatic\.com|_wixCIDX|wix-warmup-data|X-Wix-|wixsite\.com/i],
  ['Squarespace', /squarespace\.com|static1\.squarespace|sqs-block/i],
  ['Shopify', /cdn\.shopify\.com|Shopify\.theme/i],
  ['GoDaddy Websites + Marketing', /img1\.wsimg\.com|wsimg\.com\/blobby|data-ux=|godaddy-sites/i],
  ['Weebly', /weebly\.com|editmysite\.com|wsite-/i],
  ['Square Online', /square\.site|squareup\.com\/.*online|cdn\d*\.editmysite/i],
  ['Webflow', /webflow\.(com|io)|data-wf-site/i],
  ['Duda', /dudaone|multiscreensite\.com|irp\.cdn-website\.com|dmRoot|lirp\.cdn-website/i],
  ['Framer', /framerusercontent\.com|framer\.com\/m\//i],
  ['HubSpot', /hs-scripts\.com|hubspot\.net|hs-sites/i],
  ['BentoBox', /getbento\.com|bentobox/i],
  ['Popmenu', /popmenu\.com/i],
  ['SpotHopper', /spothopper/i],
  ['Toast site', /toasttab\.com|toast-?sites/i],
  ['Thryv', /thryv\.com|sites\.thryv/i],
  ['Hibu', /hibu\.com|hibuwebsites/i],
  ['Scorpion', /scorpion(cms|\.co)/i],
  ['Vistaprint', /vistaprintdigital|vpweb|vistaprint/i],
  ['Homestead', /homestead\.com|homesteadcloud/i],
  ['Yola', /yolasite|yola\.com/i],
  ['Jimdo', /jimdo(free|site)?\.com|jimstatic/i],
  ['Google Sites', /sites\.google\.com|googleusercontent\.com\/sitesv/i],
  ['Strikingly', /strikingly(cdn)?\.com/i],
  ['Site123', /site123/i],
  ['Yahoo/Turbify Small Business', /turbify|yahoosmallbusiness|luminate|geocities/i],
  ['Network Solutions / Web.com', /web\.com|networksolutions|register\.com\/|websitebuilder\.com|sitebuilder/i],
  ['Adobe Muse (discontinued)', /museutils|musecdn|Muse\.Utils|adobe muse/i],
  ['Microsoft FrontPage', /Microsoft FrontPage|_vti_|mso-|ProgId" content="FrontPage/i],
  ['Dreamweaver template', /InstanceBegin template|MM_preloadImages|MM_swapImage|\.dwt"/i],
  ['Joomla', /\/media\/jui\/|Joomla!|\/components\/com_|\/templates\/[^/]+\/css\/template/i],
  ['Drupal', /Drupal\.settings|\/sites\/default\/files|drupal\.js|data-drupal/i],
  ['WordPress', /wp-content\/|wp-includes\//i],
  ['Dealer / listing platform', /dealer\.com|dealeron|dealerinspire|cdk\.com|placester|idxbroker|kvcore|chime\.me|boomtown|realgeeks|sierra interactive/i],
];
const BUILDERS = [
  ['Elementor', /elementor/i], ['Divi', /et_pb_|Divi/], ['WPBakery', /vc_row|js_composer/i], ['Beaver Builder', /fl-builder/i],
  ['Avada', /fusion-|avada/i], ['Gutenberg blocks', /wp-block-/i],
];

function analyse(res, httpsWorks, httpOnlyFinal) {
  const html = res.body || '';
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [html.slice(0, 6000)])[0];
  const lower = html.toLowerCase();
  const text = stripTags(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' '));
  const count = (re) => (html.match(re) || []).length;
  const hdr = res.headers || '';
  const findings = [];
  let score = 0;
  const add = (pts, msg) => { score += pts; findings.push({ pts, msg }); };

  // --- infrastructure
  if (httpOnlyFinal && !httpsWorks) add(25, 'No working HTTPS: browsers show "Not secure"');
  else if (httpOnlyFinal) add(10, 'Serves pages over plain HTTP (no redirect to HTTPS)');
  const server = (hdr.match(/^server:\s*(.+)$/im) || [])[1]?.trim() || '';
  const powered = (hdr.match(/^x-powered-by:\s*(.+)$/im) || [])[1]?.trim() || '';
  const php = (powered.match(/PHP\/(\d+)\.(\d+)/i) || []);
  if (php[1] && Number(php[1]) < 7) add(10, `Runs end-of-life PHP ${php[1]}.${php[2]}`);
  else if (php[1] && Number(php[1]) === 7) add(5, `Runs end-of-life PHP ${php[1]}.${php[2]}`);
  if (/Microsoft-IIS\/([1-8])\./i.test(server)) add(8, `Old web server (${server})`);
  if (/Apache\/(1\.|2\.[0-2]\.)/i.test(server)) add(8, `Old web server (${server})`);
  const lastMod = (hdr.match(/^last-modified:\s*(.+)$/im) || [])[1];
  const lastModYear = lastMod ? new Date(lastMod).getFullYear() : null;
  if (lastModYear && lastModYear <= 2018) add(12, `Home page file last changed in ${lastModYear}`);
  else if (lastModYear && lastModYear <= 2021) add(6, `Home page file last changed in ${lastModYear}`);

  // --- mobile
  const viewport = /<meta[^>]+name\s*=\s*["']?viewport/i.test(html);
  if (!viewport) add(25, 'No mobile viewport: the page does not adapt to phones');

  // --- markup era
  const doctype = (html.match(/<!doctype[^>]*>/i) || [''])[0];
  if (!doctype) add(8, 'No DOCTYPE (browser quirks mode)');
  else if (/XHTML 1\.0 Transitional|HTML 4|HTML 3|Frameset/i.test(doctype)) add(8, `Pre-HTML5 doctype (${(doctype.match(/XHTML 1\.\d \w+|HTML \d\.\d+ ?\w*/i) || ['legacy'])[0]})`);
  const tables = count(/<table\b/gi);
  const layoutTables = count(/<table[^>]+(cellpadding|cellspacing|width=|border=["']?0)/gi);
  if (tables >= 3 && layoutTables >= 2) add(15, `Table-based page layout (${tables} tables)`);
  else if (layoutTables >= 1 && !viewport) add(6, 'Layout tables in use');
  const deprecated = [
    ['<font> tags', count(/<font\b/gi)], ['<center> tags', count(/<center\b/gi)], ['<marquee>', count(/<marquee\b/gi)],
    ['bgcolor attributes', count(/\sbgcolor=/gi)], ['frames', count(/<frame(set)?\b/gi)], ['spacer images', count(/spacer\.gif|clear\.gif|pixel\.gif/gi)],
    ['image maps', count(/<map\b/gi)], ['JavaScript rollovers', count(/MM_swapImage|onmouseover=["']?[a-z_]*swap/gi)],
  ].filter(([, n]) => n > 0);
  if (deprecated.length) add(Math.min(15, deprecated.length * 4 + (deprecated.some(([, n]) => n > 10) ? 3 : 0)), `Deprecated HTML: ${deprecated.map(([k, n]) => `${k} ×${n}`).join(', ')}`);
  if (/\.swf\b|shockwave-flash/i.test(html)) add(15, 'Uses Adobe Flash (dead since 2020)');
  const jq = (html.match(/jquery[.\-/]?(?:v|ver=)?(\d)\.(\d+)(?:\.(\d+))?/i) || []);
  if (jq[1] === '1' && Number(jq[2]) < 12) add(8, `Very old jQuery ${jq[1]}.${jq[2]}`);
  else if (jq[1] === '1' || jq[1] === '2') add(4, `Outdated jQuery ${jq[1]}.${jq[2]}`);
  if (/best viewed (in|with)|hit ?counter|sign (our|my) guestbook|netscape|internet explorer \d/i.test(text)) add(10, 'Late-90s/2000s page furniture (hit counter, "best viewed in…")');
  const mixed = count(/(src|href)=["']http:\/\/[^"']+\.(js|css|png|jpe?g|gif)/gi);
  if (mixed >= 3) add(5, `${mixed} assets loaded over insecure http://`);

  // --- generator / platform
  const generator = decode((head.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i) || head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']generator/i) || [])[1] || '');
  let platform = '';
  for (const [name, re] of PLATFORMS) if (re.test(html) || re.test(hdr)) { platform = name; break; }
  const builder = platform === 'WordPress' ? (BUILDERS.find(([, re]) => re.test(html)) || [''])[0] : '';
  const wpVer = (generator.match(/WordPress (\d+)\.(\d+)/i) || []);
  if (wpVer[1] && Number(wpVer[1]) < 5) add(12, `WordPress ${wpVer[1]}.${wpVer[2]} (years of missed security updates)`);
  else if (wpVer[1] && Number(wpVer[1]) === 5) add(6, `WordPress ${wpVer[1]}.${wpVer[2]} (out of date)`);
  if (/FrontPage|Dreamweaver|Adobe Muse|Homestead|Yahoo|Vistaprint|Network Solutions/i.test(platform)) add(15, `Built with ${platform}`);
  if (/Joomla! (1\.|2\.|3\.)|Drupal [67]\b/i.test(generator)) add(12, `End-of-life CMS (${generator})`);
  if (/Microsoft (Word|Publisher)|GoLive|iWeb|NetObjects|WebPlus|CoffeeCup|Namo|Trellix|PageMill|Claris|HoTMetaL/i.test(generator)) add(15, `Generated by ${generator}`);

  // --- freshness
  const years = [...text.matchAll(/(?:©|&copy;|copyright|\(c\))[^.]{0,40}?((?:19|20)\d{2})(?:\s*[-–]\s*((?:19|20)\d{2}))?/gi)]
    .map((m) => Number(m[2] || m[1])).filter((y) => y >= 1995 && y <= 2027);
  const copyrightYear = years.length ? Math.max(...years) : null;
  if (copyrightYear && copyrightYear <= 2016) add(15, `Footer copyright says ${copyrightYear}`);
  else if (copyrightYear && copyrightYear <= 2020) add(10, `Footer copyright says ${copyrightYear}`);
  else if (copyrightYear && copyrightYear <= 2023) add(4, `Footer copyright says ${copyrightYear}`);

  // --- basics a modern site has
  const hasDesc = /<meta[^>]+name=["']description["']/i.test(head);
  const hasOg = /<meta[^>]+property=["']og:/i.test(head);
  if (!hasDesc) add(4, 'No meta description for search results');
  if (!hasOg) add(3, 'No social sharing (Open Graph) tags');
  if (!/<link[^>]+rel=["'][^"']*icon/i.test(head)) add(2, 'No favicon declared');
  if (!/application\/ld\+json|itemtype=/i.test(html)) add(2, 'No structured data for Google business results');
  const imgs = count(/<img\b/gi);
  const imgsNoAlt = count(/<img\b(?![^>]*\salt=)[^>]*>/gi);
  if (imgs >= 4 && imgsNoAlt / imgs > 0.5) add(3, `${imgsNoAlt} of ${imgs} images have no alt text`);

  // --- broken / parked
  let state = 'ok';
  if (/domain (is|may be) for sale|buy this domain|hugedomains|sedoparking|parkingcrew|this domain has expired|domain parking|godaddy\.com\/forsale|dan\.com\/buy-domain|is parked free|afternic/i.test(html)) state = 'parked';
  else if (/account (has been )?suspended|bandwidth limit exceeded|apache2 (ubuntu|debian) default page|welcome to nginx|index of \/|it works!<\/h1>|default web site page|website coming soon|site (is )?under construction|launching soon|future home of/i.test(html)) state = 'placeholder';
  else if (/online ordering setup in progress|finish setting up your|page cannot be displayed|this site can.t be reached|website is (currently )?(unavailable|offline)|no longer available/i.test(text)) state = 'placeholder';
  else if (text.length < 400 && /one moment, please|request is being verified|checking your browser|just a moment|verify you are human|enable javascript and cookies|attention required|access denied|captcha/i.test(text)) state = 'blocked';
  else if (text.length < 200 && !/<script/i.test(html)) state = 'empty';

  const family = (text.match(/[^.!?]{0,60}\b(family[- ]owned|family[- ]operated|family[- ]run|locally[- ]owned|owned and operated|veteran[- ]owned|woman[- ]owned|women[- ]owned|second generation|third generation|generations)\b[^.!?]{0,60}/i) || [''])[0].replace(/\s+/g, ' ').trim();
  const since = (text.match(/\b(?:since|established|est\.?|founded in|serving [^.]{0,40} since|in business since)\s+((?:18|19|20)\d{2})\b/i) || [])[1];

  if (state === 'blocked') { score = 0; findings.length = 0; }
  return {
    state,
    score: state === 'blocked' ? null : Math.min(100, score),
    findings: findings.sort((a, b) => b.pts - a.pts).map((f) => f.msg),
    platform: platform || (generator ? generator.split(/[;,]/)[0].slice(0, 40) : 'Custom / hand-coded'),
    builder,
    generator: generator.slice(0, 80),
    server: [server, powered].filter(Boolean).join(' · ').slice(0, 80),
    viewport,
    https: !httpOnlyFinal,
    copyrightYear,
    lastModYear,
    title: stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]).slice(0, 140),
    description: decode((head.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || [])[1] || '').slice(0, 260),
    textLength: text.length,
    htmlBytes: html.length,
    familySignal: family.slice(0, 200),
    since: since ? Number(since) : null,
    emails: emailsIn(html),
    phones: phonesIn(html),
    facebook: decode((html.match(/https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|tr\b|plugins|dialog|share)[^"'\s<>?]+/i) || [''])[0]),
    instagram: decode((html.match(/https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore)[^"'\s<>?]+/i) || [''])[0]),
  };
}

// --------------------------------------------------------------- crawl ----
let done = 0;
const results = await pool(targets, 8, async (b) => {
  const given = b.website;
  const u = new URL(given);
  const httpsUrl = `https://${u.host}${u.pathname}${u.search}`;
  const httpUrl = `http://${u.host}${u.pathname}${u.search}`;

  // Try HTTPS first; fall back to plain HTTP (many old sites have no certificate).
  let res = await fetchUrl(httpsUrl, { bucket: 'sites', timeout: 25 });
  let httpsWorks = res.ok && res.finalUrl.startsWith('https://');
  if (!res.ok || res.status >= 400) {
    const alt = await fetchUrl(httpUrl, { bucket: 'sites', timeout: 25 });
    if (alt.ok) res = alt;
  }
  // Old sites often bounce the visitor with a script or meta refresh.
  let scriptRedirect = false;
  if (res.ok && res.body.length < 3000) {
    const hop = (res.body.match(/location\.(?:replace|assign)\(\s*["']([^"']+)["']/i) || res.body.match(/(?:window\.|document\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i) || res.body.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i) || [])[1];
    if (hop) {
      try {
        const next = await fetchUrl(new URL(hop, res.finalUrl).href, { bucket: 'sites', timeout: 25 });
        if (next.ok) { res = next; scriptRedirect = true; }
      } catch {}
    }
  }
  if (++done % 50 === 0) console.log(`  ${done}/${targets.length}`);

  const base = { slug: b.slug, name: b.name, url: given, finalUrl: res.finalUrl, status: res.status };
  if (!res.ok) {
    // 401/403/429 = a firewall refusing automated visitors (the site is up);
    // anything else = the site did not answer at all.
    const state = [401, 403, 406, 429, 503].includes(res.status) ? 'blocked' : res.status >= 400 ? 'broken' : 'down';
    return { ...base, state, error: (res.error || `HTTP ${res.status}`).slice(0, 160), score: null, findings: [], emails: [], phones: [] };
  }

  const finalHost = (() => { try { return new URL(res.finalUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const httpOnlyFinal = res.finalUrl.startsWith('http://');
  const a = analyse(res, httpsWorks, httpOnlyFinal);
  if (scriptRedirect && a.score !== null) { a.score = Math.min(100, a.score + 6); a.findings.push('Home page is a script/meta-refresh redirect'); }
  if (finalHost && finalHost !== b.host && /facebook\.com|instagram\.com|godaddy\.com|wix\.com$|squarespace\.com$|hugedomains|dan\.com|afternic|sedo\.com/i.test(finalHost)) a.state = /facebook|instagram/.test(finalHost) ? 'redirects-to-social' : 'parked';

  // Contact page: the best place to find a real email address.
  const contactHref = (res.body.match(/<a[^>]+href=["']([^"'#]*contact[^"'#]*)["']/i) || [])[1];
  if (contactHref && a.state === 'ok') {
    try {
      const cu = new URL(decode(contactHref), res.finalUrl);
      if (cu.hostname.replace(/^www\./, '') === finalHost && cu.href !== res.finalUrl) {
        const c = await fetchUrl(cu.href, { bucket: 'sites', timeout: 20 });
        if (c.ok) {
          a.emails = [...new Set([...a.emails, ...emailsIn(c.body)])];
          a.phones = [...new Set([...a.phones, ...phonesIn(c.body)])].slice(0, 3);
          a.contactPage = cu.href;
        }
      }
    } catch {}
  }
  // Prefer addresses on the business's own domain, then anything else.
  a.emails.sort((x, y) => Number(y.endsWith(`@${finalHost}`)) - Number(x.endsWith(`@${finalHost}`)));
  a.emails = a.emails.slice(0, 4);
  return { ...base, ...a };
});

const existing = only ? JSON.parse(await readFile(new URL('../data/audit.json', import.meta.url), 'utf8').catch(() => '{}')) : {};
const audit = { ...existing, ...Object.fromEntries(results.map((r) => [r.slug, r])) };
await writeFile(new URL('../data/audit.json', import.meta.url), JSON.stringify(audit, null, 1));

const r = Object.values(audit);
const n = (f) => r.filter(f).length;
console.log(`audit saved: ${r.length} sites`);
console.log(`  down ${n((x) => x.state === 'down')}, broken ${n((x) => x.state === 'broken')}, bot-blocked ${n((x) => x.state === 'blocked')}, parked/placeholder/empty ${n((x) => ['parked', 'placeholder', 'empty', 'redirects-to-social'].includes(x.state))}, ok ${n((x) => x.state === 'ok')}`);
console.log(`  score >=45: ${n((x) => x.score >= 45)}, 30-44: ${n((x) => x.score >= 30 && x.score < 45)}, 15-29: ${n((x) => x.score >= 15 && x.score < 30)}, <15: ${n((x) => x.score !== null && x.score < 15)}`);
console.log(`  no viewport: ${n((x) => x.state === 'ok' && !x.viewport)}, no https: ${n((x) => x.state === 'ok' && !x.https)}, with email: ${n((x) => x.emails?.length)}`);
