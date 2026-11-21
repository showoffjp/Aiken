// What a concept tells search engines about the business: the schema.org
// markup it ships, the title and description its real home page would use,
// and the opening hours in the structured form Google reads. Shared by the
// concept page and the SEO report so the two always agree.
import type { Demo } from './demos';

const TYPE: Record<string, string> = {
  'Food & Drink': 'FoodEstablishment', 'Shops & Boutiques': 'Store', Services: 'LocalBusiness', 'Home & Garden': 'HomeAndConstructionBusiness',
  'Health & Beauty': 'HealthAndBeautyBusiness', Professional: 'ProfessionalService', 'Trades & Industry': 'HomeAndConstructionBusiness',
  'Auto & Equipment': 'AutomotiveBusiness', 'Stay & Play': 'LocalBusiness',
};
// The most specific schema.org type the category supports: Google treats a
// Restaurant or an AutoRepair shop with more detail than a plain LocalBusiness.
const SPECIFIC: [RegExp, string][] = [
  [/bed and breakfast|b&b/i, 'BedAndBreakfast'], [/suites|inn\b|hotel|lodg/i, 'LodgingBusiness'],
  [/ice cream|soft serve/i, 'IceCreamShop'], [/bakery|bagel/i, 'Bakery'], [/caf[eé]|coffee|smoothie|juice|shakes/i, 'CafeOrCoffeeShop'],
  [/restaurant|eatery|pizzeria|barbe?cue|kitchen|grill|dinner|cooking|catering|food truck|taqueria|hot dogs|seafood|sub |steakhouse|sushi|breakfast/i, 'Restaurant'], [/lounge|pub\b|bar\b/i, 'BarOrPub'],
  [/auto|truck|trailer|glass/i, 'AutoRepair'], [/attorney|law/i, 'Attorney'], [/dentist/i, 'Dentist'], [/insurance/i, 'InsuranceAgency'],
  [/bookkeeping|accountant/i, 'AccountingService'], [/architect/i, 'ProfessionalService'], [/florist/i, 'Florist'], [/jewel/i, 'JewelryStore'],
  [/furniture|mattress/i, 'FurnitureStore'], [/antique/i, 'Store'], [/hair salon|hair restoration/i, 'HairSalon'], [/massage/i, 'HealthAndBeautyBusiness'],
  [/plumb/i, 'Plumber'], [/heating|cooling|hvac/i, 'HVACBusiness'], [/roof/i, 'RoofingContractor'], [/landscape|tree/i, 'HomeAndConstructionBusiness'],
  [/remodel|custom homes|construction/i, 'GeneralContractor'], [/drag strip|race ?track|speedway/i, 'SportsActivityLocation'], [/printing/i, 'ProfessionalService'], [/photograph/i, 'ProfessionalService'],
  [/pet sitting|dog walking/i, 'LocalBusiness'], [/clean/i, 'DryCleaningOrLaundry'], [/training track/i, 'SportsActivityLocation'], [/playground/i, 'EntertainmentBusiness'], [/tours?\b|trail rides?/i, 'TouristAttraction'],
  [/arcade|pinball/i, 'EntertainmentBusiness'], [/real estate|realty/i, 'RealEstateAgent'],
];
export const businessType = (demo: Demo) => SPECIFIC.find(([re]) => re.test(demo.category))?.[1] || TYPE[demo.group] || 'LocalBusiness';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayIndex = (w: string) => DAYS.findIndex((d) => d.toLowerCase().startsWith(w.toLowerCase().slice(0, 3)) && w.length >= 3);

/** "Monday – Friday", "Saturday & Sunday", "Tuesday" -> day names; null if the label says anything else. */
function parseDays(label: string): string[] | null {
  const t = label.trim();
  const range = t.match(/^([A-Za-z]+)\s*[–—-]\s*([A-Za-z]+)$/);
  if (range) {
    const a = dayIndex(range[1]), b = dayIndex(range[2]);
    if (a < 0 || b < 0) return null;
    const out: string[] = [];
    for (let i = a; ; i = (i + 1) % 7) { out.push(DAYS[i]); if (i === b) break; }
    return out;
  }
  const list = t.split(/\s*(?:&|,|and)\s*/);
  const idx = list.map(dayIndex);
  return idx.every((i) => i >= 0) ? idx.map((i) => DAYS[i]) : null;
}

