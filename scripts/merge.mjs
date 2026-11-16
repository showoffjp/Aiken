// Merge every source into one de-duplicated master list and decide which
// records are the kind of business this project is for: locally owned,
// independent shops in and around Aiken, SC. Everything is kept in
// data/businesses.json with a `segment` + `include` flag, so nothing is lost
// and the filter can be tuned later.
import { readFile, writeFile } from 'node:fs/promises';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/sources/${name}.json`, import.meta.url), 'utf8'));
const [chamber, visit, adda, northAugusta] = await Promise.all(['chamber', 'visitaiken', 'adda', 'northaugusta'].map(load));

// ---------------------------------------------------------------- area ----
const TOWNS = [
  'North Augusta', 'New Ellenton', 'Beech Island', 'Ridge Spring', 'Aiken', 'Graniteville', 'Warrenville',
  'Langley', 'Gloverville', 'Bath', 'Clearwater', 'Belvedere', 'Jackson', 'Windsor', 'Montmorenci', 'Wagener',
  'Salley', 'Perry', 'Monetta', 'Trenton', 'Johnston', 'Edgefield', 'Williston', 'Barnwell', 'Burnettown',
  'Vaucluse', 'Elko', 'Blackville',
];
const OUT_OF_AREA = /\b(Augusta|Evans|Martinez|Grovetown|Columbia|Lexington|Fort Gordon|Hephzibah|Charleston|Greenville|Atlanta|Charlotte|Orangeburg|Thomson|Appling|Harlem|Waynesboro)\b/i;

function cityOf(address = '') {
  const a = address.replace(/\s+/g, ' ');
  if (/\bNorth Augusta\b/i.test(a)) return 'North Augusta';
  let best = '', at = -1;
  for (const t of TOWNS) {
    const i = a.toLowerCase().lastIndexOf(t.toLowerCase());
    // "Jackson Ave" / "Barnwell Ave" are streets, not towns: require the town
    // to be followed by a state or the end of the string.
    if (i > at && new RegExp(`\\b${t}\\b[,. ]*(SC|S\\.C\\.|South Carolina|\\d{5}|$)`, 'i').test(a.slice(i))) { best = t; at = i; }
  }
  if (best) return best;
  if (/\b(GA|Georgia)\b/.test(a) || OUT_OF_AREA.test(a)) return 'OUT';
  return '';
}

// ------------------------------------------------------------ websites ----
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|twitter\.com|x\.com|linkedin\.com|linktr\.ee|yelp\.com|tripadvisor\.com|youtube\.com|tiktok\.com|google\.com|goo\.gl|business\.site|nextdoor\.com|pinterest\.com|etsy\.com|doordash\.com|grubhub\.com|toasttab\.com|opentable\.com|airbnb\.com|vrbo\.com|booking\.com|eventbrite\.com)$/i;

function cleanUrl(raw = '') {
  let u = raw.trim().replace(/&amp;/g, '&');
  if (!u || /^(n\/?a|none|tbd)$/i.test(u)) return '';
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|gclid|fbclid|y_source|gad_|ref$)/i.test(k)) url.searchParams.delete(k);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch { return ''; }
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// ---------------------------------------------------------------- keys ----
const digits = (p = '') => { const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? d : ''; };
const fmtPhone = (d) => (d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '');
const nameKey = (n = '') => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/['’`.]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(the|llc|inc|co|company|corp|ltd|pa|pc|of aiken|aiken)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();
const JUNK_EMAIL = /^(test\d*|example|none|noemail|na|info@example)|@(example|test|email)\./i;

