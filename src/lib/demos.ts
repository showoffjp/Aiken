// Every redesign concept is one JSON file in src/demos. This module loads
// them all and gives the pages a typed, sorted list.
import fontsJson from './fonts.json';
import { client } from './client';
import sizesJson from './image-sizes.json';
import tintsJson from './image-tints.json';

export type Img = { src: string; alt: string; width?: number; height?: number; fit?: 'cover' | 'contain' };
export type Cta = { label: string; href: string };

export type Section =
  | { type: 'services'; id?: string; nav?: string; eyebrow?: string; title: string; intro?: string; columns?: 2 | 3 | 4; style?: 'cards' | 'list'; items: { icon?: string; title: string; text?: string }[] }
  | { type: 'story'; id?: string; nav?: string; eyebrow?: string; title: string; body: string[]; image?: Img; list?: string[]; quote?: { text: string; by?: string }; flip?: boolean }
  | { type: 'menu'; id?: string; nav?: string; eyebrow?: string; title: string; intro?: string; footnote?: string; printLabel?: string; groups: { title: string; note?: string; items: { name: string; desc?: string; price?: string }[] }[] }
  | { type: 'gallery'; id?: string; nav?: string; eyebrow?: string; title: string; intro?: string; images: Img[] }
  | { type: 'steps'; id?: string; nav?: string; eyebrow?: string; title: string; intro?: string; items: { title: string; text: string }[] }
  | { type: 'quotes'; id?: string; nav?: string; eyebrow?: string; title: string; items: { text: string; by?: string }[] }
  | { type: 'faq'; id?: string; nav?: string; eyebrow?: string; title: string; items: { q: string; a: string }[] }
  | { type: 'columns'; id?: string; nav?: string; eyebrow?: string; title: string; intro?: string; columns: { title: string; items: string[] }[] }
  | { type: 'track'; id?: string; nav?: string; eyebrow?: string; title: string; intro?: string; carriers?: string[] }
  | { type: 'band'; id?: string; title: string; text?: string; cta?: Cta };

export type Demo = {
  slug: string;
  /** ISO date the concept joined the portfolio; the home page marks it New for a few weeks. */
  added?: string;
  /** slug of the matching row in data/prospects.json, if it differs */
  prospect?: string;
  name: string;
  short?: string;
  category: string;
  group: string;
  town: string;
  look: 'editorial' | 'bold' | 'warm' | 'clean' | 'boutique';
  /** `accent` is an optional third face (handwriting, mono) used by some hero styles. */
  fonts: { display: keyof typeof fontsJson; body: keyof typeof fontsJson; accent?: keyof typeof fontsJson };
  /** Per-concept personality: layout archetype and section treatments (see demo.css). */
  style?: {
    hero?: 'poster' | 'bento' | 'board' | 'collage' | 'blueprint' | 'magazine' | 'diagonal' | 'spotlight';
    frame?: 'arch' | 'circle' | 'polaroid' | 'offset' | 'blob' | 'slant';
    flip?: boolean;
    services?: 'grid' | 'list' | 'tiles' | 'pills' | 'rows';
    facts?: 'strip' | 'big' | 'badges' | 'ticker';
    pattern?: 'dots' | 'grid' | 'stripes' | 'waves' | 'checker' | 'none';
    divider?: 'wave' | 'zigzag' | 'slant' | 'curve' | 'none';
    heads?: 'numbered' | 'outline' | 'center' | 'rule' | 'plain';
    motion?: 'rise' | 'slide' | 'zoom' | 'blur' | 'flip' | 'clip';
    buttons?: 'pill' | 'square' | 'underline' | 'shadow' | 'outline';
  };
  colors: { bg: string; surface: string; ink: string; muted: string; primary: string; onPrimary: string; accent: string; line: string };
  radius?: number;
  icon: string;
  established?: string;
  logo?: Img;
  contact: {
    phone?: string; phoneLabel?: string; phone2?: string; phone2Label?: string; email?: string;
    address?: string[]; mapQuery?: string;
    hours?: [string, string][]; hoursNote?: string;
    facebook?: string; instagram?: string;
  };
  hero: { variant?: 'split' | 'banner' | 'centered' | 'photo'; eyebrow?: string; title: string; lede: string; cta?: Cta; cta2?: Cta; image?: Img; points?: string[] };
  facts?: { value: string; label: string }[];
  sections: Section[];
  visit?: { title?: string; intro?: string; formTitle?: string; formTopics?: string[]; hideForm?: boolean };
  /** Photo-heavy concepts: full-screen scroll-driven hero, pinned photo scenes and parallax galleries. */
  cinematic?: boolean | { heroImage?: string };
  /** `none` marks a business with no website of its own; `url` is then the public listing the words came from. */
  source: { url: string; before: string[]; after?: string[]; none?: boolean };
};

