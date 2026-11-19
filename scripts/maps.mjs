// Street maps for the "Find us" panels, drawn from OpenStreetMap data instead
// of loading an embedded Google map up front.
//   1. Geocode each concept's address with Nominatim (once, cached in
//      data/geo.json; one request a second, as its usage policy asks).
//   2. Take the streets, water, parks and buildings around that point from
//      OpenFreeMap's vector tiles (OpenMapTiles schema, zoom 14).
//   3. Save them as small SVG path data in data/maps/<slug>.json, projected
//      onto an 800x500 frame with the business at the centre. The page paints
//      them in the concept's own colours.
// Usage: node scripts/maps.mjs [slug ...] [--refresh]
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEO = path.join(ROOT, 'data', 'geo.json');
const OUT = path.join(ROOT, 'data', 'maps');
const TILES = path.join(ROOT, '.cache', 'tiles');
const UA = 'aiken-web-refresh-maps/1.0 (static site build; cached)';
const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const only = args.filter((a) => !a.startsWith('--'));

const W = 800, H = 500, Z = 14;
const MPP = 1.5; // metres per frame unit: the frame shows about 1.2 km x 750 m
await mkdir(OUT, { recursive: true });
await mkdir(TILES, { recursive: true });
const geo = JSON.parse(await readFile(GEO, 'utf8').catch(() => '{}'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const demos = [];
for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json'))) demos.push(JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8')));

// --- 1. geocoding -----------------------------------------------------------
async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' } });
  await sleep(1100);
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return (await res.json())[0];
}
async function locate(d) {
  const addr = d.contact.address;
  if (!addr?.length || !/\d/.test(addr[0])) return null; // no street address to pin
  const key = addr.join(', ');
  if (!refresh && geo[d.slug]?.q === key) return geo[d.slug];
  // A street, or a whole town, is not the address: the pin could be miles off.
  const exactOf = (h) => h && h.category !== 'highway' && !['road', 'city', 'town', 'village', 'postcode', 'county', 'state', 'hamlet', 'suburb', 'municipality', 'neighbourhood'].includes(h.addresstype);
  let hit = await nominatim(key);
  // "Suite 4", a plaza name and the like confuse the geocoder; try the plain
  // street line, then the business's own name and address.
  const plain = `${addr[0].split(',')[0].replace(/\s*(suite|ste|unit|#)\s*\S+$/i, '')}, ${addr[addr.length - 1]}`;
  if (!exactOf(hit) && plain !== key) hit = (await nominatim(plain)) || hit;
  if (!exactOf(hit) && d.contact.mapQuery && d.contact.mapQuery !== key) hit = (await nominatim(d.contact.mapQuery)) || hit;
  const rec = hit
    ? { q: key, lat: +(+hit.lat).toFixed(6), lon: +(+hit.lon).toFixed(6), kind: hit.addresstype || hit.type, exact: exactOf(hit), at: new Date().toISOString().slice(0, 10) }
    : { q: key, missing: true, at: new Date().toISOString().slice(0, 10) };
  geo[d.slug] = rec;
  return rec;
}

