// Street-map drawing data made by scripts/maps.mjs (data/maps/<slug>.json).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { MapData } from '../components/demo/StreetMap.astro';

const cache = new Map<string, MapData | null>();
export function streetMap(slug: string): MapData | null {
  if (!cache.has(slug)) {
    let data: MapData | null = null;
    try { data = JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'maps', `${slug}.json`), 'utf8')); } catch { /* no map for this one */ }
    cache.set(slug, data);
  }
  return cache.get(slug)!;
}