/** "8:30 am – 5:00 pm", "12:30 – 5:00 pm", "9:00 – 5:00" -> ["08:30", "17:00"]; null if unclear. */
function parseSpan(span: string): [string, string] | null {
  const m = span.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let [, h1, m1 = '00', s1, h2, m2 = '00', s2] = m;
  let a = +h1, b = +h2;
  if (a > 12 || b > 12) return null;
  s1 = s1?.toLowerCase(); s2 = s2?.toLowerCase();
  if (!s2 && !s1) {
    // Business hours written without am/pm: opens in the morning, closes after it (9:00 – 5:00, 9:00 – 12:00).
    s1 = a >= 6 && a <= 11 ? 'am' : 'pm';
    s2 = b === 12 || b <= a ? 'pm' : s1;
  } else if (!s1) {
    // "12:30 – 5:00 pm", "5 – 8 pm": same half of the day as the close, unless that puts the open after it.
    const as24 = (h: number, s: string) => (h % 12) + (s === 'pm' ? 12 : 0);
    s1 = as24(a, s2!) <= as24(b, s2!) ? s2 : 'am';
  } else if (!s2) return null;
  const to24 = (h: number, mm: string, s: string) => `${String((h % 12) + (s === 'pm' ? 12 : 0)).padStart(2, '0')}:${mm}`;
  const open = to24(a, m1, s1!), close = to24(b, m2, s2!);
  return open < close ? [open, close] : null;
}

/**
 * Opening hours as schema.org OpeningHoursSpecification. All-or-nothing: if any
 * row cannot be read with confidence the hours are left out, because partial
 * hours would tell Google the business is closed on the missing days.
 */
export function openingHours(hours?: [string, string][]) {
  if (!hours?.length) return null;
  const specs: { '@type': string; dayOfWeek: string[]; opens: string; closes: string }[] = [];
  for (const [label, value] of hours) {
    const days = parseDays(label);
    if (!days) return null;
    if (/^closed$/i.test(value.trim())) continue;
    for (const part of value.split(/\s*[·,;]\s*|\s+and\s+/)) {
      const span = parseSpan(part);
      if (!span) return null;
      specs.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens: span[0], closes: span[1] });
    }
  }
  return specs.length ? specs : null;
}

