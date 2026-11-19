// The home page's map of every concept: a regional map (towns, highways,
// rivers and lakes) and a close-up of downtown Aiken, drawn from OpenFreeMap's
// OpenStreetMap vector tiles, with a pin for each concept whose address was
// found (data/geo.json, from scripts/maps.mjs). Writes data/regionmap.json.
// Usage: node scripts/regionmap.mjs
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TILES = path.join(ROOT, '.cache', 'tiles');
const UA = 'aiken-web-refresh-maps/1.0 (static site build; cached)';
await mkdir(TILES, { recursive: true });

const geo = JSON.parse(await readFile(path.join(ROOT, 'data', 'geo.json'), 'utf8'));
const demos = [];
for (const f of (await readdir(path.join(ROOT, 'src', 'demos'))).filter((x) => x.endsWith('.json'))) demos.push(JSON.parse(await readFile(path.join(ROOT, 'src', 'demos', f), 'utf8')));
const points = demos.map((d) => ({ d, g: geo[d.slug] })).filter(({ g }) => g && !g.missing && g.exact);

let tileUrl;
async function tile(z, x, y) {
  const file = path.join(TILES, `${z}-${x}-${y}.pbf`);
  if (existsSync(file)) return readFile(file);
  if (!tileUrl) tileUrl = (await (await fetch('https://tiles.openfreemap.org/planet', { headers: { 'user-agent': UA } })).json()).tiles[0];
  const res = await fetch(tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y), { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return buf;
}
const toTile = (lat, lon, z) => {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
};
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let far = -1, best = tol;
    for (let i = a + 1; i < b; i++) { const dd = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len; if (dd > best) { best = dd; far = i; } }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const pathD = (pts, close) => 'M' + pts.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join('L') + (close ? 'Z' : '');

/** Draw the area around a set of points onto a W x H frame at zoom z. */
async function frame({ pts, W, H, z, pad, roads, placeClasses, minPlaceRank = 99 }) {
  const t = pts.map(({ g }) => toTile(g.lat, g.lon, z));
  let [x0, y0, x1, y1] = [Math.min(...t.map((p) => p[0])), Math.min(...t.map((p) => p[1])), Math.max(...t.map((p) => p[0])), Math.max(...t.map((p) => p[1]))];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const k = Math.min((W * (1 - pad)) / Math.max(x1 - x0, 1e-6), (H * (1 - pad)) / Math.max(y1 - y0, 1e-6)); // frame units per tile
  const fx = (tx) => (tx - cx) * k + W / 2, fy = (ty) => (ty - cy) * k + H / 2;
  const tx0 = Math.floor(cx - W / 2 / k), tx1 = Math.floor(cx + W / 2 / k), ty0 = Math.floor(cy - H / 2 / k), ty1 = Math.floor(cy + H / 2 / k);
  const M = 40, inside = ([x, y]) => x > -M && x < W + M && y > -M && y < H + M;
  const L = { water: [], green: [], major: [], mid: [], minor: [], waterway: [] };
  const places = [];
  for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) {
    const vt = new VectorTile(new PbfReader(await tile(z, x, y)));
    const each = (name, fn) => { const l = vt.layers[name]; if (!l) return; for (let i = 0; i < l.length; i++) fn(l.feature(i), l.extent); };
    const project = (f, ext) => f.loadGeometry().map((ring) => ring.map((p) => [fx(x + p.x / ext), fy(y + p.y / ext)]));
    const poly = (bucket) => (f, ext) => { const rings = project(f, ext).map((r) => simplify(r, 1.4)).filter((r) => r.length > 2 && r.some(inside)); if (rings.length) L[bucket].push(rings.map((r) => pathD(r, true)).join('')); };
    each('water', poly('water'));
    each('park', poly('green'));
    each('waterway', (f, ext) => { if (!['river', 'canal'].includes(f.properties.class) && z < 13) return; for (const line of project(f, ext)) { const s = simplify(line, 1.2); if (s.some(inside)) L.waterway.push(pathD(s)); } });
    each('transportation', (f, ext) => {
      const tier = roads[f.properties.class];
      if (!tier || f.properties.brunnel === 'tunnel') return;
      for (const line of project(f, ext)) { const s = simplify(line, 1); if (s.some(inside)) L[tier].push(pathD(s)); }
    });
    each('place', (f, ext) => {
      const p = f.properties;
      if (!placeClasses.includes(p.class) || !p.name || (p.rank ?? 0) > minPlaceRank) return;
      const g = f.loadGeometry()[0][0]; const px = fx(x + g.x / ext), py = fy(y + g.y / ext);
      if (px > 40 && px < W - 40 && py > 20 && py < H - 20) places.push({ name: p.name, x: Math.round(px), y: Math.round(py), cls: p.class, rank: p.rank ?? 0 });
    });
  }
  // Keep the bigger places, without overlaps.
  const order = { city: 0, town: 1, village: 2, suburb: 3, neighbourhood: 4 };
  const labels = [];
  for (const p of places.sort((a, b) => (order[a.cls] ?? 9) - (order[b.cls] ?? 9) || a.rank - b.rank)) {
    if (labels.some((o) => Math.abs(o.x - p.x) < 120 && Math.abs(o.y - p.y) < 34) || labels.some((o) => o.name === p.name)) continue;
    labels.push({ name: p.name, x: p.x, y: p.y, big: (order[p.cls] ?? 9) <= 1 });
    if (labels.length >= 14) break;
  }
  const pins = pts.map(({ d, g }) => { const [a, b] = toTile(g.lat, g.lon, z); return { slug: d.slug, name: d.name, town: d.town, category: d.category, color: d.colors.primary, x: Math.round(fx(a)), y: Math.round(fy(b)) }; });
  // Move a place name off any dots it would cover: up first, then down.
  for (const l of labels) {
    const half = l.name.length * (l.big ? 6.2 : 4.6) + 6, hh = l.big ? 13 : 10;
    const covers = (y) => pins.some((p) => Math.abs(p.x - l.x) < half + 9 && Math.abs(p.y - (y - hh / 2)) < hh + 9);
    for (const dy of [0, -24, -46, 26, 48, -70, 72]) { if (!covers(l.y + dy)) { l.y += dy; break; } }
  }
  const j = (a) => a.join('');
  return { w: W, h: H, water: j(L.water), green: j(L.green), waterway: j(L.waterway), major: j(L.major), mid: j(L.mid), minor: j(L.minor), labels, pins };
}