// ------------------------------------------------------------- collect ----
const raw = [];
for (const m of chamber) raw.push({ source: 'Aiken Chamber', name: m.name, address: m.address, phone: m.phone, email: m.email, website: m.website, categories: m.categories || [], contact: m.contact, since: m.memberSince, sourceUrl: m.detailUrl });
for (const m of visit) {
  const kind = { eat: 'Restaurant', do: 'Attraction / Shopping', stay: 'Accommodations' }[m.type];
  const tags = (m.tags || []).map((t) => t.replace(/^[a-z-]+?-/, '').replace(/-/g, ' '));
  raw.push({ source: 'Visit Aiken', name: m.name, address: m.address, phone: m.phone, email: m.email, website: m.website, categories: [kind, ...tags], blurb: m.blurb, sourceUrl: m.detailUrl });
}
for (const m of adda) raw.push({ source: 'Downtown Aiken (ADDA)', name: m.name, address: 'Downtown Aiken, SC', phone: '', email: '', website: m.website, categories: ['Downtown Aiken'], sourceUrl: 'https://aikendda.us/meet-our-members/' });
for (const m of northAugusta) raw.push({ source: 'North Augusta Chamber', name: m.name, address: m.address, phone: m.phone, email: '', website: m.website, categories: m.categories || [], blurb: m.about, facebook: m.facebook, sourceUrl: m.detailUrl });

// --------------------------------------------------------------- dedupe ----
const byKey = new Map();
const records = [];
function find(keys) { for (const k of keys) if (byKey.has(k)) return byKey.get(k); return null; }

for (const r of raw) {
  const website = cleanUrl(r.website);
  const host = hostOf(website);
  const social = host && SOCIAL.test(host);
  const phone = digits(r.phone);
  const nk = nameKey(r.name);
  if (!nk) continue;
  const keys = [`n:${nk}`];
  if (phone) keys.push(`p:${phone}:${nk.split(' ')[0]}`);
  // Same site on a root URL = same business. (Deep links on a shared domain,
  // e.g. a national brand's location page, are not merged.)
  if (host && !social) { try { if (new URL(website).pathname.length <= 1) keys.push(`h:${host}`); } catch {} }

  let rec = find(keys);
  if (!rec) {
    rec = { name: r.name.trim(), names: new Set(), address: '', city: '', phone: '', email: '', website: '', social: '', categories: new Set(), sources: new Set(), sourceUrls: new Set(), contact: '', blurb: '', since: '' };
    records.push(rec);
  }
  for (const k of keys) if (!byKey.has(k)) byKey.set(k, rec);
  rec.names.add(r.name.trim());
  rec.sources.add(r.source);
  if (r.sourceUrl) rec.sourceUrls.add(r.sourceUrl);
  (r.categories || []).filter(Boolean).forEach((c) => rec.categories.add(c));
  const city = cityOf(r.address);
  if (!rec.address || (rec.address === 'Downtown Aiken, SC' && r.address)) rec.address = (r.address || '').replace(/\s+/g, ' ').trim();
  if (city && (!rec.city || rec.city === 'OUT')) rec.city = city;
  if (!rec.phone && phone) rec.phone = fmtPhone(phone);
  if (!rec.email && r.email && !JUNK_EMAIL.test(r.email)) rec.email = r.email;
  if (website) { if (social) { rec.social ||= website; } else if (!rec.website) rec.website = website; }
  if (r.facebook && !rec.social) rec.social = r.facebook;
  if (r.contact && !rec.contact) rec.contact = r.contact;
  if (r.blurb && r.blurb.length > rec.blurb.length) rec.blurb = r.blurb;
  if (r.since && !rec.since) rec.since = r.since;
}

// Second pass: "Pink Icing" + "Pink Icing Boutique", "Sweet B's" + "Sweet B's
// Ice Cream" etc. are one business listed under slightly different names.
{
  const keyed = records.map((r) => ({ r, nk: nameKey(r.name) })).sort((a, b) => a.nk.length - b.nk.length);
  const gone = new Set();
  for (let i = 0; i < keyed.length; i++) {
    const a = keyed[i];
    if (gone.has(a.r) || !(a.nk.includes(' ') || a.nk.length >= 9)) continue;
    for (let j = i + 1; j < keyed.length; j++) {
      const b = keyed[j];
      if (gone.has(b.r) || !b.nk.startsWith(`${a.nk} `)) continue;
      const A = a.r, B = b.r;
      B.names.forEach((n) => A.names.add(n));
      B.sources.forEach((n) => A.sources.add(n));
      B.sourceUrls.forEach((n) => A.sourceUrls.add(n));
      B.categories.forEach((n) => A.categories.add(n));
      for (const f of ['phone', 'email', 'website', 'social', 'contact', 'since', 'city']) if (!A[f] && B[f]) A[f] = B[f];
      if (!A.address || A.address === 'Downtown Aiken, SC') A.address = B.address || A.address;
      if (B.blurb.length > A.blurb.length) A.blurb = B.blurb;
      gone.add(B);
    }
  }
  for (let i = records.length - 1; i >= 0; i--) if (gone.has(records[i])) records.splice(i, 1);
}

