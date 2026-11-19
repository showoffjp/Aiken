// The concept's own app icon: the business's emblem on its brand colour. Used
// for "Add to Home Screen" (apple-touch-icon) and the web app manifest, so a
// customer who saves the site gets a proper icon instead of a page screenshot.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Demo } from './demos';

const dir = path.join(process.cwd(), 'node_modules', 'lucide-static', 'icons');
const glyph = (name: string) => {
  const file = existsSync(path.join(dir, `${name}.svg`)) ? path.join(dir, `${name}.svg`) : path.join(dir, 'store.svg');
  return readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
};

/** Square, full-bleed icon (the phone rounds the corners itself). `maskable` keeps the emblem inside the 80% safe zone. */
export function appIconSvg(demo: Demo, size: number, maskable = false) {
  const { primary, onPrimary, accent } = demo.colors;
  const g = maskable ? 0.36 : 0.46; // emblem size, share of the icon
  const ring = maskable ? 0.27 : 0.33; // halo radius, share of the icon
  const s = size, gs = s * g, off = (s - gs) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${primary}" stop-opacity=".82"/></linearGradient>
    <radialGradient id="glow" cx=".3" cy=".2" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${s}" height="${s}" fill="#000"/>
  <rect width="${s}" height="${s}" fill="url(#bg)"/>
  <rect width="${s}" height="${s}" fill="url(#glow)"/>
  <circle cx="${s / 2}" cy="${s / 2}" r="${s * ring}" fill="${onPrimary}" fill-opacity=".1" stroke="${accent}" stroke-opacity=".75" stroke-width="${s * 0.012}"/>
  <svg x="${off}" y="${off}" width="${gs}" height="${gs}" viewBox="0 0 24 24" fill="none" stroke="${onPrimary}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${glyph(demo.icon)}</svg>
</svg>`;
}

/** The name under the icon on a home screen: the business's short name (the phone truncates it if needed). */
export const appName = (demo: Demo) => demo.short || demo.name;

export const appIconPng = (demo: Demo, size: number, maskable = false) =>
  sharp(Buffer.from(appIconSvg(demo, size, maskable))).png({ compressionLevel: 9 }).toBuffer();