// Region: every pin. Close-up: the downtown Aiken cluster.
const region = await frame({ pts: points, W: 1000, H: 640, z: 11, pad: 0.12, roads: { motorway: 'major', trunk: 'major', primary: 'major', secondary: 'mid', tertiary: 'minor' }, placeClasses: ['city', 'town', 'village'] });
const center = { lat: 33.5604, lon: -81.7196 }; // Laurens Street and Richland Avenue
const near = points.filter(({ g }) => Math.hypot((g.lat - center.lat) * 111, (g.lon - center.lon) * 92.6) < 1.6);
const downtown = await frame({ pts: near, W: 640, H: 640, z: 14, pad: 0.16, roads: { motorway: 'major', trunk: 'major', primary: 'major', secondary: 'major', tertiary: 'mid', minor: 'minor', service: 'minor' }, placeClasses: [] });
// Where the close-up sits on the regional map, for the outline drawn there.
const xs = downtown.pins.length ? near.map(({ d }) => region.pins.find((p) => p.slug === d.slug)) : [];
const box = xs.length ? { x: Math.min(...xs.map((p) => p.x)) - 8, y: Math.min(...xs.map((p) => p.y)) - 8, w: Math.max(...xs.map((p) => p.x)) - Math.min(...xs.map((p) => p.x)) + 16, h: Math.max(...xs.map((p) => p.y)) - Math.min(...xs.map((p) => p.y)) + 16 } : null;
await writeFile(path.join(ROOT, 'data', 'regionmap.json'), JSON.stringify({ region, downtown, box, made: new Date().toISOString().slice(0, 10) }) + '\n');
console.log(`regionmap: ${region.pins.length} pins across the region (${region.labels.map((l) => l.name).join(', ')}); ${downtown.pins.length} in downtown Aiken; ${(JSON.stringify({ region, downtown }).length / 1024).toFixed(0)} KB`);