// Hand corrections (data/overrides.json): exact names to force in or out.
let overrides = { include: [], exclude: [] };
try { overrides = { ...overrides, ...JSON.parse(await readFile(new URL('../data/overrides.json', import.meta.url), 'utf8')) }; } catch {}
const forceIn = new Set(overrides.include.map((n) => n.toLowerCase()));
const forceOut = new Set(overrides.exclude.map((n) => n.toLowerCase()));

// ------------------------------------------------------------- segment ----
// National / regional chains and franchises: not the target, and their sites
// are run by a head office anyway.
const CHAIN = new RegExp('\\b(' + [
  "mcdonald'?s", 'kfc', 'walmart', 'wal-mart', "sam'?s club", 'chick-?fil-?a', "zaxby'?s", 'starbucks', 'subway', "wendy'?s", 'burger king', 'taco bell', 'pizza hut', "domino'?s", "papa john'?s", 'little caesars', "arby'?s", 'sonic drive', 'dairy queen', "bojangles'?", "hardee'?s", 'popeyes', "culver'?s", 'cook out', 'waffle house', 'ihop', "denny'?s", "applebee'?s", "chili'?s", 'olive garden', 'outback', 'longhorn', 'texas roadhouse', 'red lobster', 'cracker barrel', 'buffalo wild wings', 'panera', 'chipotle', 'moe.s southwest', 'five guys', "jersey mike'?s", "jimmy john'?s", 'firehouse subs', 'wingstop', 'krispy kreme', "dunkin'?", 'baskin', 'smoothie king', 'tropical smoothie', 'mellow mushroom', "freddy'?s", "raising cane'?s", 'whataburger', 'dutch bros', 'scooter.s coffee', "marco'?s pizza", 'golden corral', 'ruby tuesday', 'carrabba', 'bonefish', "captain d'?s", "shane'?s rib", "your pie", "newk'?s", 'mcalister', 'which wich', 'crumbl', 'nothing bundt', 'tgi friday', 'red robin', 'pdq', "steak ?'?n shake", "fatz", "wild wing cafe", "bruster'?s", "rita'?s", "sweetfrog", "vampire penguin", "takosushi", 'tako sushi', "cold stone", "great american cookie", "insomnia cookies", "tropical cafe", 'clean juice', 'salsarita', "willy'?s", 'jason.s deli', 'hooters', 'twin peaks', 'ale house',
  'target store', 'costco', 'kroger', 'publix', 'food lion', 'aldi', 'lidl', 'bi-lo', 'ingles', 'piggly wiggly', 'dollar general', 'dollar tree', 'family dollar', 'big lots', 'home depot', "lowe'?s", 'tractor supply', 'ace hardware', 'harbor freight', 'best buy', 'office depot', 'staples', 'hobby lobby', 'michaels stores', 'tj maxx', 't\\.j\\. maxx', 'marshalls', 'ross dress', 'belk', "kohl'?s", 'jcpenney', 'old navy', 'petsmart', 'petco', 'pet supplies plus', 'academy sports', "dick'?s sporting", 'hibbett', 'books-a-million', 'barnes (&|and) noble', 'ulta', 'sephora', 'bath & body', 'cvs', 'walgreens', 'rite aid', 'autozone', "o'?reilly", 'advance auto', 'napa auto', 'pep boys', 'jiffy lube', 'valvoline', 'take 5', 'midas', 'meineke', 'aamco', 'firestone', 'goodyear', 'discount tire', 'mavis', 'caliber collision', 'gerber collision', 'maaco', 'safelite', 'carmax', 'enterprise rent', 'hertz', 'u-haul', 'penske', 'tidal wave auto', 'mister car wash', 'zips car wash', 'take 5 car wash', 'whistle express', "goo goo", 'circle k', 'sprint food', 'pilot travel', "love'?s travel", '7-eleven', 'quiktrip', 'racetrac', 'exxon', 'murphy usa', 'batteries plus', 'sherwin', 'mattress firm', "rooms to go", 'ashley home', "badcock", "aaron'?s", 'rent-a-center', 'sleep number', "floor & decor", 'la-z-boy', "bob'?s discount", "plato'?s closet", "once upon a child", 'goodwill', 'salvation army', 'habitat for humanity', 'tuesday morning', 'ollie', 'five below', 'burlington', 'kay jewelers', 'zales', 'lenscrafters', 'pearle vision', "america'?s best", 'visionworks', 'the ups store', 'ups store', 'fedex', 'postnet', 'pak mail', 'h&r block', 'jackson hewitt', 'liberty tax', 'great clips', 'sport clips', 'supercuts', 'fantastic sams', 'smartstyle', 'european wax', 'massage envy', 'hand & stone', 'planet fitness', 'anytime fitness', 'orangetheory', 'gold.s gym', 'crunch fitness', 'ymca', 'pure barre', 'club pilates', 'f45', 'burn boot camp', '9round', 'workout anytime', 'snap fitness', 'la fitness', 'cyclebar', 'stretch ?lab', 'restore hyper', 'the joint chiropractic', 'ideal image', 'aspen dental', 'affordable dentures', 'heartland dental', 'western dental', 'banfield', 'vca ', 'servpro', 'servicemaster', 'paul davis', 'molly maid', 'merry maids', 'the maids', 'two men and a truck', 'college hunks', '1-800', 'terminix', 'orkin', 'truly nolen', 'mosquito joe', 'mosquito squad', 'lawn doctor', 'trugreen', 'weed man', 'mr\\.? rooter', 'roto-rooter', 'mr\\.? electric', 'mr\\.? handyman', 'one hour heating', 'aire serv', 'window genie', 'window world', 'budget blinds', 'closets by design', 'california closets', 'certapro', 'five star painting', 'sir speedy', 'minuteman press', 'allegra', 'fastsigns', 'signarama', 'kumon', 'sylvan', 'mathnasium', 'huntington learning', 'primrose', 'the goddard', 'kiddie academy', 'kindercare', 'comfort keepers', 'home instead', 'visiting angels', 'right at home', 'brightstar', 'senior helpers', 'griswold', 'amada senior', 'synergy homecare', 'homewatch', 'always best care', 'express employment', 'manpower', 'kelly services', 'adecco', 'aerotek', 'spherion', 'randstad', 'labor finders', 'peopleready', 'allstate', 'state farm', 'farm bureau', 'nationwide insurance', 'geico', 'progressive insurance', 'liberty mutual', 'aflac', 'new york life', 'northwestern mutual', 'edward jones', 'raymond james', 'merrill', 'morgan stanley', 'ameriprise', 'wells fargo', 'bank of america', 'truist', 'td bank', 'first citizens', 'south state', 'synovus', 'regions bank', 'pnc bank', 'chase bank', 'united community bank', 'security federal', 'ameris', 'queensborough', 'first community bank', 'palmetto state bank', 'pinnacle bank', 'srp federal', 'navy federal', 'credit union', 'primerica', 'transamerica', 'thrivent', 'modern woodmen', 'woodmenlife', 'humana', 'bluecross', 'blue cross', 'unitedhealth', 'aetna', 'cigna', 'molina', 'wellcare', 'absolute total care', 'ambetter', 'healthmarkets', 'keller williams', 're/?max', 'coldwell banker', 'century 21', 'berkshire hathaway', 'exp realty', 'era wilder', 'better homes', "sotheby'?s", 'meybohm', 'd\\.?r\\.? horton', 'lennar', 'pulte', 'ryan homes', 'stanley martin', 'great southern homes', 'mungo', 'ivey homes', 'bill beazley', 'hampton inn', 'holiday inn', 'hilton', 'marriott', 'courtyard', 'fairfield', 'towneplace', 'residence inn', 'springhill', 'home2', 'homewood', 'tru by', 'hyatt', 'best western', 'comfort inn', 'comfort suites', 'quality inn', 'sleep inn', 'econo lodge', 'clarion', 'days inn', 'super 8', 'la quinta', 'wingate', 'baymont', 'microtel', 'ramada', 'howard johnson', 'travelodge', 'motel 6', 'red roof', 'country inn', 'candlewood', 'staybridge', 'avid hotel', 'woodspring', 'extended stay', 'americas best value', 'knights inn', 'at&t', 'verizon', 't-mobile', 'boost mobile', 'cricket wireless', 'metro by', 'spectrum', 'xfinity', 'comcast', 'atlantic broadband', 'breezeline', 'dish network', 'directv', 'adt', 'vivint', 'waste management', 'republic services', 'waste pro', 'gfl environmental', 'cintas', 'unifirst', 'aramark', 'sysco', 'us foods', 'coca-cola', 'pepsi', 'budweiser', 'frito', 'dominion energy', 'duke energy', 'aiken electric', 'santee cooper', 'sunbelt rentals', 'united rentals', 'herc rentals', 'ferguson', 'fastenal', 'grainger', 'airgas', 'john deere', 'kubota', 'caterpillar', 'bobcat', 'blanchard', 'lamar', 'iheart', 'cumulus', 'gray television', 'sinclair', 'gannett', 'encompass health', 'kindred', 'amedisys', 'gentiva', 'davita', 'fresenius', 'labcorp', 'quest diagnostics', 'concentra', 'doctors care', 'medexpress', 'american family care', 'afc urgent', 'pruitthealth', 'national healthcare', 'nhc ', 'brookdale', 'sunrise senior', 'harmony senior', 'morningside', 'trinity on laurens', 'cumberland village', 'benton house', 'the claiborne', 'agape', 'lutheran homes', 'dignity memorial', 'storquest', 'public storage', 'extra space', 'cubesmart', 'life storage', 'storage rentals of america', 'stor-?it', 'paychex', 'adp', 'elliott davis', 'cherry bekaert', 'mauldin & jenkins', 'bridgestone', 'kimberly-clark', 'owens corning', 'shaw industries', 'agy', 'hubbell', 'autoneum', 'tognum', 'rolls-royce', 'mtu', 'bae systems', 'pactiv', 'halocarbon', 'glaxo', 'kemira', 'solvay', 'westinghouse', 'fluor', 'bechtel', 'jacobs engineering', 'amentum', 'honeywell', 'leidos', 'centerra', 'parsons corp', 'bwx', 'bwxt', 'atkins north', 'aecom', 'orano', 'huntington ingalls', 'longenecker', 'battelle', 'savannah river', 'newport news', 'north wind', 'veolia', 'energysolutions', 'framatome', 'holtec', 'curtiss', 'zeus industrial', 'manufactur',
  '7 brew', 'chicken salad chick', 'express oil change', 'eyemart', "groucho'?s", 'honey ?baked', 'hotworx', "huey magoo'?s", 'marble slab', 'metro diner', 'miracle-?ear', "parker'?s kitchen", 'pedego', "pelican'?s snoballs", 'precision garage door', 'scenthound', 'sport ?clips', 'stretch zone', 'whitewater express', 'zenbusiness', 'welcome wagon', 'janney montgomery', 'morton buildings', 'novus glass', 'dreammaker', 'duraclean', 'board (and|&) brush', "goin'? postal", 'fleet feet', 'fora travel', 'thompson gas', 'real broker', 'united real estate', 'lifewave', 'coolvu', 'big air', 'crowne plaza', 'tasty crab', 'covey homes', 'hub retirement', "lulu'?s express", 'jani-king', 'security finance', 'direct auto', 'centerwell', 'sun community', 'southeastern freight', 'nextera', 'burns & mcdonnell', 'emerson electric', 'dpr construction', 'martin marietta', 'imerys', 'valmet', 'w\\. ?r\\. grace', 'titan international', 'modineer', 'ambiopharm', 'active minerals', 'alkegen', 'allnex', 'agsouth', 'assurance financial', 'crescent hospice', 'epique realty', 'real estate one', 'greenjackets', 'laziza', 'aecon', 'capital waste', 'storage units', 'fire shaka', 'wixsite-none'
].join('|') + ')\\b', 'i');