const files = import.meta.glob<{ default: Demo }>('../demos/*.json', { eager: true });

// Image dimensions are recorded by scripts/assets.mjs; attach them to every
// image so the browser can reserve space before the file arrives.
const sizes = sizesJson as Record<string, [number, number]>;
function withSizes<T>(node: T): T {
  if (Array.isArray(node)) return node.map(withSizes) as T;
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = withSizes(v);
    const src = out.src;
    if (typeof src === 'string' && sizes[src] && !out.width) [out.width, out.height] = sizes[src];
    return out as T;
  }
  return node;
}

const all: Demo[] = Object.values(files)
  .map((m) => withSizes(m.default))
  .sort((a, b) => a.name.localeCompare(b.name));
// In launch mode (CLIENT=<slug>, src/lib/client.ts) only that business's concept is built.
if (client && !all.some((d) => d.slug === client)) throw new Error(`CLIENT=${client} does not match any concept in src/demos`);
export const demos: Demo[] = client ? all.filter((d) => d.slug === client) : all;

export const fonts = fontsJson as Record<string, { family: string; fallback: string; normal: string; italic?: string }>;

/** A srcset with the 640px and 960px copies (made by scripts/variants.mjs) when they exist. */
export function srcset(img?: Img): string | undefined {
  if (!img?.src || !img.width || !/\.webp$/.test(img.src)) return undefined;
  const parts = [640, 960]
    .map((w) => img.src.replace(/\.webp$/, `-${w}.webp`))
    .filter((s) => sizes[s])
    .map((s) => `${s} ${sizes[s][0]}w`);
  return parts.length ? [...parts, `${img.src} ${img.width}w`].join(', ') : undefined;
}

export const telHref = (phone = '') => `tel:+1${phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')}`;

/** `*word*` in a title becomes an emphasised span. Everything else is escaped. */
export function title(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export const sectionId = (s: Section, i: number) => ('id' in s && s.id) || `${s.type}-${i + 1}`;

/** For cinematic concepts: the landscape photos large enough to fill a screen. */
export const isScenic = (img?: Img) => !!img?.width && !!img?.height && img.width >= 1000 && img.width / img.height >= 1.2;

/** The cinematic hero photo: an explicit choice, else the hero image if it is wide, else the widest large gallery photo. */
/** Empty cells a CSS grid (auto-flow dense) would leave placing these tiles in `cols` columns. */
function gridHoles(shapes: string[], cols: number) {
  const taken: boolean[][] = [];
  let rows = 0, used = 0;
  for (const sh of shapes) {
    const w = sh === 'wide' ? Math.min(2, cols) : 1, h = sh === 'tall' ? 2 : 1;
    const fits = (r: number, c: number) => { for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) if (taken[r + dr]?.[c + dc]) return false; return true; };
    let r = 0, c = 0;
    for (;; r++) { c = Array.from({ length: cols - w + 1 }, (_, k) => k).find((k) => fits(r, k)) ?? -1; if (c >= 0) break; }
    for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) (taken[r + dr] ||= [])[c + dc] = true;
    rows = Math.max(rows, r + h); used += w * h;
  }
  return rows * cols - used;
}

/**
 * Gallery tile shapes ('wide' 2x1, 'tall' 1x2, '' 1x1) for the four-column grid
 * (two on phones). Each photo's proportions suggest its shape; when that would
 * leave gaps at either width, the arrangement with no gaps and the least
 * cropping wins (cost: how far each photo's proportions are from its tile's,
 * plus a little for every change). Galleries of three or fewer sit in one row
 * instead (`.gallery.few`), so their tiles are all plain. When no gap-free
 * arrangement avoids a hard crop, every tile stays plain and the last row is
 * centred (`.gallery.center`).
 */