export const mapLink = (demo: Demo) =>
  demo.contact.mapQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(demo.contact.mapQuery)}` : '';

/** schema.org markup for the business, as the real site would ship it. */
const plain = (t = '') => t.replace(/\*/g, '').replace(/\s+/g, ' ').trim();

/** A listed price as schema.org reads it: "$12.99", "$45–65", "from $60", "$65+", "$30 / hr", "6.95 / 14.95". */
export function priceLd(p?: string): Record<string, unknown> | undefined {
  if (!p || /market|varies|ask|call|free|\bfor\b/i.test(p)) return undefined;
  const nums = [...p.replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)].map((m) => +m[0]);
  if (!nums.length || nums.length > 2) return undefined;
  const hourly = /\/\s*(hr|hour)\b/i.test(p);
  const atLeast = /\+|from/i.test(p);
  if (nums.length === 1 && !atLeast && !hourly) return { price: nums[0].toFixed(2), priceCurrency: 'USD' };
  return { priceSpecification: {
    '@type': hourly ? 'UnitPriceSpecification' : 'PriceSpecification',
    ...(nums.length === 1 && !atLeast ? { price: nums[0] } : { minPrice: nums[0] }),
    ...(nums.length === 2 && { maxPrice: nums[1] }),
    priceCurrency: 'USD',
    ...(hourly && { unitText: 'hour' }),
  } };
}

/**
 * What the business sells, in the form Google reads: a restaurant's menu as
 * Menu > MenuSection > MenuItem (with prices where the page lists them); any
 * other business's price list or services as an OfferCatalog.
 */
export function offersLd(demo: Demo) {
  const sections = demo.sections as any[];
  const menus = sections.filter((s) => s.type === 'menu');
  const food = demo.group === 'Food & Drink';
  if (food && menus.length) {
    const menu = (s: any) => ({
      '@type': 'Menu', name: plain(s.nav || s.title),
      hasMenuSection: s.groups.map((g: any) => ({
        '@type': 'MenuSection', name: plain(g.title), ...(g.note && { description: plain(g.note) }),
        hasMenuItem: g.items.map((it: any) => {
          const price = priceLd(it.price);
          return { '@type': 'MenuItem', name: plain(it.name), ...(it.desc && { description: plain(it.desc) }), ...(price && { offers: { '@type': 'Offer', ...price } }) };
        }),
      })),
    });
    return { hasMenu: menus.length === 1 ? menu(menus[0]) : menus.map(menu) };
  }
  const offer = (name: string, description?: string, price?: string) => {
    const p = priceLd(price);
    return { '@type': 'Offer', itemOffered: { '@type': 'Service', name: plain(name), ...(description && { description: plain(description) }) }, ...(p || {}) };
  };
  // A price list (grooming, massage, party packages): only when most of it is priced,
  // so a list of plan features or concession snacks is not passed off as services.
  const priced = menus.find((s) => { const items = s.groups.flatMap((g: any) => g.items); return items.filter((it: any) => priceLd(it.price)).length * 2 >= items.length; });
  if (priced) {
    return { hasOfferCatalog: { '@type': 'OfferCatalog', name: plain(priced.nav || priced.title), itemListElement: priced.groups.map((g: any) => ({
      '@type': 'OfferCatalog', name: plain(g.title),
      // "Small, 5–20 lb" means nothing on its own: name each item with its group ("Haircut: Small, 5–20 lb").
      itemListElement: g.items.map((it: any) => offer(new RegExp(plain(g.title).split(/\s+/)[0], 'i').test(it.name) ? it.name : `${plain(g.title)}: ${it.name}`, it.desc, it.price)),
    })) } };
  }
  // Otherwise the services section, if the page labels it as what the business offers
  // (not "The park", "Your stay" or a list of selling points).
  if (food) return {};
  const offering = /\b(services|practice areas|products|floors|rentals|sessions|what we build|what we make|custom work|auto glass|the rides)\b/i;
  const services = sections.find((s) => s.type === 'services' && s.items?.length >= 2 && offering.test(`${s.id || ''} ${s.nav || ''}`));
  if (!services) return {};
  return { hasOfferCatalog: { '@type': 'OfferCatalog', name: plain(services.nav || services.title), itemListElement: services.items.map((it: any) => offer(it.title, it.text)) } };
}

export function businessLd(demo: Demo, siteUrl = '') {
  const { contact, hero } = demo;
  const addr = contact.address?.length ? contact.address : undefined;
  const town = demo.town.replace(/,?\s*SC$/i, '');
  const hoursSpec = openingHours(contact.hours);
  const sameAs = [contact.facebook, contact.instagram].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': businessType(demo),
    name: demo.name,
    description: hero.lede,
    ...(siteUrl && { url: `${siteUrl}/${demo.slug}/` }),
    ...(contact.phone && { telephone: contact.phone }),
    ...(contact.email && { email: contact.email }),
    ...(addr && { address: { '@type': 'PostalAddress', streetAddress: addr.length > 1 ? addr[0] : undefined, addressLocality: town, addressRegion: 'SC', addressCountry: 'US' } }),
    ...(mapLink(demo) && { hasMap: mapLink(demo) }),
    areaServed: { '@type': 'City', name: `${town}, South Carolina` },
    ...(hoursSpec && { openingHoursSpecification: hoursSpec }),
    ...(hero.image && siteUrl && { image: `${siteUrl}${hero.image.src}` }),
    ...(demo.established && { foundingDate: demo.established }),
    ...(sameAs.length && { sameAs }),
    ...offersLd(demo),
  };
}

const clip = (text: string, max: number) => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const words = cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 15)).replace(/[,;:–—-]\s*$/, '');
  return /[.!?]$/.test(words) ? words : `${words}…`;
};

/** The title and description the real home page would use: business, service and town, sized to show in full. */
export function proposedMeta(demo: Demo) {
  const town = demo.town.replace(/,?\s*SC$/i, '');
  const candidates = [
    `${demo.name} | ${demo.category} in ${town}, SC`,
    `${demo.name} | ${demo.category} in ${town}`,
    `${demo.short || demo.name} | ${demo.category} in ${town}`,
    `${demo.short || demo.name} | ${town}, SC`,
  ];
  const title = candidates.find((t) => t.length <= 60) || clip(candidates[candidates.length - 1], 60);
  const lede = demo.hero.lede.replace(/\s+/g, ' ').trim();
  const withCall = demo.contact.phone ? `${lede} Call ${demo.contact.phone}.` : lede;
  const description = withCall.length <= 158 ? withCall : clip(lede, 158);
  return { title, description };
}

/** How Google would show a title and description: roughly 60 and 158 characters before it cuts them off. */
export const serp = (title = '', description = '') => ({
  title: clip(title, 61), titleCut: title.replace(/\s+/g, ' ').trim().length > 61,
  description: clip(description, 159), descriptionCut: description.replace(/\s+/g, ' ').trim().length > 159,
});