// Shared corporate hosts: a local listing whose "website" is a page on one of
// these is run by a head office.
const CORPORATE_HOST = /(^|\.)(statefarm\.com|allstate\.com|edwardjones\.com|raymondjames\.com|ameripriseadvisors\.com|nm\.com|kw\.com|remax\.com|coldwellbanker\.com|century21\.com|bhhs\w*\.com|meybohm\.com|hilton\.com|marriott\.com|ihg\.com|choicehotels\.com|wyndhamhotels\.com|hyatt\.com|bestwestern\.com|chick-fil-a\.com|mcdonalds\.com|orangetheory\.com|anytimefitness\.com|planetfitness\.com|greatclips\.com|hrblock\.com|theupsstore\.com|servpro\.com|servicemaster\w*\.com|comfortkeepers\.com|homeinstead\.com|visitingangels\.com|expresspros\.com|farmbureauinsurance\.com|scfbins\.com|nationwide\.com|primerica\.com|thrivent\.com|truist\.com|wellsfargo\.com|bankofamerica\.com|firstcitizens\.com|southstatebank\.com|synovus\.com|regions\.com|aaa\.com|uhaul\.com|sherwin-williams\.com|cintas\.com|waste\w*\.com|republicservices\.com|encompasshealth\.com|brookdale\.com|dignitymemorial\.com|mosquitojoe\.com|budgetblinds\.com|minutemanpress\.com|fastsigns\.com|signarama\.com|two-men\w*\.com|neighborly\.com|goddardschool\.com|primroseschools\.com|kumon\.com|sylvanlearning\.com|mathnasium\.com|wixsite-chain\.invalid)$/i;