// --- 2. tiles ---------------------------------------------------------------
let tileUrl;
async function tile(x, y) {
  const file = path.join(TILES, `${Z}-${x}-${y}.pbf`);
  if (existsSync(file)) return readFile(file);
  if (!tileUrl) tileUrl = (await (await fetch('https://tiles.openfreemap.org/planet', { headers: { 'user-agent': UA } })).json()).tiles[0];
  const res = await fetch(tileUrl.replace('{z}', Z).replace('{x}', x).replace('{y}', y), { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`tile ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return buf;
}

// --- 3. projection and drawing data -----------------------------------------
const toTile = (lat, lon) => {
  const n = 2 ** Z, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
};
// Ramer-Douglas-Peucker, in frame units.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let far = -1, best = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > best) { best = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const M = 60; // margin kept around the frame
const inside = ([x, y]) => x > -M && x < W + M && y > -M && y < H + M;
// Split a line into the runs that cross the frame.
function runs(pts) {
  const out = []; let cur = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], prev = pts[i - 1], next = pts[i + 1];
    if (inside(p) || (prev && inside(prev)) || (next && inside(next))) cur.push(p);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out.filter((r) => r.length > 1);
}
const d = (pts, close) => 'M' + pts.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join('L') + (close ? 'Z' : '');

const ROAD = { motorway: 'major', trunk: 'major', primary: 'major', secondary: 'major', tertiary: 'mid', minor: 'minor', service: 'minor', track: 'path', path: 'path', rail: 'rail' };

async function build(d0, at) {
  const [cx, cy] = toTile(at.lat, at.lon);
  const metersPerTile = (40075016.686 * Math.cos((at.lat * Math.PI) / 180)) / 2 ** Z;
  const k = metersPerTile / MPP; // frame units per tile
  const fx = (tx) => (tx - cx) * k + W / 2, fy = (ty) => (ty - cy) * k + H / 2;
  const x0 = Math.floor(cx - (W / 2 + M) / k), x1 = Math.floor(cx + (W / 2 + M) / k);
  const y0 = Math.floor(cy - (H / 2 + M) / k), y1 = Math.floor(cy + (H / 2 + M) / k);
  const layers = { water: [], green: [], building: [], waterway: [], major: [], mid: [], minor: [], path: [], rail: [] };
  const names = [];
  for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
    const vt = new VectorTile(new PbfReader(await tile(tx, ty)));
    const each = (name, fn) => { const l = vt.layers[name]; if (!l) return; for (let i = 0; i < l.length; i++) fn(l.feature(i), l.extent); };
    const project = (f, ext) => f.loadGeometry().map((ring) => ring.map((p) => [fx(tx + p.x / ext), fy(ty + p.y / ext)]));
    const poly = (bucket) => (f, ext) => {
      const rings = project(f, ext).map((r) => simplify(r, 1.2)).filter((r) => r.length > 2 && r.some(inside));
      if (rings.length) layers[bucket].push(rings.map((r) => d(r, true)).join(''));
    };
    each('water', poly('water'));
    each('park', poly('green'));
    each('landcover', (f, ext) => { if (['wood', 'grass'].includes(f.properties.class)) poly('green')(f, ext); });
    each('building', poly('building'));
    each('waterway', (f, ext) => { for (const line of project(f, ext)) for (const r of runs(simplify(line, 1))) layers.waterway.push(d(r)); });
    each('transportation', (f, ext) => {
      const tier = ROAD[f.properties.class];
      if (!tier || f.properties.brunnel === 'tunnel') return;
      for (const line of project(f, ext)) for (const r of runs(simplify(line, 0.8))) layers[tier].push(d(r));
    });
    each('transportation_name', (f, ext) => {
      const name = f.properties.name; if (!name) return;
      for (const line of project(f, ext)) names.push({ name, cls: f.properties.class, pts: line });
    });
  }
  // Up to four street names, each set along a smooth stretch of its street
  // (the text follows the curve), fully inside the frame and clear of the pin,
  // the address label and each other.
  const rank = { motorway: 0, trunk: 0, primary: 1, secondary: 1, tertiary: 2, minor: 3, service: 5 };
  const short = (t) => t.replace(/\bAvenue\b/, 'Ave').replace(/\bStreet\b/, 'St').replace(/\bRoad\b/, 'Rd').replace(/\bDrive\b/, 'Dr').replace(/\bBoulevard\b/, 'Blvd').replace(/\bHighway\b/, 'Hwy').replace(/\bNorthwest\b/, 'NW').replace(/\bSouthwest\b/, 'SW').replace(/\bNortheast\b/, 'NE').replace(/\bSoutheast\b/, 'SE');
  const clear = ([x, y]) => x > 14 && x < W - 14 && y > 18 && y < H - 18 && !(Math.abs(x - W / 2) < 215 && y > H / 2 - 85 && y < H / 2 + 80);
  // Point at distance s along a polyline with cumulative lengths cum.
  const at_ = (pts, cum, s) => {
    let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };
  const best = new Map();
  for (const n of names) {
    const label = short(n.name);
    const L = label.length * 15.5 + 28; // the label's length at 25px, with room to spare
    const pts = n.pts, cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    for (let s0 = 0; s0 + L <= total; s0 += 12) {
      const samples = [];
      for (let s = s0; s <= s0 + L + 0.1; s += L / 8) samples.push(at_(pts, cum, s));
      if (!samples.every(clear)) continue;
      // How much the stretch bends: sum of turning angles between samples.
      let turn = 0;
      for (let i = 2; i < samples.length; i++) {
        const a1 = Math.atan2(samples[i - 1][1] - samples[i - 2][1], samples[i - 1][0] - samples[i - 2][0]);
        const a2 = Math.atan2(samples[i][1] - samples[i - 1][1], samples[i][0] - samples[i - 1][0]);
        let dA = Math.abs(a2 - a1); if (dA > Math.PI) dA = 2 * Math.PI - dA;
        turn += dA;
      }
      if (turn > 0.9) continue;
      const mid = samples[4];
      const cur = best.get(label);
      const score = turn + Math.hypot(mid[0] - W / 2, mid[1] - H / 2) / 2000;
      if (!cur || score < cur.score) {
        // Read left to right.
        const run = samples[0][0] <= samples[samples.length - 1][0] ? samples : [...samples].reverse();
        best.set(label, { name: label, d: 'M' + run.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join('L'), mid, score, r: rank[n.cls] ?? 4 });
      }
    }
  }
  const labels = [];
  for (const l of [...best.values()].sort((p, q) => p.r - q.r || p.score - q.score)) {
    if (labels.length >= 4) break;
    if (labels.some((o) => Math.hypot(o.mid[0] - l.mid[0], o.mid[1] - l.mid[1]) < 150)) continue;
    labels.push(l);
  }
  for (const l of labels) { delete l.mid; delete l.score; delete l.r; }
  const join = (arr) => arr.join('');
  const out = { w: W, h: H, lat: at.lat, lon: at.lon, exact: at.exact,
    water: join(layers.water), green: join(layers.green), waterway: join(layers.waterway),
    building: join(layers.building), rail: join(layers.rail), path: join(layers.path),
    minor: join(layers.minor), mid: join(layers.mid), major: join(layers.major), labels };
  // Keep the page light: drop buildings first, then paths, if the drawing is big.
  const size = () => JSON.stringify(out).length;
  if (size() > 36000) out.building = '';
  if (size() > 36000) out.path = '';
  return out;
}

let made = 0, skipped = [];
for (const d0 of demos.sort((a, b) => a.slug.localeCompare(b.slug))) {
  if (only.length && !only.includes(d0.slug)) continue;
  try {
    const at = await locate(d0);
    // A pin is only drawn where the address itself was found; a street or
    // town centre could be miles off, so those keep Google's map.
    if (!at || at.missing || !at.exact) {
      skipped.push(`${d0.slug} (${!at ? 'no street address' : at.missing ? 'not found' : `only found the ${at.kind}`})`);
      await rm(path.join(OUT, `${d0.slug}.json`), { force: true });
      continue;
    }
    const data = await build(d0, at);
    await writeFile(path.join(OUT, `${d0.slug}.json`), JSON.stringify(data) + '\n');
    made++;
    console.log(`  ${d0.slug}: ${at.exact ? 'address' : 'street-level'} (${at.kind}), ${(JSON.stringify(data).length / 1024).toFixed(1)} KB, labels: ${data.labels.map((l) => l.name).join(', ')}`);
  } catch (e) {
    skipped.push(`${d0.slug} (${e.message})`);
  }
}
const sorted = Object.fromEntries(Object.keys(geo).sort().map((k) => [k, geo[k]]));
await writeFile(GEO, JSON.stringify(sorted, null, 1) + '\n');
console.log(`maps: ${made} drawn; ${skipped.length} without a map${skipped.length ? `: ${skipped.join('; ')}` : ''}`);