export function galleryShapes(images: Img[]): { shapes: string[]; center: boolean } {
  const ratio = (i: Img) => (i.width && i.height ? i.width / i.height : 1);
  const plain = images.map(() => '');
  if (images.length <= 3) return { shapes: plain, center: false };
  const base = images.map((img, n) => (ratio(img) > 1.55 && n % 3 === 0 ? 'wide' : ratio(img) < 0.72 ? 'tall' : ''));
  const gaps = (sh: string[]) => gridHoles(sh, 4) + gridHoles(sh, 2);
  if (!gaps(base)) return { shapes: base, center: false };
  const target: Record<string, number> = { '': 1, wide: 2, tall: 0.49 };
  const crop = (img: Img, sh: string) => Math.abs(Math.log(ratio(img) / target[sh]));
  const options = images.map((img, i) => ['', ratio(img) >= 1 ? 'wide' : 'tall'].map((sh) => ({ sh, cost: crop(img, sh) + (sh !== base[i] ? 0.3 : 0) + (sh ? 0.1 : 0) })));
  let best = { gaps: gaps(base), cost: Infinity, pick: base };
  const walk = (i: number, pick: string[], cost: number) => {
    if (cost >= best.cost && best.gaps === 0) return;
    if (i === images.length) { const g = gaps(pick); if (g < best.gaps || (g === best.gaps && cost < best.cost)) best = { gaps: g, cost, pick: [...pick] }; return; }
    for (const o of options[i]) { pick.push(o.sh); walk(i + 1, pick, cost + o.cost); pick.pop(); }
  };
  walk(0, [], 0);
  // A square portrait stretched to a 2:1 tile loses faces: rather than crop that hard
  // (or leave a gap), keep every tile plain and centre the last row.
  if (best.gaps || best.pick.some((sh, i) => sh && crop(images[i], sh) > 0.6)) return { shapes: plain, center: true };
  return { shapes: best.pick, center: false };
}

/**
 * A `sizes` value for a photo that fills (object-fit: cover) a box of the given
 * shape: a wide photo in a square or upright frame is drawn wider than the box,
 * so the browser needs a correspondingly larger file to stay sharp.
 * `vw` is the box's width on [phones, larger screens]; `box` is the box's width/height.
 * `phoneAsIs` keeps the phone size uncorrected: for the first image on the page
 * (the hero), a smaller file that shows up sooner matters more than the crop.
 */
export function coverSizes(img: Img, box: number, vw: [number, number], bp = 860, phoneAsIs = false) {
  const r = img.width && img.height ? img.width / img.height : 1;
  const k = Math.max(1, r / box);
  return `(max-width: ${bp}px) ${phoneAsIs ? vw[0] : Math.min(Math.round(vw[0] * k), 200)}vw, ${Math.min(Math.round(vw[1] * k), 100)}vw`;
}

export function cinematicHero(demo: Demo): Img | undefined {
  const all: Img[] = [demo.hero.image, ...demo.sections.flatMap((s: any) => [...(s.images || []), s.image])].filter(Boolean) as Img[];
  const pick = typeof demo.cinematic === 'object' && demo.cinematic.heroImage ? all.find((i) => i.src === (demo.cinematic as { heroImage?: string }).heroImage) : undefined;
  if (pick) return pick;
  if (isScenic(demo.hero.image)) return demo.hero.image;
  return all.filter(isScenic).sort((a, b) => (b.width || 0) - (a.width || 0))[0] || demo.hero.image;
}

/** What the business offers, in its own words: hero points, else service names, else facts. */
export function offerWords(demo: Demo, max = 8): string[] {
  if (demo.hero.points?.length) return demo.hero.points.slice(0, max);
  // The first section about what they sell or do (not the team or reviews).
  const people = /team|staff|people|meet|who we|about|review|client|testimonial|guide/i;
  for (const s of demo.sections as any[]) {
    if (people.test(`${s.nav || ''} ${s.eyebrow || ''}`)) continue;
    let w: string[] = [];
    if (s.type === 'services') w = s.items.map((i: any) => i.title);
    else if (s.type === 'menu') w = s.groups.map((g: any) => g.title);
    else if (s.type === 'columns') w = [...s.columns.map((c: any) => c.title), ...s.columns.flatMap((c: any) => c.items.slice(0, 2))];
    if (w.length >= 2) return w.slice(0, max);
  }
  return (demo.facts || []).map((f) => f.value).slice(0, max);
}

/** The business's own icons (its emblem plus the icons on its services), for decoration. */
export function brandIcons(demo: Demo, max = 6): string[] {
  const fromSections = demo.sections.flatMap((s: any) => (s.items || []).map((i: any) => i.icon)).filter(Boolean);
  const all = [demo.icon, ...fromSections].filter((v, k, a) => a.indexOf(v) === k && !['check', 'circle', 'arrow-right'].includes(v));
  while (all.length && all.length < max) all.push(...all.slice(0, max - all.length));
  return all.slice(0, max);
}

/** The contact card's file name: "Herbal Solutions & Spa" -> "Herbal-Solutions-and-Spa". */
export const vcardFile = (demo: Demo) =>
  demo.name.replace(/&/g, ' and ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || demo.slug;

const tints = tintsJson as Record<string, string>;
/** A photo's average colour as its background while it loads (not for contained cut-outs). */
export const tint = (img?: Img) => (img && img.fit !== 'contain' && tints[img.src] ? `background-color:${tints[img.src]}` : undefined);