// Institutions, public bodies and large employers.
const INSTITUTION_CAT = /government|nonprofit|non-profit|club \(|hospital|bank\b|credit union|credit card|school|college|university|education\b|utilit|library|sheriff|chamber|economic development|downtown development|church|religious|homeowner|airport|museum|arts organization|arts center|community theatre|service agency|community services|human services|veteran service|blood center|animal shelter|equine rescue|workforce|housing|disabilities|civic|foundation|associations?$|public schools|military|municipal|county|city of|town of|fire dep|chamber of commerce/i;
const CORPORATE_CAT = /industrial|manufactur|nuclear|government contract|medicare|apartment|staffing|temporary help|technical staff|media\b|media\(|newspaper|television|radio|telecommunications|cellular|internet service|electric utilit|energy company|consultant \(energy\)|mining|quarry|international trade|research \+ development|nursing \+ rehab|assisted living|senior care|long-term care|retirement community|independent\/assisted|hospice|home health|health care facilities|medical facility|prompt care|physician|orthopedic|ambulance|freight|logistics|mortgage|loans|manufactured home|engineering|aging life care/i;
const PUBLIC_PLACE = /\b(state park|pond park|towne park|whitney park|arboretum|nature preserve|heritage preserve|hopelands gardens|state historic site|recreation center|tennis center|polo field|powderhouse field|youth center|conference center|cultural district|audubon|training track|rye patch|inclined plane|land conservancy|small business development|places of innovation|state senate|energy workers|south boundary singers|philharmonic|fox hounds|livery stable|center for african american history)\b/i;
const DEALER = /\b(chevrolet|ford|kia|hyundai|honda cars|cdjr|gmc|toyota|nissan|buick|cadillac|auto group)\b/i;
const INSTITUTION_NAME = /\b(city of|town of|county of|aiken county|chamber|association|foundation|society|ministr|church|baptist|methodist|episcopal|presbyterian|catholic|lutheran|school|academy|university|usc aiken|college|library|museum|ymca|rotary|kiwanis|lions club|junior league|united way|habitat|red cross|salvation army|hospital|medical center|health system|regional medical|sheriff|police|fire department|department of|commission|authority|council|coalition|alliance|league|guild|historical|friends of|\bfotas\b|spca|humane|rescue|shelter|symphony|ballet|theatre|theater|playhouse|arts center|center for the arts|performing arts|cemetery|post office|national guard|political|republican|democrat|party of|u\.?s\.? army|veterans|american legion|vfw|boy scouts|girl scouts|boys & girls|4-h|extension|soil and water|public works|housing authority|senior center|council on aging|hitchcock woods|development partnership|development corp|visit ?aiken|srp\b|sr[ns]s\b)\b/i;
const INSTITUTION_HOST = /\.(gov|edu|mil)$|\.k12\.|\.sc\.us$/i;

function segmentOf(rec) {
  const name = [...rec.names].join(' | ');
  const cats = [...rec.categories].join(' | ');
  const host = hostOf(rec.website);
  if (CHAIN.test(name)) return 'chain';
  if (host && CORPORATE_HOST.test(host)) return 'chain';
  if (INSTITUTION_HOST.test(host) || INSTITUTION_NAME.test(name) || PUBLIC_PLACE.test(name) || INSTITUTION_CAT.test(cats)) return 'institution';
  if (DEALER.test(name)) return 'corporate';
  if (host.endsWith('.org') && !/restaurant|shopping|retail/i.test(cats)) return 'institution';
  if (CORPORATE_CAT.test(cats)) return 'corporate';
  return 'local';
}

// A domain shared by several different listings is a corporate site.
const hostCount = new Map();
for (const r of records) { const h = hostOf(r.website); if (h) hostCount.set(h, (hostCount.get(h) || 0) + 1); }

// ---------------------------------------------------------------- write ----
const slugs = new Set();
const slugify = (s) => {
  let base = s.toLowerCase().replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/, '');
  let slug = base, i = 2;
  while (slugs.has(slug)) slug = `${base}-${i++}`;
  slugs.add(slug);
  return slug;
};

const out = records.map((r) => {
  const host = hostOf(r.website);
  let segment = segmentOf(r);
  if (segment === 'local' && host && hostCount.get(host) >= 3) segment = 'chain';
  const inArea = r.city !== 'OUT';
  const names = [...r.names].map((n) => n.toLowerCase());
  if (names.some((n) => forceIn.has(n))) segment = 'local';
  if (names.some((n) => forceOut.has(n))) segment = 'other';
  const include = segment === 'local' && inArea;
  return {
    slug: slugify(r.name),
    name: r.name,
    segment,
    include,
    city: r.city === 'OUT' ? '' : r.city,
    inArea,
    address: r.address,
    phone: r.phone,
    email: r.email,
    website: r.website,
    host,
    social: r.social,
    contact: r.contact,
    categories: [...r.categories],
    blurb: r.blurb,
    chamberMemberSince: r.since,
    sources: [...r.sources],
    sourceUrls: [...r.sourceUrls],
  };
}).sort((a, b) => a.name.localeCompare(b.name));

await writeFile(new URL('../data/businesses.json', import.meta.url), JSON.stringify(out, null, 1));

const count = (f) => out.filter(f).length;
console.log(`merged ${raw.length} raw listings -> ${out.length} unique businesses`);
console.log(`  segments: local ${count((r) => r.segment === 'local')}, chain ${count((r) => r.segment === 'chain')}, institution ${count((r) => r.segment === 'institution')}, corporate ${count((r) => r.segment === 'corporate')}`);
console.log(`  out of area: ${count((r) => !r.inArea)}`);
console.log(`  INCLUDED (local + in area): ${count((r) => r.include)}  with website: ${count((r) => r.include && r.website)}  social only: ${count((r) => r.include && !r.website && r.social)}  phone: ${count((r) => r.include && r.phone)}  email: ${count((r) => r.include && r.email)}`);
