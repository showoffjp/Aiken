// A concept's own before-and-after numbers, from the same measurement files
// the checkup uses (filmstrip, lighthouse, weights, a11y, firstscreen). Only
// the tests where the concept clearly does better are returned, so the list
// never argues against itself.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Demo } from './demos';

const cache: Record<string, any> = {};
const load = (f: string) => (cache[f] ??= (() => { try { return JSON.parse(readFileSync(path.join(process.cwd(), 'data', f), 'utf8')); } catch { return {}; } })());
const ok = (x: any) => x && !x.error;
// Decimal units (1 MB = 1,000,000 bytes), as browsers' developer tools show them.
const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export type Measure = { label: string; today: string; concept: string; note?: string };

export function measures(demo: Demo): Measure[] {
  if (demo.source.none) return [];
  const k = demo.prospect || demo.slug;
  const film = load('filmstrip.json')[k], lh = load('lighthouse.json')[k], w = load('weights.json')[k], ax = load('a11y.json')[k], fs = load('firstscreen.json')[k];
  const out: Measure[] = [];
  if (ok(film?.site) && film.site.frames && ok(film?.concept) && film.concept.first != null && (film.site.first == null || film.site.first > film.concept.first + 800)) {
    out.push({ label: 'On screen on a slow phone', today: film.site.first == null ? 'Still blank at 12 s' : `${(film.site.first / 1000).toFixed(1)} s`, concept: `${(film.concept.first / 1000).toFixed(1)} s` });
  }
  if (ok(lh?.site) && ok(lh?.concept) && lh.concept.performance > lh.site.performance) {
    out.push({ label: 'Google Lighthouse speed', today: `${lh.site.performance} / 100`, concept: `${lh.concept.performance} / 100` });
  }
  if (w?.site?.bytes && w?.concept?.bytes && w.site.bytes > w.concept.bytes * 1.3) {
    out.push({ label: 'Page weight on a phone', today: size(w.site.bytes), concept: size(w.concept.bytes) });
  }
  if (typeof ax?.site?.issues === 'number' && typeof ax?.concept?.issues === 'number' && ax.site.issues > ax.concept.issues) {
    out.push({ label: 'Accessibility problems', today: String(ax.site.issues), concept: String(ax.concept.issues) });
  }
  if (fs?.site && fs?.concept && fs.site.call === false && fs.concept.call === true) {
    out.push({ label: 'Call button on the first phone screen', today: 'No', concept: 'Yes' });
  }
  return out;
}
